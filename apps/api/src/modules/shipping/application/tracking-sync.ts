// Tracking przesyłek (F-24, PROJECT.md §8.3): historia z API dostawcy zapisana w
// shipment_events i zmiany statusu z eventami ShipmentStatusChanged. Synchronizację uruchamia
// webhook dostawcy (job z krótkim oknem deduplikacji) i polling zapasowy co 10 minut dla
// przesyłek niesprawdzanych od 2 godzin. Wiersz przesyłki jest blokowany na czas zapisu,
// więc webhook i polling nie zdublują eventów.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { Outbox } from '../../../infra/outbox/index.js';
import { deadlineJobId, JobQueues } from '../../../infra/queues/index.js';
import { shipmentEvents, shipments } from '../db/shipping.schema.js';
import { type StatusChange, statusChanges } from '../domain/tracking-rules.js';
import {
  ACTIVE_SHIPMENT_STATUSES,
  FINAL_SHIPMENT_STATUSES,
  type ShipmentStatus,
} from '../domain/shipping-values.js';
import { ShippingProviderRegistry } from './provider-registry.js';
import { ShipmentService } from './shipment.service.js';

export const SHIPPING_SYNC_TRACKING_JOB = 'shipping.sync-tracking';
export const SHIPPING_POLL_TRACKING_JOB = 'shipping.poll-tracking';

/** Co ile działa polling zapasowy i po jakim czasie przesyłka jest „niesprawdzona” (§8.3). */
export const TRACKING_POLL_EVERY_MS = 10 * 60 * 1000;
export const TRACKING_STALE_AFTER_MS = 2 * 60 * 60 * 1000;
/** Przesyłek na jedno wykonanie pollingu. */
export const TRACKING_POLL_BATCH = 100;
/** Seria webhooków o tej samej przesyłce w tym oknie to jedna synchronizacja. */
const SYNC_WINDOW_MS = 5_000;
/** „Nadaj” bez utworzonej przesyłki po tym czasie: job zginął (np. Redis), dodajemy go ponownie. */
const STALE_REQUEST_AFTER_MS = 5 * 60 * 1000;

export interface SyncTrackingJob {
  readonly shipmentId: string;
}

export interface TrackingPollResult {
  readonly checked: number;
  readonly changed: number;
  readonly failed: number;
  readonly requeued: number;
}

@Injectable()
export class TrackingSync {
  private readonly logger = new Logger(TrackingSync.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(ShippingProviderRegistry) private readonly registry: ShippingProviderRegistry,
    @Inject(ShipmentService) private readonly shipmentService: ShipmentService,
    private readonly outbox: Outbox,
    private readonly jobs: JobQueues,
  ) {}

  /**
   * Pobiera tracking od dostawcy, zapisuje nowe zdarzenia i stosuje zmiany statusu. Zwraca
   * zmiany w kolejności (puste, gdy nic nowego albo przesyłka nie jest u dostawcy).
   */
  async sync(shipmentId: string): Promise<StatusChange[]> {
    const [current] = await this.db.select().from(shipments).where(eq(shipments.id, shipmentId));
    if (
      current === undefined ||
      current.providerShipmentId === null ||
      FINAL_SHIPMENT_STATUSES.has(current.status)
    ) {
      return [];
    }
    const events = await this.registry
      .get(current.provider)
      .getTracking(current.providerShipmentId);
    const detectedAt = new Date();
    return this.db.transaction(async (tx) => {
      const [shipment] = await tx
        .select()
        .from(shipments)
        .where(eq(shipments.id, shipmentId))
        .for('update');
      if (shipment === undefined) {
        return [];
      }
      // Statusy, które przesyłka już miała (przed tą porcją): powód zwrotu (§7.4).
      const history = await tx
        .selectDistinct({ status: shipmentEvents.status })
        .from(shipmentEvents)
        .where(eq(shipmentEvents.shipmentId, shipmentId));
      const reached = new Set<ShipmentStatus>([
        shipment.status,
        ...history.map((row) => row.status),
      ]);
      const inserted =
        events.length === 0
          ? []
          : await tx
              .insert(shipmentEvents)
              .values(
                events.map((event) => ({
                  shipmentId,
                  rawStatus: event.rawStatus,
                  status: event.status,
                  description: event.description,
                  occurredAt: event.occurredAt,
                  recordedAt: detectedAt,
                })),
              )
              .onConflictDoNothing()
              .returning({
                rawStatus: shipmentEvents.rawStatus,
                occurredAt: shipmentEvents.occurredAt,
              });
      const fresh = events.filter((event) =>
        inserted.some(
          (row) =>
            row.rawStatus === event.rawStatus &&
            row.occurredAt.getTime() === event.occurredAt.getTime(),
        ),
      );
      const changes = statusChanges(
        { status: shipment.status, statusChangedAt: shipment.statusChangedAt, reached },
        fresh,
      );
      const last = changes.at(-1);
      await tx
        .update(shipments)
        .set({
          polledAt: detectedAt,
          updatedAt: detectedAt,
          ...(last === undefined
            ? {}
            : {
                status: last.status,
                statusChangedAt: last.occurredAt,
                ...this.milestones(changes),
              }),
        })
        .where(eq(shipments.id, shipmentId));
      let previous = shipment;
      for (const change of changes) {
        await this.outbox.add(
          tx,
          this.shipmentService.statusEvent(
            previous,
            change.status,
            change.occurredAt,
            detectedAt,
            change.returnReason,
          ),
        );
        previous = { ...previous, status: change.status };
      }
      if (changes.length > 0) {
        this.logger.log(
          { shipmentId, statuses: changes.map((change) => change.status) },
          'Tracking: nowe statusy przesyłki',
        );
      }
      return changes;
    });
  }

  /** Synchronizacja po webhooku: jeden job na przesyłkę w 5-sekundowym oknie. */
  async enqueueSync(shipmentId: string): Promise<void> {
    const windowEnd = Math.ceil((Date.now() + 1) / SYNC_WINDOW_MS) * SYNC_WINDOW_MS;
    await this.jobs.add(
      'shipping',
      SHIPPING_SYNC_TRACKING_JOB,
      { shipmentId } satisfies SyncTrackingJob,
      { jobId: deadlineJobId('sync-tracking', shipmentId, windowEnd), runAt: new Date(windowEnd) },
    );
  }

  /**
   * Polling zapasowy: aktywne przesyłki niesprawdzane od 2 godzin, najdawniej sprawdzane
   * najpierw. Błąd jednej przesyłki nie przerywa reszty. Przy okazji ponawia zgubione joby
   * tworzenia przesyłki po „Nadaj”.
   */
  async pollActive(now: Date = new Date()): Promise<TrackingPollResult> {
    const stale = new Date(now.getTime() - TRACKING_STALE_AFTER_MS);
    const due = await this.db
      .select({ id: shipments.id })
      .from(shipments)
      .where(
        and(
          inArray(shipments.status, [...ACTIVE_SHIPMENT_STATUSES]),
          or(isNull(shipments.polledAt), lt(shipments.polledAt, stale)),
        ),
      )
      .orderBy(sql`${shipments.polledAt} asc nulls first`, asc(shipments.createdAt))
      .limit(TRACKING_POLL_BATCH);
    let changed = 0;
    let failed = 0;
    for (const { id } of due) {
      try {
        changed += (await this.sync(id)).length > 0 ? 1 : 0;
      } catch (error) {
        failed += 1;
        this.logger.warn({ err: error, shipmentId: id }, 'Tracking: błąd synchronizacji');
        // Bez polled_at przesyłka z błędem blokowałaby kolejne wykonania na początku listy.
        await this.db.update(shipments).set({ polledAt: now }).where(eq(shipments.id, id));
      }
    }
    const requeued = await this.requeueStaleRequests(now);
    if (due.length > 0 || requeued > 0) {
      this.logger.log(
        { checked: due.length, changed, failed, requeued },
        'Tracking: polling zapasowy',
      );
    }
    return { checked: due.length, changed, failed, requeued };
  }

  private async requeueStaleRequests(now: Date): Promise<number> {
    const stale = await this.db
      .select({ id: shipments.id, attempt: shipments.dispatchAttempts })
      .from(shipments)
      .where(
        and(
          eq(shipments.status, 'REQUESTED'),
          lt(shipments.requestedAt, new Date(now.getTime() - STALE_REQUEST_AFTER_MS)),
        ),
      )
      .limit(TRACKING_POLL_BATCH);
    for (const row of stale) {
      await this.shipmentService.enqueueCreate(row.id, row.attempt);
    }
    return stale.length;
  }

  /** Daty kamieni milowych ze zmian (doręczenie, zwrot, anulowanie). */
  private milestones(changes: readonly StatusChange[]) {
    const at = (status: ShipmentStatus) =>
      changes.find((change) => change.status === status)?.occurredAt;
    const delivered = at('DELIVERED');
    const returned = at('RETURNED');
    const cancelled = at('CANCELLED');
    return {
      ...(delivered === undefined ? {} : { deliveredAt: delivered }),
      ...(returned === undefined ? {} : { returnedAt: returned }),
      ...(cancelled === undefined ? {} : { cancelledAt: cancelled }),
    };
  }
}

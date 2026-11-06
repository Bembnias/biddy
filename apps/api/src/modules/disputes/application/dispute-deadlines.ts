// Terminy i tracking sporu (F-28, PROJECT.md §7.4–7.5):
// - job disputes.escalate-overdue: brak odpowiedzi sprzedającego na zgłoszenie albo kupującego na
//   propozycję w 48 h → ESCALATED;
// - job disputes.expire-returns: zwrot nienadany w 5 dni roboczych → RESOLVED na korzyść
//   sprzedającego (przesyłka zwrotna anulowana; najpierw synchronizacja trackingu, jak przy
//   nienadaniu w F-26);
// - job disputes.settle-returns: 36 h po odbiorze zwrotu bez reakcji sprzedającego → RESOLVED
//   z zapisanym pełnym zwrotem;
// - konsument ShipmentStatusChanged przesyłki RETURN: nadanie (RETURN_IN_TRANSIT), odbiór
//   (RETURN_DELIVERED z oknem 36 h) albo powrót do kupującego (ESCALATED).
// Sweepery co minutę, jak terminy zamówień (decyzja nr 117): restart workera niczego nie gubi.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, lte } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import {
  type DomainEventContext,
  type DomainEventOf,
  OnDomainEvent,
  Outbox,
} from '../../../infra/outbox/index.js';
import { ScheduledJob } from '../../../infra/queues/index.js';
import { ShipmentService, ShipmentStatusChanged, TrackingSync } from '../../shipping/index.js';
import { type DisputeRow, disputes } from '../db/disputes.schema.js';
import {
  isAtCarrier,
  type ReturnStep,
  returnInspectionEndsAt,
  returnSteps,
  SYSTEM_STATEMENTS,
} from '../domain/dispute-rules.js';
import { DisputeReturnDelivered } from '../disputes.events.js';
import { addDisputeEvent, lockDispute, transitionDispute } from './dispute-records.js';
import {
  DisputeTransitions,
  disputeParties,
  storedDecision,
  SYSTEM_ACTOR,
} from './dispute-transitions.js';

/** Sporów sprawdzanych w jednym wykonaniu joba. */
const BATCH = 100;

/** Wynik jednego wykonania joba terminu. */
export interface DisputeDeadlineReport {
  readonly checked: number;
  readonly changed: number;
}

@Injectable()
export class DisputeDeadlines {
  private readonly logger = new Logger(DisputeDeadlines.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly transitions: DisputeTransitions,
    private readonly shipments: ShipmentService,
    private readonly tracking: TrackingSync,
    private readonly outbox: Outbox,
  ) {}

  // --- Brak odpowiedzi ---

  @ScheduledJob({ queue: 'disputes', name: 'disputes.escalate-overdue', every: 60_000 })
  async runEscalateOverdue(): Promise<DisputeDeadlineReport> {
    return this.escalateOverdue(new Date());
  }

  /** Eskalacja sporów bez odpowiedzi strony w 48 h (`now`: chwila sprawdzenia). */
  async escalateOverdue(now: Date): Promise<DisputeDeadlineReport> {
    const due = await this.db
      .select({ id: disputes.id })
      .from(disputes)
      .where(
        and(
          inArray(disputes.status, ['AWAITING_SELLER', 'PARTIAL_OFFERED']),
          lte(disputes.responseDueAt, now),
        ),
      )
      .orderBy(asc(disputes.responseDueAt))
      .limit(BATCH);
    return this.each(due, 'Nie udało się eskalować sporu', async (id) =>
      this.db.transaction(async (tx) => {
        const dispute = await lockDispute(tx, id);
        if (
          dispute === undefined ||
          (dispute.status !== 'AWAITING_SELLER' && dispute.status !== 'PARTIAL_OFFERED') ||
          dispute.responseDueAt === null ||
          dispute.responseDueAt.getTime() > now.getTime()
        ) {
          return false;
        }
        const cause = dispute.status === 'AWAITING_SELLER' ? 'SELLER_SILENT' : 'BUYER_SILENT';
        await this.transitions.escalate(tx, dispute, cause, SYSTEM_ACTOR, now);
        return true;
      }),
    );
  }

  // --- Zwrot nienadany w terminie ---

  @ScheduledJob({ queue: 'disputes', name: 'disputes.expire-returns', every: 60_000 })
  async runExpireReturns(): Promise<DisputeDeadlineReport> {
    return this.expireReturns(new Date());
  }

  /** Spory, w których kupujący nie nadał zwrotu w 5 dni roboczych (`now`: chwila sprawdzenia). */
  async expireReturns(now: Date): Promise<DisputeDeadlineReport> {
    const due = await this.db
      .select()
      .from(disputes)
      .where(and(eq(disputes.status, 'AWAITING_RETURN'), lte(disputes.returnShipBy, now)))
      .orderBy(asc(disputes.returnShipBy))
      .limit(BATCH);
    return this.each(due, 'Nie udało się zamknąć sporu bez zwrotu', async (id) => {
      const found = due.find((dispute) => dispute.id === id);
      if (found === undefined || !(await this.withdrawReturn(found))) {
        return false;
      }
      return this.db.transaction(async (tx) => {
        const dispute = await lockDispute(tx, id);
        if (
          dispute?.status !== 'AWAITING_RETURN' ||
          dispute.returnShipBy === null ||
          dispute.returnShipBy.getTime() > now.getTime()
        ) {
          return false;
        }
        await this.transitions.resolve(
          tx,
          dispute,
          {
            outcome: 'SELLER_FAVOR',
            fault: null,
            refundAmount: null,
            decidedBy: 'SYSTEM',
            decidedByStaffId: null,
            statement: SYSTEM_STATEMENTS.returnNotShipped,
          },
          now,
        );
        return true;
      });
    });
  }

  /**
   * Przesyłka zwrotna po terminie nadania: anulowanie (także u dostawcy). false, gdy paczka jest
   * już u przewoźnika (event nadania jest w drodze) albo powstaje u dostawcy.
   */
  private async withdrawReturn(dispute: DisputeRow): Promise<boolean> {
    if (dispute.returnShipmentId === null) {
      return true;
    }
    let shipment = await this.shipments.details(dispute.returnShipmentId);
    if (shipment?.shipment.status === 'CREATED') {
      // Zwrot mógł zostać nadany przed chwilą: najpierw stan u dostawcy, potem decyzja.
      await this.tracking.sync(shipment.shipment.id);
      shipment = await this.shipments.details(dispute.returnShipmentId);
    }
    if (shipment === undefined || shipment.shipment.status === 'CANCELLED') {
      return true;
    }
    const { status } = shipment.shipment;
    if (isAtCarrier(status) || status === 'REQUESTED') {
      return false;
    }
    await this.shipments.cancel(shipment.shipment.id);
    return true;
  }

  // --- Zwrot dostarczony bez reakcji sprzedającego ---

  @ScheduledJob({ queue: 'disputes', name: 'disputes.settle-returns', every: 60_000 })
  async runSettleReturns(): Promise<DisputeDeadlineReport> {
    return this.settleReturns(new Date());
  }

  /** Zwrot pieniędzy 36 h po odbiorze zwrotu (`now`: chwila sprawdzenia). */
  async settleReturns(now: Date): Promise<DisputeDeadlineReport> {
    const due = await this.db
      .select({ id: disputes.id })
      .from(disputes)
      .where(
        and(eq(disputes.status, 'RETURN_DELIVERED'), lte(disputes.returnInspectionEndsAt, now)),
      )
      .orderBy(asc(disputes.returnInspectionEndsAt))
      .limit(BATCH);
    return this.each(due, 'Nie udało się zwrócić pieniędzy po zwrocie', async (id) =>
      this.db.transaction(async (tx) => {
        const dispute = await lockDispute(tx, id);
        if (
          dispute?.status !== 'RETURN_DELIVERED' ||
          dispute.returnInspectionEndsAt === null ||
          dispute.returnInspectionEndsAt.getTime() > now.getTime()
        ) {
          return false;
        }
        await this.transitions.resolve(tx, dispute, storedDecision(dispute), now);
        return true;
      }),
    );
  }

  // --- Tracking zwrotu ---

  @OnDomainEvent(ShipmentStatusChanged, { consumer: 'disputes.return-tracking' })
  async onShipmentStatusChanged(
    event: DomainEventOf<typeof ShipmentStatusChanged>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const { orderId, direction, status } = event.payload;
    if (orderId === null || direction !== 'RETURN') {
      return;
    }
    const [found] = await tx
      .select({ id: disputes.id })
      .from(disputes)
      .where(eq(disputes.returnShipmentId, event.aggregateId));
    const locked = found === undefined ? undefined : await lockDispute(tx, found.id);
    if (locked === undefined) {
      this.logger.warn({ orderId, shipmentId: event.aggregateId }, 'Zwrot bez sporu');
      return;
    }
    let dispute = locked;
    for (const step of returnSteps(dispute.status, status)) {
      dispute = await this.applyReturnStep(tx, dispute, step, event);
    }
  }

  private async applyReturnStep(
    tx: DomainEventContext['tx'],
    dispute: DisputeRow,
    step: ReturnStep,
    event: DomainEventOf<typeof ShipmentStatusChanged>,
  ): Promise<DisputeRow> {
    const occurredAt = new Date(event.payload.occurredAt);
    const now = new Date();
    switch (step) {
      case 'SHIPPED': {
        const updated = await transitionDispute(
          tx,
          dispute,
          'RETURN_IN_TRANSIT',
          { returnShippedAt: occurredAt },
          now,
        );
        await addDisputeEvent(tx, dispute.id, { type: 'RETURN_SHIPPED', ...SYSTEM_ACTOR }, now);
        return updated;
      }
      case 'DELIVERED': {
        const endsAt = returnInspectionEndsAt(new Date(event.payload.detectedAt));
        const updated = await transitionDispute(
          tx,
          dispute,
          'RETURN_DELIVERED',
          { returnDeliveredAt: occurredAt, returnInspectionEndsAt: endsAt },
          now,
        );
        await addDisputeEvent(tx, dispute.id, { type: 'RETURN_DELIVERED', ...SYSTEM_ACTOR }, now);
        await this.outbox.add(
          tx,
          DisputeReturnDelivered.create({
            aggregateId: dispute.id,
            payload: { ...disputeParties(dispute), inspectionEndsAt: endsAt.toISOString() },
          }),
        );
        return updated;
      }
      case 'FAILED':
        this.logger.warn(
          { disputeId: dispute.id, status: event.payload.status },
          'Zwrot wraca do kupującego: spór do decyzji supportu',
        );
        return this.transitions.escalate(tx, dispute, 'RETURN_FAILED', SYSTEM_ACTOR, now, {
          note: 'Przesyłka zwrotna nie dotarła do sprzedającego i wraca do kupującego.',
        });
    }
  }

  private async each(
    due: readonly { readonly id: string }[],
    failure: string,
    run: (id: string) => Promise<boolean>,
  ): Promise<DisputeDeadlineReport> {
    let changed = 0;
    for (const { id } of due) {
      try {
        if (await run(id)) {
          changed += 1;
        }
      } catch (error) {
        this.logger.error({ disputeId: id, err: error }, failure);
      }
    }
    return { checked: due.length, changed };
  }
}

// Symulator FakeShipping (F-24): kolejne statusy przesyłki (automat według scenariusza albo
// panel deweloperski), webhooki HTTP na nasz endpoint i przegląd do panelu. Automat
// zaplanowany ze statusu, którego przesyłka już nie ma, nic nie robi (panel zmienił stan).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { APP_CONFIG, type AppConfig } from '../../../../infra/config/index.js';
import { type Database, DRIZZLE, newId } from '../../../../infra/db/index.js';
import { DomainError } from '../../../../infra/http/index.js';
import {
  type FakeParcelStatus,
  type FakeShippingParcelRow,
  type FakeShippingScenario,
  type FakeShippingTrackingRow,
  type FakeShippingWebhookRow,
  fakeShippingParcels,
  fakeShippingTracking,
  fakeShippingWebhooks,
} from '../../db/fake-shipping.schema.js';
import { type ShipmentRow, shipments } from '../../db/shipping.schema.js';
import {
  FAKE_SHIPPING_SIGNATURE_HEADER,
  FAKE_STATUS_DESCRIPTIONS,
  type FakeShippingWebhookBody,
  nextFakeStatus,
  signFakeShippingWebhook,
} from './fake-shipping-format.js';
import { FAKE_SHIPPING_SCHEDULE, type FakeShippingSchedule } from './fake-shipping-schedule.js';

/** Limit czasu wysyłki jednego webhooka. */
const DELIVERY_TIMEOUT_MS = 10_000;
/** Przesyłek w przeglądzie panelu. */
const OVERVIEW_LIMIT = 50;

export interface AdvanceOptions {
  /** Wskazany status zamiast następnego według scenariusza (panel). */
  readonly status?: FakeParcelStatus;
  /** Automat: krok tylko z tego statusu (inaczej job jest nieaktualny i nic nie robi). */
  readonly from?: FakeParcelStatus;
  /** false: bez webhooka (zaginiony webhook, test pollingu i synchronizacji z panelu). */
  readonly deliverWebhook?: boolean;
}

export interface FakeParcelOverview {
  readonly parcel: FakeShippingParcelRow;
  readonly tracking: readonly FakeShippingTrackingRow[];
  readonly webhooks: readonly FakeShippingWebhookRow[];
}

export interface FakeShipmentOverview {
  readonly shipment: ShipmentRow;
  readonly parcel: FakeParcelOverview | null;
}

function notFound(detail: string): DomainError {
  return new DomainError({ code: 'NOT_FOUND', detail });
}

@Injectable()
export class FakeShippingSimulator {
  private readonly logger = new Logger(FakeShippingSimulator.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(FAKE_SHIPPING_SCHEDULE) private readonly schedule: FakeShippingSchedule,
  ) {}

  /**
   * Dodaje status przesyłce: wskazany albo następny według scenariusza. Zwraca przesyłkę po
   * zmianie albo undefined, gdy automat nie ma już nic do zrobienia.
   */
  async advance(
    parcelId: string,
    options: AdvanceOptions = {},
  ): Promise<FakeShippingParcelRow | undefined> {
    const now = new Date();
    const result = await this.db.transaction(async (tx) => {
      const [parcel] = await tx
        .select()
        .from(fakeShippingParcels)
        .where(eq(fakeShippingParcels.id, parcelId))
        .for('update');
      if (parcel === undefined) {
        throw notFound(`Nie ma przesyłki FakeShipping ${parcelId}.`);
      }
      if (options.from !== undefined && parcel.status !== options.from) {
        return undefined;
      }
      const next =
        options.status ?? nextFakeStatus(parcel.scenario, parcel.request.kind, parcel.status);
      if (next === undefined) {
        if (options.from !== undefined) {
          return undefined;
        }
        throw new DomainError({
          code: 'CONFLICT',
          detail: 'Scenariusz przesyłki nie ma kolejnego statusu. Wybierz status ręcznie.',
        });
      }
      const [updated] = await tx
        .update(fakeShippingParcels)
        .set({ status: next, updatedAt: now })
        .where(eq(fakeShippingParcels.id, parcelId))
        .returning();
      await tx.insert(fakeShippingTracking).values({
        parcelId,
        status: next,
        description: FAKE_STATUS_DESCRIPTIONS[next],
        occurredAt: now,
      });
      const [webhook] =
        options.deliverWebhook === false
          ? []
          : await tx
              .insert(fakeShippingWebhooks)
              .values({ id: `fsw_${newId().replaceAll('-', '')}`, parcelId, createdAt: now })
              .returning();
      return updated === undefined ? undefined : { parcel: updated, webhook };
    });
    if (result === undefined) {
      return undefined;
    }
    if (result.webhook !== undefined) {
      await this.schedule.deliver(result.webhook.id);
    }
    await this.scheduleNext(result.parcel);
    return result.parcel;
  }

  /** Zmienia scenariusz; automat rusza dalej z bieżącego statusu według nowej ścieżki. */
  async setScenario(
    parcelId: string,
    scenario: FakeShippingScenario,
  ): Promise<FakeShippingParcelRow> {
    const [parcel] = await this.db
      .update(fakeShippingParcels)
      .set({ scenario, updatedAt: new Date() })
      .where(eq(fakeShippingParcels.id, parcelId))
      .returning();
    if (parcel === undefined) {
      throw notFound(`Nie ma przesyłki FakeShipping ${parcelId}.`);
    }
    await this.scheduleNext(parcel);
    return parcel;
  }

  /** Wysyła webhook (job `fake-shipping.deliver`); błąd = ponowienie joba. */
  async deliver(webhookId: string): Promise<void> {
    const [webhook] = await this.db
      .select()
      .from(fakeShippingWebhooks)
      .where(eq(fakeShippingWebhooks.id, webhookId));
    if (webhook === undefined) {
      throw notFound(`Nieznany webhook ${webhookId}`);
    }
    const body = JSON.stringify({
      id: webhook.id,
      type: 'parcel.updated',
      created: webhook.createdAt.toISOString(),
      parcel_id: webhook.parcelId,
    } satisfies FakeShippingWebhookBody);
    const signature = signFakeShippingWebhook(
      this.config.shipping.fake.webhookSecret,
      body,
      Math.floor(Date.now() / 1000),
    );
    let failure: string | undefined;
    try {
      const response = await fetch(this.config.shipping.fake.webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [FAKE_SHIPPING_SIGNATURE_HEADER]: signature,
        },
        body,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        failure = `HTTP ${response.status}${text === '' ? '' : `: ${text.slice(0, 300)}`}`;
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    await this.db
      .update(fakeShippingWebhooks)
      .set({
        attempts: webhook.attempts + 1,
        lastError: failure ?? null,
        ...(failure === undefined ? { deliveredAt: new Date() } : {}),
      })
      .where(eq(fakeShippingWebhooks.id, webhookId));
    if (failure !== undefined) {
      throw new Error(`Webhook FakeShipping ${webhookId} nie dotarł: ${failure}`);
    }
    this.logger.debug(
      { webhookId, parcelId: webhook.parcelId },
      'Webhook FakeShipping dostarczony',
    );
  }

  /** Przesyłki FakeShipping w Biddy (najnowsze) ze stanem u dostawcy, do panelu. */
  async overview(): Promise<FakeShipmentOverview[]> {
    const rows = await this.db
      .select()
      .from(shipments)
      .where(eq(shipments.provider, 'fake'))
      .orderBy(desc(shipments.createdAt))
      .limit(OVERVIEW_LIMIT);
    const parcelIds = rows.flatMap((row) =>
      row.providerShipmentId === null ? [] : [row.providerShipmentId],
    );
    const [parcels, tracking, webhooks] =
      parcelIds.length === 0
        ? [[], [], []]
        : await Promise.all([
            this.db
              .select()
              .from(fakeShippingParcels)
              .where(inArray(fakeShippingParcels.id, parcelIds)),
            this.db
              .select()
              .from(fakeShippingTracking)
              .where(inArray(fakeShippingTracking.parcelId, parcelIds))
              .orderBy(asc(fakeShippingTracking.occurredAt), asc(fakeShippingTracking.id)),
            this.db
              .select()
              .from(fakeShippingWebhooks)
              .where(inArray(fakeShippingWebhooks.parcelId, parcelIds))
              .orderBy(desc(fakeShippingWebhooks.createdAt)),
          ]);
    return rows.map((shipment) => {
      const parcel = parcels.find((row) => row.id === shipment.providerShipmentId);
      return {
        shipment,
        parcel:
          parcel === undefined
            ? null
            : {
                parcel,
                tracking: tracking.filter((row) => row.parcelId === parcel.id),
                webhooks: webhooks.filter((row) => row.parcelId === parcel.id).slice(0, 10),
              },
      };
    });
  }

  /** Przesyłka u FakeShipping z historią i webhookami (odpowiedź akcji panelu). */
  async parcelOverview(parcelId: string): Promise<FakeParcelOverview> {
    const [parcel] = await this.db
      .select()
      .from(fakeShippingParcels)
      .where(eq(fakeShippingParcels.id, parcelId));
    if (parcel === undefined) {
      throw notFound(`Nie ma przesyłki FakeShipping ${parcelId}.`);
    }
    const [tracking, webhooks] = await Promise.all([
      this.db
        .select()
        .from(fakeShippingTracking)
        .where(eq(fakeShippingTracking.parcelId, parcelId))
        .orderBy(asc(fakeShippingTracking.occurredAt), asc(fakeShippingTracking.id)),
      this.db
        .select()
        .from(fakeShippingWebhooks)
        .where(eq(fakeShippingWebhooks.parcelId, parcelId))
        .orderBy(desc(fakeShippingWebhooks.createdAt))
        .limit(10),
    ]);
    return { parcel, tracking, webhooks };
  }

  /** Przesyłka FakeShipping po ID w Biddy (panel: akcje na przesyłce testowej). */
  async shipment(shipmentId: string): Promise<ShipmentRow> {
    const [row] = await this.db
      .select()
      .from(shipments)
      .where(and(eq(shipments.id, shipmentId), eq(shipments.provider, 'fake')));
    if (row === undefined) {
      throw notFound('Nie znaleziono przesyłki FakeShipping.');
    }
    return row;
  }

  private async scheduleNext(parcel: FakeShippingParcelRow): Promise<void> {
    if (
      parcel.scenario !== 'MANUAL' &&
      nextFakeStatus(parcel.scenario, parcel.request.kind, parcel.status) !== undefined
    ) {
      await this.schedule.advanceLater(parcel.id, parcel.status);
    }
  }
}

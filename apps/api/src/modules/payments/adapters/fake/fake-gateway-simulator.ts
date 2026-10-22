// Symulator operatora po stronie FakeGateway (F-23, PROJECT.md §7.8): rozlicza płatności, zwroty
// i wypłaty (job z opóźnieniem albo przycisk na testowej stronie płatności), wywołuje zdarzenia
// rzadkie u prawdziwego operatora (chargeback, odrzucona wypłata, zmiana KYC) i wysyła podpisane
// webhooki HTTP na nasz endpoint. Każda zmiana stanu zapisuje zdarzenie (fake_gateway_events),
// a wysyłka idzie osobnym jobem z ponowieniami.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';

import { APP_CONFIG, type AppConfig } from '../../../../infra/config/index.js';
import { type Database, DRIZZLE, type Transaction } from '../../../../infra/db/index.js';
import * as fakeTables from '../../db/fake-gateway.schema.js';
import {
  type FakeGatewayEventRow,
  fakeGatewayEvents,
  type FakeGatewayPaymentRow,
  fakeGatewayPayments,
  type FakeGatewayPayoutRow,
  fakeGatewayPayouts,
  type FakeGatewayRefundRow,
  fakeGatewayRefunds,
  type FakeGatewaySellerRow,
  fakeGatewaySellers,
} from '../../db/fake-gateway.schema.js';
import type { PaymentFailureReason, SellerStatus } from '../../domain/payment-values.js';
import { PaymentGatewayError } from '../../ports/payment-gateway.port.js';
import { sellerShareOfRefund } from './fake-scenarios.js';
import { FAKE_GATEWAY_SCHEDULE, type FakeGatewaySchedule } from './fake-gateway-schedule.js';
import { fakeId, fakePaymentObject, insertFakeEvent, paymentMoney } from './fake-records.js';
import {
  FAKE_SIGNATURE_HEADER,
  fakeAmount,
  fakeSellerStatusCode,
  signFakeWebhook,
} from './fake-webhook-format.js';

/** Ile najnowszych obiektów każdego rodzaju pokazuje panel deweloperski. */
export const FAKE_OVERVIEW_LIMIT = 50;

/** Limit czasu wysyłki webhooka (operator po nim uznaje próbę za nieudaną i ponawia). */
const DELIVERY_TIMEOUT_MS = 10_000;

export type FakePaymentOutcome = 'SUCCEEDED' | 'FAILED';

export type FakeChargebackAction = 'OPEN' | 'WON' | 'LOST';

export interface FakeGatewayOverview {
  readonly payments: readonly FakeGatewayPaymentRow[];
  readonly sellers: readonly FakeGatewaySellerRow[];
  readonly payouts: readonly FakeGatewayPayoutRow[];
  readonly events: readonly FakeGatewayEventRow[];
}

export interface SettleOptions {
  /** false: rozliczenie bez webhooka (zaginiony webhook, test pollingu). */
  readonly deliver?: boolean;
  /**
   * true (job): obiekt już rozliczony tym samym wynikiem to ponowienie, a nie błąd; wysyłamy
   * wtedy ponownie jego zdarzenie. false (przycisk): rozliczony obiekt to konflikt.
   */
  readonly idempotent?: boolean;
  readonly reason?: PaymentFailureReason;
}

function conflict(message: string): PaymentGatewayError {
  return new PaymentGatewayError('INVALID_REQUEST', message);
}

function notFound(message: string): PaymentGatewayError {
  return new PaymentGatewayError('NOT_FOUND', message);
}

@Injectable()
export class FakeGatewaySimulator {
  private readonly logger = new Logger(FakeGatewaySimulator.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database<typeof fakeTables>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(FAKE_GATEWAY_SCHEDULE) private readonly schedule: FakeGatewaySchedule,
  ) {}

  /** Płatność dla testowej strony płatności i panelu. */
  async payment(id: string): Promise<FakeGatewayPaymentRow> {
    const [row] = await this.db
      .select()
      .from(fakeGatewayPayments)
      .where(eq(fakeGatewayPayments.id, id));
    if (row === undefined) {
      throw notFound(`Nieznana płatność ${id}`);
    }
    return row;
  }

  /** Najnowsze obiekty i webhooki (panel deweloperski). */
  async overview(): Promise<FakeGatewayOverview> {
    const [payments, sellers, payouts, events] = await Promise.all([
      this.db
        .select()
        .from(fakeGatewayPayments)
        .orderBy(desc(fakeGatewayPayments.createdAt))
        .limit(FAKE_OVERVIEW_LIMIT),
      this.db
        .select()
        .from(fakeGatewaySellers)
        .orderBy(desc(fakeGatewaySellers.createdAt))
        .limit(FAKE_OVERVIEW_LIMIT),
      this.db
        .select()
        .from(fakeGatewayPayouts)
        .orderBy(desc(fakeGatewayPayouts.createdAt))
        .limit(FAKE_OVERVIEW_LIMIT),
      this.db
        .select()
        .from(fakeGatewayEvents)
        .orderBy(desc(fakeGatewayEvents.createdAt), desc(fakeGatewayEvents.id))
        .limit(FAKE_OVERVIEW_LIMIT),
    ]);
    return { payments, sellers, payouts, events };
  }

  /**
   * Rozliczenie płatności w PENDING: udana dodaje część sprzedawcy do jego salda u operatora.
   * Zwraca rozliczoną płatność.
   */
  async settlePayment(
    id: string,
    outcome: FakePaymentOutcome,
    options: SettleOptions = {},
  ): Promise<FakeGatewayPaymentRow> {
    const { row, event } = await this.db.transaction(async (tx) => {
      const payment = await this.lockPayment(tx, id);
      if (payment.status !== 'PENDING') {
        if (options.idempotent === true && payment.status === outcome) {
          const type = outcome === 'SUCCEEDED' ? 'payment.completed' : 'payment.rejected';
          return { row: payment, event: await this.latestEvent(tx, payment.id, type) };
        }
        throw conflict(`Płatność ${id} jest już rozliczona (${payment.status})`);
      }
      const reason = outcome === 'FAILED' ? (options.reason ?? 'DECLINED') : null;
      const [updated] = await tx
        .update(fakeGatewayPayments)
        .set({
          status: outcome,
          failureReason: reason,
          settledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(fakeGatewayPayments.id, id))
        .returning();
      if (updated === undefined) {
        throw notFound(`Nieznana płatność ${id}`);
      }
      if (outcome === 'SUCCEEDED') {
        await this.addToBalance(tx, updated.sellerId, updated.sellerAmount);
      }
      const object = fakePaymentObject(updated);
      return {
        row: updated,
        event: await insertFakeEvent(
          tx,
          outcome === 'SUCCEEDED'
            ? { type: 'payment.completed', object }
            : {
                type: 'payment.rejected',
                object: { ...object, failure_code: object.failure_code ?? 'declined' },
              },
        ),
      };
    });
    await this.afterChange(event, options);
    return row;
  }

  /** Rozliczenie zwrotu: zwrot schodzi najpierw z części sprzedawcy (jego saldo u operatora). */
  async settleRefund(id: string, options: SettleOptions = { idempotent: true }): Promise<void> {
    const event = await this.db.transaction(async (tx) => {
      const [refund] = await tx
        .select()
        .from(fakeGatewayRefunds)
        .where(eq(fakeGatewayRefunds.id, id))
        .for('update');
      if (refund === undefined) {
        throw notFound(`Nieznany zwrot ${id}`);
      }
      if (refund.status !== 'PENDING') {
        return this.replayOrConflict(
          tx,
          refund.id,
          refund.status === 'SUCCEEDED',
          'refund.completed',
          options,
        );
      }
      const payment = await this.lockPayment(tx, refund.paymentId);
      const sellerShare = sellerShareOfRefund(
        payment.sellerAmount,
        payment.refundedAmount,
        refund.amount,
      );
      await tx
        .update(fakeGatewayRefunds)
        .set({ status: 'SUCCEEDED', updatedAt: new Date() })
        .where(eq(fakeGatewayRefunds.id, id));
      await tx
        .update(fakeGatewayPayments)
        .set({ refundedAmount: payment.refundedAmount + refund.amount, updatedAt: new Date() })
        .where(eq(fakeGatewayPayments.id, payment.id));
      // Saldo może zejść poniżej zera (zwrot po wypłacie): operator ściągnie je z kolejnych wpłat.
      await this.addToBalance(tx, payment.sellerId, -sellerShare);
      return insertFakeEvent(tx, {
        type: 'refund.completed',
        object: refundObject(refund),
      });
    });
    await this.afterChange(event, options);
  }

  /** Rozliczenie wypłaty: kwota zeszła z salda przy zleceniu, teraz wypłata jest wykonana. */
  async settlePayout(id: string, options: SettleOptions = { idempotent: true }): Promise<void> {
    const event = await this.db.transaction(async (tx) => {
      const payout = await this.lockPayout(tx, id);
      if (payout.status !== 'PENDING') {
        return this.replayOrConflict(
          tx,
          payout.id,
          payout.status === 'PAID',
          'payout.completed',
          options,
        );
      }
      await tx
        .update(fakeGatewayPayouts)
        .set({ status: 'PAID', updatedAt: new Date() })
        .where(eq(fakeGatewayPayouts.id, id));
      return insertFakeEvent(tx, { type: 'payout.completed', object: payoutObject(payout) });
    });
    await this.afterChange(event, options);
  }

  /** Odrzucona wypłata (np. zwrot przelewu z banku): kwota wraca na saldo sprzedawcy. */
  async failPayout(id: string): Promise<void> {
    const event = await this.db.transaction(async (tx) => {
      const payout = await this.lockPayout(tx, id);
      if (payout.status === 'FAILED') {
        throw conflict(`Wypłata ${id} jest już odrzucona`);
      }
      await tx
        .update(fakeGatewayPayouts)
        .set({ status: 'FAILED', updatedAt: new Date() })
        .where(eq(fakeGatewayPayouts.id, id));
      await this.addToBalance(tx, payout.sellerId, payout.amount);
      return insertFakeEvent(tx, { type: 'payout.rejected', object: payoutObject(payout) });
    });
    await this.afterChange(event, {});
  }

  /** Chargeback: otwarcie dla opłaconej płatności, potem zamknięcie wygrane albo przegrane. */
  async chargeback(
    paymentId: string,
    action: FakeChargebackAction,
  ): Promise<FakeGatewayPaymentRow> {
    const { row, event } = await this.db.transaction(async (tx) => {
      const payment = await this.lockPayment(tx, paymentId);
      if (action === 'OPEN') {
        if (payment.status !== 'SUCCEEDED' || payment.chargebackStatus !== null) {
          throw conflict('Chargeback można otworzyć raz, dla opłaconej płatności');
        }
      } else if (payment.chargebackStatus !== 'OPEN') {
        throw conflict('Zamknąć można tylko otwarty chargeback');
      }
      const chargebackId = payment.chargebackId ?? fakeId('fake_cb');
      const [updated] = await tx
        .update(fakeGatewayPayments)
        .set({ chargebackId, chargebackStatus: action, updatedAt: new Date() })
        .where(eq(fakeGatewayPayments.id, paymentId))
        .returning();
      const object = {
        id: chargebackId,
        payment_id: payment.id,
        amount: fakeAmount(paymentMoney(payment, payment.amount)),
      };
      return {
        row: updated ?? payment,
        event: await insertFakeEvent(
          tx,
          action === 'OPEN'
            ? { type: 'chargeback.opened', object }
            : {
                type: 'chargeback.closed',
                object: { ...object, outcome: action === 'WON' ? 'won' : 'lost' },
              },
        ),
      };
    });
    await this.afterChange(event, {});
    return row;
  }

  /** Zmiana statusu weryfikacji sprzedawcy (symulacja KYC). */
  async setSellerStatus(id: string, status: SellerStatus): Promise<FakeGatewaySellerRow> {
    const { row, event } = await this.db.transaction(async (tx) => {
      const [seller] = await tx
        .select()
        .from(fakeGatewaySellers)
        .where(eq(fakeGatewaySellers.id, id))
        .for('update');
      if (seller === undefined) {
        throw notFound(`Nieznany sprzedawca ${id}`);
      }
      if (seller.status === status) {
        throw conflict(`Sprzedawca ma już status ${status}`);
      }
      const [updated] = await tx
        .update(fakeGatewaySellers)
        .set({ status, updatedAt: new Date() })
        .where(eq(fakeGatewaySellers.id, id))
        .returning();
      return {
        row: updated ?? seller,
        event: await insertFakeEvent(tx, {
          type: 'seller.status_changed',
          object: { id, status: fakeSellerStatusCode(status) },
        }),
      };
    });
    await this.afterChange(event, {});
    return row;
  }

  /** Ponowne dostarczenie zdarzenia (pokaz idempotencji po naszej stronie). */
  async redeliver(eventId: string): Promise<void> {
    const [event] = await this.db
      .select({ id: fakeGatewayEvents.id })
      .from(fakeGatewayEvents)
      .where(eq(fakeGatewayEvents.id, eventId));
    if (event === undefined) {
      throw notFound(`Nieznane zdarzenie ${eventId}`);
    }
    await this.schedule.deliver(eventId, Date.now());
  }

  /**
   * Wysyła webhook HTTP na endpoint API i zapisuje wynik próby. Odpowiedź spoza 2xx albo błąd
   * sieci rzuca wyjątek: job ponowi wysyłkę z backoffem, jak prawdziwy operator.
   */
  async deliver(eventId: string): Promise<void> {
    const [event] = await this.db
      .select()
      .from(fakeGatewayEvents)
      .where(eq(fakeGatewayEvents.id, eventId));
    if (event === undefined) {
      throw notFound(`Nieznane zdarzenie ${eventId}`);
    }
    const body = JSON.stringify(event.body);
    const signature = signFakeWebhook(
      this.config.payments.fake.webhookSecret,
      body,
      Math.floor(Date.now() / 1000),
    );
    let failure: string | undefined;
    try {
      const response = await fetch(this.config.payments.fake.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [FAKE_SIGNATURE_HEADER]: signature },
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
      .update(fakeGatewayEvents)
      .set({
        attempts: event.attempts + 1,
        lastError: failure ?? null,
        ...(failure === undefined ? { deliveredAt: new Date() } : {}),
      })
      .where(eq(fakeGatewayEvents.id, eventId));
    if (failure !== undefined) {
      throw new Error(`Webhook ${event.type} (${eventId}) nie dotarł: ${failure}`);
    }
    this.logger.debug({ eventId, type: event.type }, 'Webhook FakeGateway dostarczony');
  }

  private async afterChange(
    event: FakeGatewayEventRow | undefined,
    options: SettleOptions,
  ): Promise<void> {
    if (event !== undefined && options.deliver !== false) {
      await this.schedule.deliver(event.id);
    }
  }

  private async replayOrConflict(
    tx: Transaction,
    objectId: string,
    sameOutcome: boolean,
    type: string,
    options: SettleOptions,
  ): Promise<FakeGatewayEventRow | undefined> {
    if (options.idempotent === true && sameOutcome) {
      return this.latestEvent(tx, objectId, type);
    }
    throw conflict(`Obiekt ${objectId} jest już rozliczony`);
  }

  private async latestEvent(
    tx: Transaction,
    objectId: string,
    type: string,
  ): Promise<FakeGatewayEventRow | undefined> {
    const rows = await tx
      .select()
      .from(fakeGatewayEvents)
      .where(eq(fakeGatewayEvents.objectId, objectId))
      .orderBy(desc(fakeGatewayEvents.createdAt));
    return rows.find((row) => row.type === type);
  }

  private async lockPayment(tx: Transaction, id: string): Promise<FakeGatewayPaymentRow> {
    const [row] = await tx
      .select()
      .from(fakeGatewayPayments)
      .where(eq(fakeGatewayPayments.id, id))
      .for('update');
    if (row === undefined) {
      throw notFound(`Nieznana płatność ${id}`);
    }
    return row;
  }

  private async lockPayout(tx: Transaction, id: string): Promise<FakeGatewayPayoutRow> {
    const [row] = await tx
      .select()
      .from(fakeGatewayPayouts)
      .where(eq(fakeGatewayPayouts.id, id))
      .for('update');
    if (row === undefined) {
      throw notFound(`Nieznana wypłata ${id}`);
    }
    return row;
  }

  private async addToBalance(tx: Transaction, sellerId: string, amount: number): Promise<void> {
    const [seller] = await tx
      .select({ balance: fakeGatewaySellers.balance })
      .from(fakeGatewaySellers)
      .where(eq(fakeGatewaySellers.id, sellerId))
      .for('update');
    if (seller === undefined) {
      throw notFound(`Nieznany sprzedawca ${sellerId}`);
    }
    await tx
      .update(fakeGatewaySellers)
      .set({ balance: seller.balance + amount, updatedAt: new Date() })
      .where(eq(fakeGatewaySellers.id, sellerId));
  }
}

function refundObject(refund: FakeGatewayRefundRow) {
  return {
    id: refund.id,
    payment_id: refund.paymentId,
    amount: fakeAmount({ amount: refund.amount, currency: refund.currency }),
  };
}

function payoutObject(payout: FakeGatewayPayoutRow) {
  return {
    id: payout.id,
    seller_id: payout.sellerId,
    amount: fakeAmount({ amount: payout.amount, currency: payout.currency }),
  };
}

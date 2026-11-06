// Przejścia zamówienia wokół płatności (F-25, PROJECT.md §6.8, §7.3, §7.4):
// - konsument PaymentSucceeded: AWAITING_PAYMENT → PAID z terminem nadania (5 dni roboczych)
//   i eventem OrderPaid, a udana płatność anulowanego albo już opłaconego zamówienia wraca do
//   kupującego pełnym zwrotem (LATE_PAYMENT, DUPLICATE_PAYMENT), bez strike'a;
// - job orders.expire-unpaid: AWAITING_PAYMENT → CANCELLED_UNPAID po terminie, z przedłużeniem
//   o 30 min dla płatności w toku założonej przed terminem, i event OrderCancelled.
// Obie ścieżki blokują wiersz zamówienia, więc wyścig rozstrzyga kolejność blokad: jeśli job był
// pierwszy, płatność jest spóźniona i wraca do kupującego. Zmiany stanu idą przez maszynę stanów
// (F-26, ../orders/order-records.ts), a opłacenie zapisuje płatność do zwrotów i zwolnienia.
import { businessDayDeadline, money } from '@biddy/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, lte } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import {
  type DomainEventContext,
  type DomainEventOf,
  OnDomainEvent,
  Outbox,
} from '../../../infra/outbox/index.js';
import { ScheduledJob } from '../../../infra/queues/index.js';
import { PaymentService, PaymentSucceeded, RefundService } from '../../payments/index.js';
import { ShipmentService } from '../../shipping/index.js';
import { orders } from '../db/orders.schema.js';
import { lockOrder, orderParties, transitionOrder } from '../orders/order-records.js';
import { OrderCancelled, OrderPaid } from '../orders.events.js';
import {
  effectivePaymentDeadline,
  SHIP_WITHIN_BUSINESS_DAYS,
  settlementFor,
} from './checkout-rules.js';

/** Zamówień sprawdzanych w jednym wykonaniu joba. */
const EXPIRE_BATCH = 100;

export interface ExpireReport {
  /** Zamówienia po terminie płatności sprawdzone w tym wykonaniu. */
  readonly checked: number;
  readonly cancelled: number;
}

@Injectable()
export class OrderPaymentLifecycle {
  private readonly logger = new Logger(OrderPaymentLifecycle.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly payments: PaymentService,
    private readonly refunds: RefundService,
    private readonly shipments: ShipmentService,
    private readonly outbox: Outbox,
  ) {}

  @OnDomainEvent(PaymentSucceeded, { consumer: 'orders.payment-succeeded' })
  async onPaymentSucceeded(
    event: DomainEventOf<typeof PaymentSucceeded>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const paymentId = event.aggregateId;
    const locked = await lockOrder(tx, event.payload.orderId);
    if (locked === undefined) {
      // Płatność bez zamówienia (np. testowa z panelu FakeGateway): nic do zmiany.
      this.logger.warn(
        { paymentId, orderId: event.payload.orderId },
        'Udana płatność dla nieznanego zamówienia',
      );
      return;
    }
    const { order, item } = locked;
    const settlement = settlementFor(order.status);
    if (settlement !== 'PAY') {
      const reason = settlement === 'REFUND_LATE' ? 'LATE_PAYMENT' : 'DUPLICATE_PAYMENT';
      await this.refunds.request(tx, {
        paymentId,
        reason,
        idempotencyKey: `refund:payment:${paymentId}:${reason.toLowerCase()}`,
      });
      this.logger.warn(
        { paymentId, orderId: order.id, status: order.status, reason },
        'Udana płatność zamówienia, które nie czeka na płatność: pełny zwrot',
      );
      return;
    }
    const { amount } = event.payload;
    if (amount.amount !== order.total || amount.currency !== order.currency) {
      // Płatność zakładamy zawsze na sumę zamówienia, a dostawy nie da się zmienić w trakcie
      // płatności: niezgodność to błąd, który wymaga zbadania (ponowienia, potem dead-letter).
      throw new Error(
        `Płatność ${paymentId}: ${amount.amount} ${amount.currency}, a zamówienie ${order.id} ma ${order.total} ${order.currency}`,
      );
    }
    const paidAt = new Date(event.occurredAt);
    const shipBy = businessDayDeadline(paidAt, SHIP_WITHIN_BUSINESS_DAYS);
    await transitionOrder(tx, order, 'PAID', { paidAt, shipBy, paymentId });
    await this.outbox.add(
      tx,
      OrderPaid.create({
        aggregateId: order.id,
        payload: {
          ...orderParties(order, item),
          total: money(order.total, order.currency),
          paidAt: paidAt.toISOString(),
          shipBy: shipBy.toISOString(),
        },
      }),
    );
  }

  @ScheduledJob({ queue: 'orders', name: 'orders.expire-unpaid', every: 60_000 })
  async run(): Promise<ExpireReport> {
    return this.expireUnpaid(new Date());
  }

  /** Jedno wykonanie: anulowanie nieopłaconych zamówień po terminie (`now`: chwila sprawdzenia). */
  async expireUnpaid(now: Date): Promise<ExpireReport> {
    const due = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.status, 'AWAITING_PAYMENT'), lte(orders.paymentDueAt, now)))
      .orderBy(asc(orders.paymentDueAt))
      .limit(EXPIRE_BATCH);
    let cancelled = 0;
    for (const { id } of due) {
      try {
        if (await this.expire(id, now)) {
          cancelled += 1;
        }
      } catch (error) {
        this.logger.error({ orderId: id, err: error }, 'Nie udało się anulować zamówienia');
      }
    }
    const report = { checked: due.length, cancelled };
    if (cancelled > 0) {
      this.logger.log(report, 'Anulowano nieopłacone zamówienia');
    }
    return report;
  }

  private async expire(orderId: string, now: Date): Promise<boolean> {
    const order = await this.db.transaction(async (tx) => {
      const locked = await lockOrder(tx, orderId);
      if (locked?.order.status !== 'AWAITING_PAYMENT') {
        return undefined;
      }
      const { order: current, item } = locked;
      const attempts = await this.payments.forOrder(current.id, tx);
      if (now.getTime() < effectivePaymentDeadline(current.paymentDueAt, attempts).getTime()) {
        return undefined;
      }
      const updated = await transitionOrder(
        tx,
        current,
        'CANCELLED_UNPAID',
        { cancelledAt: now },
        now,
      );
      await this.outbox.add(
        tx,
        OrderCancelled.create({
          aggregateId: current.id,
          payload: {
            ...orderParties(current, item),
            reason: 'UNPAID',
            paymentPending: attempts.some((attempt) => attempt.status === 'PENDING'),
            cancelledAt: now.toISOString(),
          },
        }),
      );
      return updated;
    });
    if (order === undefined) {
      return false;
    }
    // Wybrana dostawa (przesyłka PENDING, jeszcze bez przewoźnika) przestaje być potrzebna.
    const shipment = await this.shipments.forOrder(order.id);
    if (shipment?.shipment.status === 'PENDING') {
      await this.shipments.cancel(shipment.shipment.id);
    }
    return true;
  }
}

// Cykl życia zamówienia po opłaceniu (F-26, PROJECT.md §7.2–7.4, §7.9):
// - konsument ShipmentStatusChanged: PAID → SHIPPED (pierwszy status u przewoźnika), SHIPPED →
//   DELIVERED (okno 36 h od wykrycia odbioru), SHIPPED → NOT_PICKED_UP (zwrot nieodebranej),
//   a RETURNED nieodebranej zleca zwrot ceny i POK bez dostawy;
// - „Wszystko OK” i job orders.complete-inspected: DELIVERED → COMPLETED ze zwolnieniem środków;
//   otwarty chargeback wstrzymuje zakończenie;
// - job orders.expire-unshipped: PAID po terminie nadania → CANCELLED_NOT_SHIPPED z pełnym zwrotem
//   (strike sprzedającego nadaje konsument OrderCancelled, ../orders/order-standing-sources.ts);
// - zgłoszenie braku paczki: SHIPPED → LOST z pełnym zwrotem i reklamacją u przewoźnika;
//   rekompensata dla sprzedającego po rozstrzygnięciu reklamacji albo po 30 dniach (job);
// - konsument RefundSucceeded: CANCELLED_NOT_SHIPPED, LOST, NOT_PICKED_UP i DISPUTED → REFUNDED
//   (DISPUTED → PARTIALLY_REFUNDED po zwrocie części ceny, F-28) dopiero po potwierdzeniu zwrotu,
//   więc w stanie końcowym wstrzymane środki zamówienia wynoszą 0.
// Rozstrzygnięcie sporu (../lifecycle/order-disputes.ts) korzysta z `complete` i `compensate`.
// Każde przejście blokuje wiersz zamówienia i idzie przez maszynę stanów (../orders/order-records).
import { type Money, money } from '@biddy/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, isNull, lte, ne, or } from 'drizzle-orm';

import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import {
  type DomainEventContext,
  type DomainEventOf,
  OnDomainEvent,
  Outbox,
} from '../../../infra/outbox/index.js';
import { ScheduledJob } from '../../../infra/queues/index.js';
import {
  EscrowService,
  PaymentService,
  RefundService,
  RefundSucceeded,
} from '../../payments/index.js';
import {
  CarrierClaimResolved,
  CarrierClaimService,
  ShipmentService,
  ShipmentStatusChanged,
  TrackingSync,
} from '../../shipping/index.js';
import { type Order, orders } from '../db/orders.schema.js';
import {
  CARRIER_STATUSES,
  COMPENSATION_DUE_MS,
  inspectionEndsAt,
  notReceivedBlocker,
  notReceivedFrom,
  shipmentSteps,
} from '../domain/lifecycle-rules.js';
import {
  type LockedOrder,
  lockOrder,
  orderAmounts,
  orderParties,
  transitionOrder,
} from '../orders/order-records.js';
import { OrderService } from '../orders/order.service.js';
import {
  OrderCancelled,
  OrderCompleted,
  OrderDelivered,
  OrderLost,
  OrderNotPickedUp,
  OrderPartiallyRefunded,
  OrderRefunded,
  OrderShipped,
} from '../orders.events.js';

/** Zamówień sprawdzanych w jednym wykonaniu joba. */
const BATCH = 100;

/** Wynik jednego wykonania joba terminu. */
export interface DeadlineReport {
  readonly checked: number;
  readonly changed: number;
}

/**
 * Zwroty, po których zamówienie kończy się jako REFUNDED (zwrot częściowy w sporze:
 * PARTIALLY_REFUNDED), i stan, z którego wychodzi.
 */
const REFUND_SOURCES = {
  NOT_SHIPPED: 'CANCELLED_NOT_SHIPPED',
  NOT_PICKED_UP: 'NOT_PICKED_UP',
  LOST: 'LOST',
  DISPUTE: 'DISPUTED',
  DISPUTE_PARTIAL: 'DISPUTED',
} as const;

function isRefundSource(reason: string): reason is keyof typeof REFUND_SOURCES {
  return reason in REFUND_SOURCES;
}

@Injectable()
export class OrderLifecycle {
  private readonly logger = new Logger(OrderLifecycle.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly orders: OrderService,
    private readonly payments: PaymentService,
    private readonly refunds: RefundService,
    private readonly escrow: EscrowService,
    private readonly shipments: ShipmentService,
    private readonly tracking: TrackingSync,
    private readonly claims: CarrierClaimService,
    private readonly outbox: Outbox,
  ) {}

  // --- Przesyłka ---

  @OnDomainEvent(ShipmentStatusChanged, { consumer: 'orders.shipment-lifecycle' })
  async onShipmentStatusChanged(
    event: DomainEventOf<typeof ShipmentStatusChanged>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const { orderId, direction, status, returnReason } = event.payload;
    if (orderId === null || direction !== 'OUTBOUND') {
      return;
    }
    const locked = await lockOrder(tx, orderId);
    if (locked === undefined) {
      this.logger.warn({ orderId, shipmentId: event.aggregateId }, 'Przesyłka bez zamówienia');
      return;
    }
    const steps = shipmentSteps(locked.order.status, { status, returnReason });
    if (steps.length === 0) {
      if (CARRIER_STATUSES.has(status) && !['SHIPPED', 'DELIVERED'].includes(locked.order.status)) {
        this.logger.warn(
          { orderId, status, orderStatus: locked.order.status, returnReason },
          'Status przesyłki nie zmienia zamówienia: wymaga sprawdzenia przez support',
        );
      }
      return;
    }
    let current = locked;
    for (const step of steps) {
      current = await this.applyShipmentStep(tx, current, step, event);
    }
  }

  private async applyShipmentStep(
    tx: Transaction,
    { order, item }: LockedOrder,
    step: 'SHIP' | 'DELIVER' | 'NOT_PICKED_UP' | 'REFUND_RETURNED',
    event: DomainEventOf<typeof ShipmentStatusChanged>,
  ): Promise<LockedOrder> {
    const occurredAt = new Date(event.payload.occurredAt);
    const detectedAt = new Date(event.payload.detectedAt);
    const parties = orderParties(order, item);
    switch (step) {
      case 'SHIP': {
        const updated = await transitionOrder(tx, order, 'SHIPPED', { shippedAt: occurredAt });
        const shipment = await this.shipments.details(event.aggregateId);
        await this.outbox.add(
          tx,
          OrderShipped.create({
            aggregateId: order.id,
            payload: {
              ...parties,
              shippedAt: occurredAt.toISOString(),
              carrierName: shipment?.carrier.name ?? 'Przewoźnik',
              trackingNumber: shipment?.shipment.trackingNumber ?? null,
            },
          }),
        );
        return { order: updated, item };
      }
      case 'DELIVER': {
        const endsAt = inspectionEndsAt(detectedAt);
        const updated = await transitionOrder(tx, order, 'DELIVERED', {
          deliveredAt: occurredAt,
          inspectionEndsAt: endsAt,
        });
        await this.outbox.add(
          tx,
          OrderDelivered.create({
            aggregateId: order.id,
            payload: {
              ...parties,
              deliveredAt: occurredAt.toISOString(),
              inspectionEndsAt: endsAt.toISOString(),
            },
          }),
        );
        return { order: updated, item };
      }
      case 'NOT_PICKED_UP': {
        const updated = await transitionOrder(tx, order, 'NOT_PICKED_UP', {
          notPickedUpAt: occurredAt,
        });
        await this.outbox.add(
          tx,
          OrderNotPickedUp.create({
            aggregateId: order.id,
            payload: { ...parties, notPickedUpAt: occurredAt.toISOString() },
          }),
        );
        return { order: updated, item };
      }
      case 'REFUND_RETURNED': {
        // Paczka wróciła do sprzedającego: zwrot ceny i POK, dostawa zostaje w Biddy (§7.4).
        if (order.paymentId === null) {
          // Błąd danych (opłacenie zawsze zapisuje płatność): ponowienie nic nie zmieni.
          this.logger.error(
            { orderId: order.id },
            'Nieodebrana paczka wróciła, a zamówienie nie ma płatności',
          );
          return { order, item };
        }
        await this.refunds.request(tx, {
          paymentId: order.paymentId,
          reason: 'NOT_PICKED_UP',
          orderAmounts: orderAmounts(order),
          idempotencyKey: `refund:order:${order.id}:not-picked-up`,
        });
        return { order, item };
      }
    }
  }

  // --- Zwroty ---

  @OnDomainEvent(RefundSucceeded, { consumer: 'orders.refund-settled' })
  async onRefundSucceeded(
    event: DomainEventOf<typeof RefundSucceeded>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const { reason, orderId, amount } = event.payload;
    if (!isRefundSource(reason)) {
      return;
    }
    const locked = await lockOrder(tx, orderId);
    if (
      locked === undefined ||
      locked.order.status === 'REFUNDED' ||
      locked.order.status === 'PARTIALLY_REFUNDED'
    ) {
      return;
    }
    const { order, item } = locked;
    if (order.status !== REFUND_SOURCES[reason]) {
      this.logger.warn(
        { orderId, reason, status: order.status },
        'Zwrot potwierdzony dla zamówienia w nieoczekiwanym stanie',
      );
      return;
    }
    const refundedAt = new Date(event.occurredAt);
    if (reason === 'DISPUTE_PARTIAL') {
      await this.settlePartialRefund(tx, locked, amount, refundedAt);
      return;
    }
    await transitionOrder(tx, order, 'REFUNDED', { refundedAt });
    await this.outbox.add(
      tx,
      OrderRefunded.create({
        aggregateId: order.id,
        payload: {
          ...orderParties(order, item),
          refundedAt: refundedAt.toISOString(),
          amount,
          reason,
        },
      }),
    );
  }

  /**
   * Zwrot części ceny w sporze potwierdzony (F-28): PARTIALLY_REFUNDED i zwolnienie reszty ceny
   * u operatora. Ledger (ORDER_PARTIALLY_REFUNDED) zaksięgował zwrot razem z potwierdzeniem.
   */
  private async settlePartialRefund(
    tx: Transaction,
    { order, item }: LockedOrder,
    amount: Money,
    refundedAt: Date,
  ): Promise<void> {
    await transitionOrder(tx, order, 'PARTIALLY_REFUNDED', { refundedAt });
    const sellerAmount = money(order.itemsTotal - amount.amount, order.currency);
    if (sellerAmount.amount > 0) {
      await this.escrow.releaseRemainder(tx, {
        orderId: order.id,
        paymentId: requirePayment(order),
        amount: sellerAmount,
      });
    }
    await this.outbox.add(
      tx,
      OrderPartiallyRefunded.create({
        aggregateId: order.id,
        payload: {
          ...orderParties(order, item),
          refundedAt: refundedAt.toISOString(),
          amount,
          sellerAmount,
        },
      }),
    );
  }

  // --- Zakończenie ---

  /**
   * „Wszystko OK” kupującego. Ponowienie po zakończeniu zwraca zamówienie bez drugiego efektu.
   *
   * @throws {DomainError} NOT_FOUND (nie kupujący), ORDER_NOT_DELIVERED, ORDER_ON_HOLD
   */
  async confirmReceipt(idOrPublicId: string, userId: string): Promise<Order> {
    const { order: found } = await this.asBuyer(idOrPublicId, userId);
    return this.db.transaction(async (tx) => {
      const locked = await lockOrder(tx, found.id);
      if (locked === undefined) {
        throw notFound();
      }
      const { order } = locked;
      if (order.status === 'COMPLETED') {
        return order;
      }
      if (order.status !== 'DELIVERED') {
        throw new DomainError({ code: 'ORDER_NOT_DELIVERED' });
      }
      if (order.chargebackStatus === 'OPEN') {
        throw new DomainError({ code: 'ORDER_ON_HOLD' });
      }
      return this.complete(tx, locked, new Date(), true);
    });
  }

  @ScheduledJob({ queue: 'orders', name: 'orders.complete-inspected', every: 60_000 })
  async runCompleteInspected(): Promise<DeadlineReport> {
    return this.completeInspected(new Date());
  }

  /** Auto-zakończenie po oknie 36 h (`now`: chwila sprawdzenia). */
  async completeInspected(now: Date): Promise<DeadlineReport> {
    const due = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.status, 'DELIVERED'),
          lte(orders.inspectionEndsAt, now),
          or(isNull(orders.chargebackStatus), ne(orders.chargebackStatus, 'OPEN')),
        ),
      )
      .orderBy(asc(orders.inspectionEndsAt))
      .limit(BATCH);
    return this.each(due, 'Nie udało się zakończyć zamówienia', async (id) =>
      this.db.transaction(async (tx) => {
        const locked = await lockOrder(tx, id);
        const order = locked?.order;
        if (
          locked === undefined ||
          order?.status !== 'DELIVERED' ||
          order.chargebackStatus === 'OPEN' ||
          order.inspectionEndsAt === null ||
          order.inspectionEndsAt.getTime() > now.getTime()
        ) {
          return false;
        }
        await this.complete(tx, locked, now, false);
        return true;
      }),
    );
  }

  /**
   * Zakończenie zablokowanego zamówienia (DELIVERED albo DISPUTED po sporze na korzyść
   * sprzedającego, F-28): COMPLETED, zwolnienie środków i event OrderCompleted.
   */
  async complete(
    tx: Transaction,
    { order, item }: LockedOrder,
    now: Date,
    confirmedByBuyer: boolean,
  ): Promise<Order> {
    const updated = await transitionOrder(
      tx,
      order,
      'COMPLETED',
      { completedAt: now, ...(confirmedByBuyer ? { buyerConfirmedAt: now } : {}) },
      now,
    );
    await this.escrow.release(tx, {
      orderId: order.id,
      paymentId: requirePayment(order),
      sellerId: order.sellerId,
      amounts: orderAmounts(order),
    });
    await this.outbox.add(
      tx,
      OrderCompleted.create({
        aggregateId: order.id,
        payload: {
          ...orderParties(order, item),
          completedAt: now.toISOString(),
          confirmedByBuyer,
          itemsTotal: money(order.itemsTotal, order.currency),
        },
      }),
    );
    return updated;
  }

  // --- Nienadanie ---

  @ScheduledJob({ queue: 'orders', name: 'orders.expire-unshipped', every: 60_000 })
  async runExpireUnshipped(): Promise<DeadlineReport> {
    return this.expireUnshipped(new Date());
  }

  /** Anulowanie opłaconych zamówień po terminie nadania (`now`: chwila sprawdzenia). */
  async expireUnshipped(now: Date): Promise<DeadlineReport> {
    const due = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.status, 'PAID'), lte(orders.shipBy, now)))
      .orderBy(asc(orders.shipBy))
      .limit(BATCH);
    return this.each(due, 'Nie udało się anulować nienadanego zamówienia', async (id) =>
      this.cancelUnshipped(id, now),
    );
  }

  private async cancelUnshipped(orderId: string, now: Date): Promise<boolean> {
    if (!(await this.withdrawShipment(orderId))) {
      return false;
    }
    return this.db.transaction(async (tx) => {
      const locked = await lockOrder(tx, orderId);
      if (
        locked?.order.status !== 'PAID' ||
        locked.order.shipBy === null ||
        locked.order.shipBy.getTime() > now.getTime()
      ) {
        return false;
      }
      const { order, item } = locked;
      await transitionOrder(tx, order, 'CANCELLED_NOT_SHIPPED', { cancelledAt: now }, now);
      await this.refunds.request(tx, {
        paymentId: requirePayment(order),
        reason: 'NOT_SHIPPED',
        idempotencyKey: `refund:order:${order.id}:not-shipped`,
      });
      await this.outbox.add(
        tx,
        OrderCancelled.create({
          aggregateId: order.id,
          payload: {
            ...orderParties(order, item),
            reason: 'NOT_SHIPPED',
            paymentPending: false,
            cancelledAt: now.toISOString(),
          },
        }),
      );
      this.logger.log({ orderId: order.id }, 'Anulowano zamówienie nienadane w terminie');
      return true;
    });
  }

  /**
   * Przygotowana przesyłka nienadanego zamówienia: anulowanie (także u dostawcy). false, gdy paczka
   * jest już u przewoźnika (event nadania jest w drodze) albo przesyłka powstaje u dostawcy.
   */
  private async withdrawShipment(orderId: string): Promise<boolean> {
    let shipment = await this.shipments.forOrder(orderId);
    if (shipment?.shipment.status === 'CREATED') {
      // Paczka mogła zostać nadana przed chwilą: najpierw stan u dostawcy, potem decyzja.
      await this.tracking.sync(shipment.shipment.id);
      shipment = await this.shipments.forOrder(orderId);
    }
    if (shipment === undefined) {
      return true;
    }
    const { status } = shipment.shipment;
    if (CARRIER_STATUSES.has(status) || status === 'REQUESTED') {
      return false;
    }
    await this.shipments.cancel(shipment.shipment.id);
    return true;
  }

  // --- Zaginięcie ---

  /**
   * Zgłoszenie braku paczki (14 dni od nadania bez statusu końcowego): LOST, pełny zwrot
   * i reklamacja u przewoźnika. Ponowienie po zgłoszeniu zwraca zamówienie bez drugiego efektu.
   *
   * @throws {DomainError} NOT_FOUND, ORDER_NOT_SHIPPED_YET, NOT_RECEIVED_TOO_EARLY, SHIPMENT_FINISHED
   */
  async reportNotReceived(idOrPublicId: string, userId: string): Promise<Order> {
    const { order: found } = await this.asBuyer(idOrPublicId, userId);
    const shipment = await this.shipments.forOrder(found.id);
    const claim =
      shipment === undefined ? undefined : await this.claims.forShipment(shipment.shipment.id);
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const locked = await lockOrder(tx, found.id);
      if (locked === undefined) {
        throw notFound();
      }
      const { order, item } = locked;
      if (order.lostAt !== null) {
        return order;
      }
      const blocker = notReceivedBlocker(order, shipment?.shipment.status, now);
      if (blocker !== undefined) {
        throw new DomainError({
          code: blocker,
          ...(blocker === 'NOT_RECEIVED_TOO_EARLY' && order.shippedAt !== null
            ? { extensions: { availableAt: notReceivedFrom(order.shippedAt).toISOString() } }
            : {}),
        });
      }
      const updated = await transitionOrder(tx, order, 'LOST', { lostAt: now }, now);
      await this.refunds.request(tx, {
        paymentId: requirePayment(order),
        reason: 'LOST',
        idempotencyKey: `refund:order:${order.id}:lost`,
      });
      if (shipment !== undefined && claim === undefined) {
        await this.claims.open(
          {
            shipmentId: shipment.shipment.id,
            type: 'LOST',
            claimedAmount: order.itemsTotal,
            note: `Zgłoszenie kupującego: brak paczki (zamówienie ${order.publicId}).`,
          },
          tx,
        );
      }
      const compensation = money(order.itemsTotal, order.currency);
      await this.outbox.add(
        tx,
        OrderLost.create({
          aggregateId: order.id,
          payload: {
            ...orderParties(order, item),
            lostAt: now.toISOString(),
            compensation,
            compensationDueAt: new Date(now.getTime() + COMPENSATION_DUE_MS).toISOString(),
          },
        }),
      );
      this.logger.warn({ orderId: order.id }, 'Kupujący zgłosił zaginioną paczkę');
      return updated;
    });
  }

  /**
   * Rozstrzygnięta reklamacja: przy zaginięciu rekompensata (jeśli jeszcze nie), potem
   * rozliczenie. Reklamacje ze sporu (wina przewoźnika, F-28) mają rekompensatę od decyzji.
   */
  @OnDomainEvent(CarrierClaimResolved, { consumer: 'orders.lost-parcel-claim' })
  async onCarrierClaimResolved(
    event: DomainEventOf<typeof CarrierClaimResolved>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const { orderId, recovered } = event.payload;
    if (orderId === null) {
      return;
    }
    const locked = await lockOrder(tx, orderId);
    if (locked === undefined) {
      return;
    }
    const { order } = locked;
    if (order.lostAt !== null) {
      await this.compensate(tx, order, new Date());
    } else if (order.sellerCompensatedAt === null) {
      this.logger.warn(
        { orderId, claimId: event.aggregateId },
        'Reklamacja bez zgłoszenia zaginięcia i bez rekompensaty',
      );
      return;
    }
    const recoveredAmount = Math.min(recovered.amount, order.itemsTotal);
    await this.escrow.settleCarrierClaim(tx, {
      orderId: order.id,
      claimId: event.aggregateId,
      recovered: money(recoveredAmount, order.currency),
      unrecovered: money(order.itemsTotal - recoveredAmount, order.currency),
    });
  }

  @ScheduledJob({ queue: 'orders', name: 'orders.compensate-lost', every: 60 * 60_000 })
  async runCompensateLost(): Promise<DeadlineReport> {
    return this.compensateLost(new Date());
  }

  /** Rekompensaty 30 dni po zgłoszeniu zaginięcia, gdy reklamacja nadal trwa (`now`: chwila). */
  async compensateLost(now: Date): Promise<DeadlineReport> {
    const due = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          lte(orders.lostAt, new Date(now.getTime() - COMPENSATION_DUE_MS)),
          isNull(orders.sellerCompensatedAt),
        ),
      )
      .orderBy(asc(orders.lostAt))
      .limit(BATCH);
    return this.each(due, 'Nie udało się wypłacić rekompensaty', async (id) =>
      this.db.transaction(async (tx) => {
        const locked = await lockOrder(tx, id);
        if (locked === undefined || locked.order.sellerCompensatedAt !== null) {
          return false;
        }
        await this.compensate(tx, locked.order, now);
        return true;
      }),
    );
  }

  /**
   * Rekompensata dla sprzedającego = cena (§7.9): zaginięcie albo wina przewoźnika w sporze
   * (F-28). Idempotentna po zamówieniu (`seller_compensated_at`).
   */
  async compensate(tx: Transaction, order: Order, now: Date): Promise<void> {
    if (order.sellerCompensatedAt !== null) {
      return;
    }
    const payment = await this.payments.get(requirePayment(order));
    if (payment === undefined) {
      throw new Error(`Zamówienie ${order.id}: brak płatności ${order.paymentId ?? ''}`);
    }
    await this.escrow.compensateLostParcel(tx, {
      orderId: order.id,
      sellerId: order.sellerId,
      provider: payment.provider,
      amount: money(order.itemsTotal, order.currency),
    });
    await tx
      .update(orders)
      .set({ sellerCompensatedAt: now, updatedAt: now })
      .where(eq(orders.id, order.id));
  }

  // --- Wspólne ---

  private async asBuyer(idOrPublicId: string, userId: string) {
    const participant = await this.orders.forParticipant(idOrPublicId, userId);
    if (participant.role !== 'BUYER') {
      throw notFound();
    }
    return participant;
  }

  private async each(
    due: readonly { readonly id: string }[],
    failure: string,
    run: (id: string) => Promise<boolean>,
  ): Promise<DeadlineReport> {
    let changed = 0;
    for (const { id } of due) {
      try {
        if (await run(id)) {
          changed += 1;
        }
      } catch (error) {
        this.logger.error({ orderId: id, err: error }, failure);
      }
    }
    return { checked: due.length, changed };
  }
}

function notFound(): DomainError {
  return new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono zamówienia.' });
}

/** Płatność, która opłaciła zamówienie: bez niej nie ma czego zwracać ani zwalniać. */
export function requirePayment(order: Order): string {
  if (order.paymentId === null) {
    throw new Error(`Zamówienie ${order.id} (${order.status}) bez płatności`);
  }
  return order.paymentId;
}

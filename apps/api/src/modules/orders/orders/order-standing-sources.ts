// Zamówienia w stanie konta (F-61, PROJECT.md §4.1): historia do poziomów i strike'i kupującego.
// Moduł identity nie czyta tabel zamówień, więc konsumenci w module orders przekazują mu fakty
// przez publiczne API w transakcji obsługi eventu (idempotentnie: upsert i klucz źródła).
// - OrderPaid → historia (poziom „sprawdzony”);
// - OrderCancelled (UNPAID) → strike za brak płatności;
// - RefundRequested (LATE_PAYMENT) → cofnięcie tego strike'a (§6.8: spóźniona płatność wraca
//   bez strike'a);
// - ShipmentStatusChanged (RETURNING, NOT_COLLECTED, paczka do kupującego) → strike za
//   nieodebraną przesyłkę.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';

import type { Transaction } from '../../../infra/db/index.js';
import {
  type DomainEventContext,
  type DomainEventOf,
  OnDomainEvent,
} from '../../../infra/outbox/index.js';
import {
  LATE_PAYMENT_REVOKE_NOTE,
  StrikeService,
  strikeSourceKey,
  TradeHistoryService,
} from '../../identity/index.js';
import { RefundRequested } from '../../payments/index.js';
import { ShipmentStatusChanged } from '../../shipping/index.js';
import { orderItems, orders } from '../db/orders.schema.js';
import { OrderCancelled, OrderPaid } from '../orders.events.js';

@Injectable()
export class OrderStandingSources {
  private readonly logger = new Logger(OrderStandingSources.name);

  constructor(
    @Inject(StrikeService) private readonly strikes: StrikeService,
    @Inject(TradeHistoryService) private readonly trades: TradeHistoryService,
  ) {}

  @OnDomainEvent(OrderPaid, { consumer: 'orders.trade-history-paid' })
  async onOrderPaid(
    event: DomainEventOf<typeof OrderPaid>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const { buyerId, sellerId, paidAt } = event.payload;
    await this.trades.recordPaid(
      tx,
      { orderId: event.aggregateId, buyerId, sellerId },
      new Date(paidAt),
    );
  }

  @OnDomainEvent(OrderCancelled, { consumer: 'orders.strike-unpaid' })
  async onOrderCancelled(
    event: DomainEventOf<typeof OrderCancelled>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    if (event.payload.reason !== 'UNPAID') {
      return;
    }
    await this.strikes.issue(tx, {
      userId: event.payload.buyerId,
      reason: 'UNPAID',
      sourceKey: strikeSourceKey('UNPAID', event.aggregateId),
      orderId: event.aggregateId,
      auctionId: event.payload.auctionId,
      context: {
        orderPublicId: event.payload.publicId,
        ...(await this.titleOf(tx, event.aggregateId)),
      },
    });
  }

  @OnDomainEvent(RefundRequested, { consumer: 'orders.revoke-unpaid-strike' })
  async onRefundRequested(
    event: DomainEventOf<typeof RefundRequested>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    if (event.payload.reason !== 'LATE_PAYMENT') {
      return;
    }
    await this.strikes.revokeBySource(
      tx,
      strikeSourceKey('UNPAID', event.payload.orderId),
      LATE_PAYMENT_REVOKE_NOTE,
    );
  }

  @OnDomainEvent(ShipmentStatusChanged, { consumer: 'orders.strike-not-collected' })
  async onShipmentStatusChanged(
    event: DomainEventOf<typeof ShipmentStatusChanged>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const { orderId, status, direction, returnReason } = event.payload;
    if (
      orderId === null ||
      status !== 'RETURNING' ||
      direction !== 'OUTBOUND' ||
      returnReason !== 'NOT_COLLECTED'
    ) {
      return;
    }
    const [order] = await tx
      .select({ buyerId: orders.buyerId, publicId: orders.publicId })
      .from(orders)
      .where(eq(orders.id, orderId));
    if (order === undefined) {
      this.logger.warn({ orderId, shipmentId: event.aggregateId }, 'Zwrot paczki bez zamówienia');
      return;
    }
    await this.strikes.issue(tx, {
      userId: order.buyerId,
      reason: 'NOT_COLLECTED',
      sourceKey: strikeSourceKey('NOT_COLLECTED', orderId),
      orderId,
      context: { orderPublicId: order.publicId, ...(await this.titleOf(tx, orderId)) },
    });
  }

  /** Tytuł przedmiotu ze snapshotu (także nieaktywnej pozycji anulowanego zamówienia). */
  private async titleOf(tx: Transaction, orderId: string): Promise<{ title?: string }> {
    const [item] = await tx
      .select({ snapshot: orderItems.itemSnapshot })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.createdAt))
      .limit(1);
    return item === undefined ? {} : { title: item.snapshot.item.title };
  }
}

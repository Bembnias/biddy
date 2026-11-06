// Powiadomienia o etapach zamówienia (F-26, PROJECT.md §6.8, §7.2–7.4, §7.9): przypomnienia
// o płatności (1 h, 12 h i 20 h po utworzeniu zamówienia) i o nadaniu (24 h przed terminem) jako
// joby z terminem w ID, anulowanie, nadanie, odbiór, zakończenie, nieodebrana i zaginiona paczka,
// zwrot oraz oferty drugiej szansy. Joby sprawdzają stan zamówienia przy wykonaniu, a konsumenci
// zapisują powiadomienia z kluczem deduplikacji w transakcji obsługi eventu.
import { Inject, Injectable } from '@nestjs/common';

import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import {
  type DomainEventContext,
  type DomainEventOf,
  OnDomainEvent,
} from '../../../infra/outbox/index.js';
import { deadlineJobId, JobHandler, JobQueues, type JobRun } from '../../../infra/queues/index.js';
import { AuctionDirectory } from '../../auctions/index.js';
import {
  OrderCancelled,
  OrderCompleted,
  OrderCreated,
  OrderDelivered,
  OrderLost,
  OrderNotPickedUp,
  OrderPaid,
  OrderService,
  OrderShipped,
  PAYMENT_REMINDERS_AFTER_MS,
  SecondChanceOffered,
  SecondChanceOfferResolved,
  SHIP_REMINDER_BEFORE_MS,
} from '../../orders/index.js';
import { RefundSucceeded } from '../../payments/index.js';
import type { AuctionRef, NotificationPayload } from './notification-content.js';
import { type NotifyInput, NotificationService } from './notification.service.js';

export const PAYMENT_REMINDER_JOB = 'notifications.payment-reminder';
export const SHIP_REMINDER_JOB = 'notifications.ship-reminder';

interface PaymentReminderJob {
  readonly orderId: string;
  /** Numer przypomnienia: 1, 2 albo 3. */
  readonly n: number;
}

interface ShipReminderJob {
  readonly orderId: string;
}

@Injectable()
export class OrderNotificationSources {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(NotificationService) private readonly notifications: NotificationService,
    @Inject(AuctionDirectory) private readonly auctions: AuctionDirectory,
    @Inject(OrderService) private readonly orders: OrderService,
    private readonly jobs: JobQueues,
  ) {}

  // --- Przypomnienia ---

  /** Trzy przypomnienia o płatności: 1 h, 12 h i 20 h po utworzeniu zamówienia (§6.8). */
  @OnDomainEvent(OrderCreated, { consumer: 'notifications.payment-reminders' })
  async onOrderCreated(event: DomainEventOf<typeof OrderCreated>): Promise<void> {
    const createdAt = new Date(event.occurredAt).getTime();
    for (const [index, after] of PAYMENT_REMINDERS_AFTER_MS.entries()) {
      const runAt = new Date(createdAt + after);
      const n = index + 1;
      await this.jobs.add(
        'notifications',
        PAYMENT_REMINDER_JOB,
        { orderId: event.aggregateId, n } satisfies PaymentReminderJob,
        { jobId: deadlineJobId(`payment-reminder-${String(n)}`, event.aggregateId, runAt), runAt },
      );
    }
  }

  @JobHandler('notifications', PAYMENT_REMINDER_JOB)
  async paymentReminder(job: JobRun<PaymentReminderJob>): Promise<boolean> {
    const found = await this.orders.withAuction(job.data.orderId);
    const order = found?.order;
    if (
      found === undefined ||
      order?.status !== 'AWAITING_PAYMENT' ||
      order.paymentDueAt.getTime() <= Date.now()
    ) {
      return false;
    }
    return this.notifyOne(found.auctionId, {
      userId: order.buyerId,
      type: 'PAYMENT_REMINDER',
      dedupeKey: `PAYMENT_REMINDER:${order.id}:${String(job.data.n)}`,
      payload: {
        orderPublicId: order.publicId,
        total: { amount: order.itemsTotal + order.pokFee, currency: order.currency },
        paymentDueAt: order.paymentDueAt.toISOString(),
      },
    });
  }

  /** Przypomnienie o nadaniu na dobę przed terminem (gdy termin jest dalej niż doba). */
  @OnDomainEvent(OrderPaid, { consumer: 'notifications.ship-reminder-schedule' })
  async onOrderPaid(event: DomainEventOf<typeof OrderPaid>): Promise<void> {
    const runAt = new Date(new Date(event.payload.shipBy).getTime() - SHIP_REMINDER_BEFORE_MS);
    if (runAt.getTime() <= new Date(event.payload.paidAt).getTime()) {
      return;
    }
    await this.jobs.add(
      'notifications',
      SHIP_REMINDER_JOB,
      { orderId: event.aggregateId } satisfies ShipReminderJob,
      { jobId: deadlineJobId('ship-reminder', event.aggregateId, runAt), runAt },
    );
  }

  @JobHandler('notifications', SHIP_REMINDER_JOB)
  async shipReminder(job: JobRun<ShipReminderJob>): Promise<boolean> {
    const found = await this.orders.withAuction(job.data.orderId);
    const order = found?.order;
    if (found === undefined || order?.status !== 'PAID' || order.shipBy === null) {
      return false;
    }
    return this.notifyOne(found.auctionId, {
      userId: order.sellerId,
      type: 'SHIP_REMINDER',
      dedupeKey: `SHIP_REMINDER:${order.id}`,
      payload: { orderPublicId: order.publicId, shipBy: order.shipBy.toISOString() },
    });
  }

  // --- Etapy zamówienia ---

  @OnDomainEvent(OrderCancelled, { consumer: 'notifications.order-cancelled' })
  async onOrderCancelled(
    event: DomainEventOf<typeof OrderCancelled>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const { reason, buyerId, sellerId, publicId, auctionId } = event.payload;
    const dedupeKey = `ORDER_CANCELLED:${event.aggregateId}`;
    const payload = { orderPublicId: publicId, cancelReason: reason };
    // Kupujący bez płatności dostaje powiadomienie o strike'u (F-61) z tym samym uzasadnieniem.
    await this.notifyAll(tx, auctionId, [
      {
        userId: sellerId,
        type: 'ORDER_CANCELLED',
        dedupeKey,
        payload: { ...payload, recipientRole: 'SELLER' },
      },
      ...(reason === 'NOT_SHIPPED'
        ? [
            {
              userId: buyerId,
              type: 'ORDER_CANCELLED' as const,
              dedupeKey,
              payload: { ...payload, recipientRole: 'BUYER' as const },
            },
          ]
        : []),
    ]);
  }

  @OnDomainEvent(OrderShipped, { consumer: 'notifications.order-shipped' })
  async onOrderShipped(
    event: DomainEventOf<typeof OrderShipped>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const { buyerId, publicId, auctionId, carrierName, trackingNumber } = event.payload;
    await this.notifyAll(tx, auctionId, [
      {
        userId: buyerId,
        type: 'ORDER_SHIPPED',
        dedupeKey: `ORDER_SHIPPED:${event.aggregateId}`,
        payload: { orderPublicId: publicId, carrierName, trackingNumber },
      },
    ]);
  }

  @OnDomainEvent(OrderDelivered, { consumer: 'notifications.order-delivered' })
  async onOrderDelivered(
    event: DomainEventOf<typeof OrderDelivered>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const { buyerId, publicId, auctionId, inspectionEndsAt } = event.payload;
    await this.notifyAll(tx, auctionId, [
      {
        userId: buyerId,
        type: 'ORDER_DELIVERED',
        dedupeKey: `ORDER_DELIVERED:${event.aggregateId}`,
        payload: { orderPublicId: publicId, inspectionEndsAt },
      },
    ]);
  }

  @OnDomainEvent(OrderCompleted, { consumer: 'notifications.order-completed' })
  async onOrderCompleted(
    event: DomainEventOf<typeof OrderCompleted>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const { sellerId, publicId, auctionId, itemsTotal } = event.payload;
    await this.notifyAll(tx, auctionId, [
      {
        userId: sellerId,
        type: 'ORDER_COMPLETED',
        dedupeKey: `ORDER_COMPLETED:${event.aggregateId}`,
        payload: { orderPublicId: publicId, itemsTotal },
      },
    ]);
  }

  @OnDomainEvent(OrderNotPickedUp, { consumer: 'notifications.order-not-picked-up' })
  async onOrderNotPickedUp(
    event: DomainEventOf<typeof OrderNotPickedUp>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const { sellerId, publicId, auctionId } = event.payload;
    await this.notifyAll(tx, auctionId, [
      {
        userId: sellerId,
        type: 'ORDER_NOT_PICKED_UP',
        dedupeKey: `ORDER_NOT_PICKED_UP:${event.aggregateId}`,
        payload: { orderPublicId: publicId },
      },
    ]);
  }

  @OnDomainEvent(OrderLost, { consumer: 'notifications.order-lost' })
  async onOrderLost(
    event: DomainEventOf<typeof OrderLost>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const { sellerId, publicId, auctionId, compensation, compensationDueAt } = event.payload;
    await this.notifyAll(tx, auctionId, [
      {
        userId: sellerId,
        type: 'ORDER_LOST',
        dedupeKey: `ORDER_LOST:${event.aggregateId}`,
        payload: { orderPublicId: publicId, compensation, compensationDueAt },
      },
    ]);
  }

  /** Każdy potwierdzony zwrot, także spóźnionej i zdublowanej płatności (F-25). */
  @OnDomainEvent(RefundSucceeded, { consumer: 'notifications.order-refunded' })
  async onRefundSucceeded(
    event: DomainEventOf<typeof RefundSucceeded>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const found = await this.orders.withAuction(event.payload.orderId);
    if (found === undefined) {
      return;
    }
    await this.notifyAll(tx, found.auctionId, [
      {
        userId: event.payload.buyerId,
        type: 'ORDER_REFUNDED',
        dedupeKey: `ORDER_REFUNDED:${event.aggregateId}`,
        payload: {
          orderPublicId: found.order.publicId,
          refund: event.payload.amount,
          refundReason: event.payload.reason,
        },
      },
    ]);
  }

  // --- Druga szansa ---

  @OnDomainEvent(SecondChanceOffered, { consumer: 'notifications.second-chance-offer' })
  async onSecondChanceOffered(
    event: DomainEventOf<typeof SecondChanceOffered>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const { bidderId, auctionId, amount, expiresAt } = event.payload;
    await this.notifyAll(tx, auctionId, [
      {
        userId: bidderId,
        type: 'SECOND_CHANCE_OFFER',
        dedupeKey: `SECOND_CHANCE_OFFER:${event.aggregateId}`,
        payload: { offerId: event.aggregateId, price: amount, expiresAt },
      },
    ]);
  }

  @OnDomainEvent(SecondChanceOfferResolved, { consumer: 'notifications.second-chance-answered' })
  async onSecondChanceOfferResolved(
    event: DomainEventOf<typeof SecondChanceOfferResolved>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const { sellerId, auctionId, amount, status, orderPublicId, sourceOrderId } = event.payload;
    const source = await this.orders.byId(sourceOrderId);
    const accepted =
      orderPublicId === null
        ? undefined
        : await this.orders.forParticipant(orderPublicId, sellerId);
    await this.notifyAll(tx, auctionId, [
      {
        userId: sellerId,
        type: 'SECOND_CHANCE_ANSWERED',
        dedupeKey: `SECOND_CHANCE_ANSWERED:${event.aggregateId}`,
        payload: {
          offerId: event.aggregateId,
          offerStatus: status,
          price: amount,
          orderPublicId: orderPublicId ?? source?.publicId ?? '',
          ...(accepted === undefined
            ? {}
            : { paymentDueAt: accepted.order.paymentDueAt.toISOString() }),
        },
      },
    ]);
  }

  // --- Wspólne ---

  private async notifyAll(
    tx: Transaction,
    auctionId: string,
    inputs: readonly (Omit<NotifyInput, 'auctionId' | 'payload'> & {
      readonly payload: Omit<NotificationPayload, 'auction'>;
    })[],
  ): Promise<void> {
    const notice = await this.auctions.notice(auctionId, tx);
    if (notice === undefined) {
      return;
    }
    const auction: AuctionRef = {
      id: notice.id,
      publicId: notice.publicId,
      slug: notice.slug,
      title: notice.title,
    };
    await this.notifications.notify(
      tx,
      inputs.map((input) => ({
        ...input,
        auctionId: notice.id,
        payload: { ...input.payload, auction },
      })),
    );
  }

  /** Powiadomienie z joba (we własnej transakcji). */
  private async notifyOne(
    auctionId: string,
    input: Omit<NotifyInput, 'auctionId' | 'payload'> & {
      readonly payload: Omit<NotificationPayload, 'auction'>;
    },
  ): Promise<boolean> {
    await this.db.transaction(async (tx) => this.notifyAll(tx, auctionId, [input]));
    return true;
  }
}

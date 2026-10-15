// Zamówienia (F-16): utworzenie zamówienia dla sprzedanej aukcji w transakcji jej zakończenia
// (moduł auctions przekazuje `tx`), z POK według cennika z chwili zakończenia (F-13) i terminem
// płatności 24 h (§6.8). Przejścia stanów, checkout i terminy: F-25, F-26.
import { type CurrencyCode, money } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { type Database, DRIZZLE, newPublicId, type Transaction } from '../../../infra/db/index.js';
import { Outbox } from '../../../infra/outbox/index.js';
import { FeeScheduleService } from '../../payments/index.js';
import { type Order, orderItems, orders } from '../db/orders.schema.js';
import { OrderCreated } from '../orders.events.js';
import type { OrderItemSnapshot } from './order-snapshot.js';

/** Termin płatności zwycięzcy (§6.8). */
export const PAYMENT_WINDOW_MS = 24 * 60 * 60 * 1_000;

/** Sprzedana aukcja, z której powstaje zamówienie. */
export interface AuctionSale {
  readonly auctionId: string;
  readonly buyerId: string;
  readonly sellerId: string;
  readonly currency: CurrencyCode;
  /** Wylicytowana kwota (albo cena Kup teraz) w groszach. */
  readonly hammerPrice: number;
  readonly endedAt: Date;
  readonly snapshot: OrderItemSnapshot;
}

@Injectable()
export class OrderService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(FeeScheduleService) private readonly fees: FeeScheduleService,
    private readonly outbox: Outbox,
  ) {}

  /** Aktywne zamówienie sprzedanej aukcji albo undefined (strona aukcji, F-18). */
  async activeForAuction(auctionId: string): Promise<Order | undefined> {
    const [row] = await this.db
      .select({ order: orders })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(eq(orderItems.auctionId, auctionId), eq(orderItems.isActive, true)));
    return row?.order;
  }

  /**
   * Zamówienie AWAITING_PAYMENT dla sprzedanej aukcji, w transakcji wywołującego. Drugie aktywne
   * zamówienie dla tej samej aukcji odrzuca unikalny indeks częściowy na `order_items`.
   */
  async createForAuction(tx: Transaction, sale: AuctionSale): Promise<Order> {
    const quote = await this.fees.quote(money(sale.hammerPrice, sale.currency), sale.endedAt);
    const paymentDueAt = new Date(sale.endedAt.getTime() + PAYMENT_WINDOW_MS);
    const order = await this.insertOrder(tx, {
      buyerId: sale.buyerId,
      sellerId: sale.sellerId,
      currency: sale.currency,
      itemsTotal: sale.hammerPrice,
      pokFee: quote.fee.amount,
      pokVat: quote.vat.amount,
      total: quote.total.amount,
      feeScheduleId: quote.feeScheduleId,
      paymentDueAt,
    });
    await tx.insert(orderItems).values({
      orderId: order.id,
      auctionId: sale.auctionId,
      hammerPrice: sale.hammerPrice,
      itemSnapshot: sale.snapshot,
    });
    await this.outbox.add(
      tx,
      OrderCreated.create({
        aggregateId: order.id,
        payload: {
          publicId: order.publicId,
          auctionId: sale.auctionId,
          buyerId: sale.buyerId,
          sellerId: sale.sellerId,
          itemsTotal: money(order.itemsTotal, order.currency),
          pokFee: money(order.pokFee, order.currency),
          total: money(order.total, order.currency),
          paymentDueAt: paymentDueAt.toISOString(),
        },
      }),
    );
    return order;
  }

  private async insertOrder(
    tx: Transaction,
    values: Omit<typeof orders.$inferInsert, 'id' | 'publicId'>,
  ): Promise<Order> {
    // Kolizja 8-znakowego numeru jest skrajnie mało prawdopodobna; ponawiamy kilka razy.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const [order] = await tx
        .insert(orders)
        .values({ ...values, publicId: newPublicId() })
        .onConflictDoNothing({ target: orders.publicId })
        .returning();
      if (order !== undefined) {
        return order;
      }
    }
    throw new Error('Nie udało się nadać unikalnego numeru zamówienia');
  }
}

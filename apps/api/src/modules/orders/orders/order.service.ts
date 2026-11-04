// Zamówienia (F-16): utworzenie zamówienia dla sprzedanej aukcji w transakcji jej zakończenia
// (moduł auctions przekazuje `tx`), z POK według cennika z chwili zakończenia (F-13) i terminem
// płatności 24 h (§6.8), oraz zamówienia z przyjętej oferty drugiej szansy (F-26). Checkout,
// opłacenie i anulowanie nieopłaconych: F-25 (../checkout); cykl życia: F-26 (../lifecycle).
import { type CurrencyCode, money, PUBLIC_ID_PATTERN } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, or, type SQL } from 'drizzle-orm';

import { type Database, DRIZZLE, newPublicId, type Transaction } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { Outbox } from '../../../infra/outbox/index.js';
import { FeeScheduleService } from '../../payments/index.js';
import { type Order, orderItems, orders, type RunnerUp } from '../db/orders.schema.js';
import { OrderCreated } from '../orders.events.js';
import type { OrderItemSnapshot } from './order-snapshot.js';

/** Termin płatności zwycięzcy (§6.8). */
export const PAYMENT_WINDOW_MS = 24 * 60 * 60 * 1_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Warunek na zamówienie po UUID albo numerze; undefined dla innego tekstu. */
function referenceCondition(idOrPublicId: string): SQL | undefined {
  return UUID.test(idOrPublicId)
    ? eq(orders.id, idOrPublicId)
    : PUBLIC_ID_PATTERN.test(idOrPublicId)
      ? eq(orders.publicId, idOrPublicId)
      : undefined;
}

/** Strona zamówienia z perspektywy zalogowanego użytkownika. */
export type OrderRole = 'BUYER' | 'SELLER';

/** Zamówienie z pozycją (snapshot przedmiotu) i rolą oglądającego. */
export interface ParticipantOrder {
  readonly order: Order;
  readonly role: OrderRole;
  readonly snapshot: OrderItemSnapshot;
}

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
  /** Pozostali licytujący z najwyższymi ofertami maksymalnymi: kandydaci do drugiej szansy. */
  readonly runnerUps: readonly RunnerUp[];
}

/** Przyjęta oferta drugiej szansy, z której powstaje nowe zamówienie (F-26). */
export interface SecondChanceSale {
  readonly offerId: string;
  readonly auctionId: string;
  readonly buyerId: string;
  readonly sellerId: string;
  readonly currency: CurrencyCode;
  readonly price: number;
  readonly acceptedAt: Date;
  readonly snapshot: OrderItemSnapshot;
  readonly runnerUps: readonly RunnerUp[];
}

@Injectable()
export class OrderService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(FeeScheduleService) private readonly fees: FeeScheduleService,
    private readonly outbox: Outbox,
  ) {}

  async byId(orderId: string): Promise<Order | undefined> {
    const [order] = await this.db.select().from(orders).where(eq(orders.id, orderId));
    return order;
  }

  /** Zamówienie z jego aukcją (powiadomienia o zwrotach i drugiej szansie, F-26). */
  async withAuction(
    orderId: string,
  ): Promise<{ readonly order: Order; readonly auctionId: string } | undefined> {
    const [row] = await this.db
      .select({ order: orders, auctionId: orderItems.auctionId })
      .from(orders)
      .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
      .where(eq(orders.id, orderId))
      .limit(1);
    return row;
  }

  /** Aktywne zamówienia sprzedanych aukcji według aukcji (listy Moje Biddy, F-21). */
  async activeForAuctions(auctionIds: readonly string[]): Promise<Map<string, Order>> {
    if (auctionIds.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .select({ auctionId: orderItems.auctionId, order: orders })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(
        and(inArray(orderItems.auctionId, [...new Set(auctionIds)]), eq(orderItems.isActive, true)),
      );
    return new Map(rows.map((row) => [row.auctionId, row.order]));
  }

  /**
   * Najnowsze zamówienie kupującego dla każdej z aukcji (Moje Biddy → Wygrane, F-26): zwycięzca,
   * który nie zapłacił, widzi swoje anulowane zamówienie, a nie zamówienie z drugiej szansy.
   */
  async latestForBuyer(
    buyerId: string,
    auctionIds: readonly string[],
  ): Promise<Map<string, Order>> {
    if (auctionIds.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .select({ auctionId: orderItems.auctionId, order: orders })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(
        and(inArray(orderItems.auctionId, [...new Set(auctionIds)]), eq(orders.buyerId, buyerId)),
      )
      .orderBy(desc(orders.createdAt));
    const latest = new Map<string, Order>();
    for (const row of rows) {
      if (!latest.has(row.auctionId)) {
        latest.set(row.auctionId, row.order);
      }
    }
    return latest;
  }

  /**
   * Najnowsze zamówienie każdej pary (aukcja, kupujący): kontekst rozmów (F-29). Klucz mapy:
   * `{auctionId}:{buyerId}`.
   */
  async latestForPairs(
    pairs: readonly { readonly auctionId: string; readonly buyerId: string }[],
  ): Promise<Map<string, Order>> {
    if (pairs.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .select({ auctionId: orderItems.auctionId, order: orders })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(
        or(
          ...pairs.map((pair) =>
            and(eq(orderItems.auctionId, pair.auctionId), eq(orders.buyerId, pair.buyerId)),
          ),
        ),
      )
      .orderBy(desc(orders.createdAt));
    const latest = new Map<string, Order>();
    for (const row of rows) {
      const key = `${row.auctionId}:${row.order.buyerId}`;
      if (!latest.has(key)) {
        latest.set(key, row.order);
      }
    }
    return latest;
  }

  /** Zamówienie po UUID albo numerze z jego aukcją, bez sprawdzania stron (personel, F-29). */
  async byReference(
    idOrPublicId: string,
  ): Promise<{ readonly order: Order; readonly auctionId: string } | undefined> {
    const condition = referenceCondition(idOrPublicId);
    if (condition === undefined) {
      return undefined;
    }
    const [row] = await this.db
      .select({ order: orders, auctionId: orderItems.auctionId })
      .from(orders)
      .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
      .where(condition)
      .limit(1);
    return row;
  }

  /** Aukcje kupione z drugiej szansy (kupujący nie był zwycięzcą aukcji, Moje Biddy, F-26). */
  async secondChanceAuctions(buyerId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ auctionId: orderItems.auctionId })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(eq(orders.buyerId, buyerId), isNotNull(orders.secondChanceOfferId)));
    return rows.map((row) => row.auctionId);
  }

  /**
   * Zamówienie po UUID albo numerze (`publicId`) dla jego kupującego albo sprzedającego.
   * Inni dostają 404, tak jak dla nieistniejącego zamówienia (bez ujawniania numerów).
   */
  async forParticipant(idOrPublicId: string, userId: string): Promise<ParticipantOrder> {
    const condition = referenceCondition(idOrPublicId);
    const [row] =
      condition === undefined
        ? []
        : await this.db
            .select({ order: orders, snapshot: orderItems.itemSnapshot })
            .from(orders)
            .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
            .where(condition)
            .limit(1);
    const role: OrderRole | undefined =
      row === undefined
        ? undefined
        : row.order.buyerId === userId
          ? 'BUYER'
          : row.order.sellerId === userId
            ? 'SELLER'
            : undefined;
    if (row === undefined || role === undefined) {
      throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono zamówienia.' });
    }
    return { order: row.order, role, snapshot: row.snapshot };
  }

  /**
   * Zamówienie AWAITING_PAYMENT dla sprzedanej aukcji, w transakcji wywołującego. Drugie aktywne
   * zamówienie dla tej samej aukcji odrzuca unikalny indeks częściowy na `order_items`.
   */
  async createForAuction(tx: Transaction, sale: AuctionSale): Promise<Order> {
    return this.create(tx, {
      auctionId: sale.auctionId,
      buyerId: sale.buyerId,
      sellerId: sale.sellerId,
      currency: sale.currency,
      price: sale.hammerPrice,
      at: sale.endedAt,
      snapshot: sale.snapshot,
      runnerUps: sale.runnerUps,
    });
  }

  /**
   * Zamówienie AWAITING_PAYMENT z przyjętej oferty drugiej szansy (§6.8): POK od ceny oferty według
   * cennika z chwili akceptacji, termin płatności 24 h. Wywołujący dezaktywuje wcześniej poprzednie
   * zamówienie aukcji (unikalny indeks aktywnej pozycji).
   */
  async createForSecondChance(tx: Transaction, sale: SecondChanceSale): Promise<Order> {
    return this.create(tx, {
      auctionId: sale.auctionId,
      buyerId: sale.buyerId,
      sellerId: sale.sellerId,
      currency: sale.currency,
      price: sale.price,
      at: sale.acceptedAt,
      snapshot: sale.snapshot,
      runnerUps: sale.runnerUps,
      secondChanceOfferId: sale.offerId,
    });
  }

  private async create(
    tx: Transaction,
    sale: {
      readonly auctionId: string;
      readonly buyerId: string;
      readonly sellerId: string;
      readonly currency: CurrencyCode;
      readonly price: number;
      /** Chwila sprzedaży: cennik POK i początek terminu płatności. */
      readonly at: Date;
      readonly snapshot: OrderItemSnapshot;
      readonly runnerUps: readonly RunnerUp[];
      readonly secondChanceOfferId?: string;
    },
  ): Promise<Order> {
    const quote = await this.fees.quote(money(sale.price, sale.currency), sale.at);
    const paymentDueAt = new Date(sale.at.getTime() + PAYMENT_WINDOW_MS);
    const order = await this.insertOrder(tx, {
      buyerId: sale.buyerId,
      sellerId: sale.sellerId,
      currency: sale.currency,
      itemsTotal: sale.price,
      pokFee: quote.fee.amount,
      pokVat: quote.vat.amount,
      total: quote.total.amount,
      feeScheduleId: quote.feeScheduleId,
      paymentDueAt,
      secondChanceOfferId: sale.secondChanceOfferId ?? null,
    });
    await tx.insert(orderItems).values({
      orderId: order.id,
      auctionId: sale.auctionId,
      hammerPrice: sale.price,
      itemSnapshot: sale.snapshot,
      runnerUps: [...sale.runnerUps],
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
          ...(sale.secondChanceOfferId === undefined
            ? {}
            : { secondChanceOfferId: sale.secondChanceOfferId }),
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

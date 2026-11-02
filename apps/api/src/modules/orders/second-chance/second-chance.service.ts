// Oferta drugiej szansy (F-26, PROJECT.md §6.8): po braku płatności sprzedający proponuje
// przedmiot kolejnemu licytującemu za jego maksimum. Kandydaci to `order_items.runner_ups`
// z chwili zakończenia aukcji; oferta trafia zawsze do pierwszego, który nie dostał jeszcze
// oferty ani nie kupował. Wysłanie blokuje wiersz anulowanego zamówienia (jedna oferta naraz),
// a akceptacja w jednej transakcji dezaktywuje poprzednie zamówienie aukcji i tworzy nowe.
import { anonymizeName, type Money, money } from '@biddy/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, lte } from 'drizzle-orm';

import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { Outbox } from '../../../infra/outbox/index.js';
import { ScheduledJob } from '../../../infra/queues/index.js';
import { AccountBlockService, accountBlockedError, ProfileService } from '../../identity/index.js';
import { FeeScheduleService } from '../../payments/index.js';
import {
  type Order,
  type OrderItem,
  orderItems,
  orders,
  type SecondChanceOffer,
  secondChanceOffers,
} from '../db/orders.schema.js';
import {
  nextRunnerUp,
  SECOND_CHANCE_VALIDITY_MS,
  type SecondChanceBlocker,
  secondChanceBlocker,
  secondChanceSendBy,
} from '../domain/lifecycle-rules.js';
import { lockOrder } from '../orders/order-records.js';
import type { OrderItemSnapshot } from '../orders/order-snapshot.js';
import { OrderService } from '../orders/order.service.js';
import { SecondChanceOffered, SecondChanceOfferResolved } from '../orders.events.js';

/** Ofert wygaszanych w jednym wykonaniu joba. */
const EXPIRE_BATCH = 100;

const BLOCKER_DETAILS: Readonly<Record<SecondChanceBlocker, string>> = {
  NOT_CANCELLED_UNPAID: 'Drugą szansę można wysłać tylko po anulowaniu nieopłaconego zamówienia.',
  NOT_LATEST_ORDER: 'Ta aukcja ma już nowsze zamówienie.',
  OFFER_PENDING: 'Poprzednia oferta drugiej szansy czeka jeszcze na odpowiedź.',
  WINDOW_PASSED: 'Termin na wysłanie oferty drugiej szansy minął.',
  NO_CANDIDATES: 'Nie ma już kolejnych licytujących.',
};

/** Wysłana oferta w widoku sprzedającego (licytujący zanonimizowany). */
export interface SecondChanceOfferSummary {
  readonly offer: SecondChanceOffer;
  readonly bidder: string;
  readonly orderPublicId: string | null;
}

/** Druga szansa anulowanego zamówienia w widoku sprzedającego. */
export interface SecondChanceState {
  /** Następny kandydat (zanonimizowana nazwa i jego maksimum) albo null. */
  readonly next: { readonly bidder: string; readonly amount: Money } | null;
  readonly offers: readonly SecondChanceOfferSummary[];
  /** Dlaczego nie można teraz wysłać oferty (undefined: można). */
  readonly blocker: SecondChanceBlocker | undefined;
  /** Termin wysłania oferty (14 dni od anulowania). */
  readonly sendBy: Date | null;
}

/** Oferta w widoku licytującego: przedmiot, kwoty bez dostawy i zamówienie po akceptacji. */
export interface BidderOfferView {
  readonly offer: SecondChanceOffer;
  readonly snapshot: OrderItemSnapshot;
  readonly pokFee: Money;
  /** Do zapłaty bez dostawy: cena + POK. */
  readonly total: Money;
  readonly orderPublicId: string | null;
}

function notFound(): DomainError {
  return new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono oferty.' });
}

function closed(): DomainError {
  return new DomainError({ code: 'SECOND_CHANCE_CLOSED' });
}

@Injectable()
export class SecondChanceService {
  private readonly logger = new Logger(SecondChanceService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly orders: OrderService,
    private readonly fees: FeeScheduleService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject(AccountBlockService) private readonly blocks: AccountBlockService,
    private readonly outbox: Outbox,
  ) {}

  /** Stan drugiej szansy dla sprzedającego (strona zamówienia). */
  async state(order: Order, item: OrderItem, now: Date = new Date()): Promise<SecondChanceState> {
    const context = await this.context(this.db, order, item, now);
    const names = await this.profiles.displayNames([
      ...context.offers.map((offer) => offer.bidderId),
      ...(context.candidate === undefined ? [] : [context.candidate.bidderId]),
    ]);
    const label = (userId: string) => anonymizeName(names.get(userId) ?? '');
    const publicIds = await this.publicIds(context.offers);
    return {
      next:
        context.candidate === undefined || context.blocker === 'WINDOW_PASSED'
          ? null
          : {
              bidder: label(context.candidate.bidderId),
              amount: money(context.candidate.maxAmount, order.currency),
            },
      offers: context.offers.map((offer) => ({
        offer,
        bidder: label(offer.bidderId),
        orderPublicId: offer.orderId === null ? null : (publicIds.get(offer.orderId) ?? null),
      })),
      blocker: context.blocker,
      sendBy: order.cancelledAt === null ? null : secondChanceSendBy(order.cancelledAt),
    };
  }

  /**
   * Oferta do kolejnego kandydata (sprzedający anulowanego zamówienia).
   *
   * @throws {DomainError} NOT_FOUND (nie sprzedający), SECOND_CHANCE_UNAVAILABLE (`reason`)
   */
  async send(idOrPublicId: string, sellerId: string): Promise<SecondChanceOffer> {
    const participant = await this.orders.forParticipant(idOrPublicId, sellerId);
    if (participant.role !== 'SELLER') {
      throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono zamówienia.' });
    }
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const locked = await lockOrder(tx, participant.order.id);
      if (locked === undefined) {
        throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono zamówienia.' });
      }
      const { order, item } = locked;
      const { blocker, candidate } = await this.context(tx, order, item, now);
      if (blocker !== undefined || candidate === undefined) {
        const reason = blocker ?? 'NO_CANDIDATES';
        throw new DomainError({
          code: 'SECOND_CHANCE_UNAVAILABLE',
          detail: BLOCKER_DETAILS[reason],
          extensions: { reason },
        });
      }
      const expiresAt = new Date(now.getTime() + SECOND_CHANCE_VALIDITY_MS);
      const [offer] = await tx
        .insert(secondChanceOffers)
        .values({
          auctionId: item.auctionId,
          sourceOrderId: order.id,
          sellerId: order.sellerId,
          bidderId: candidate.bidderId,
          currency: order.currency,
          amount: candidate.maxAmount,
          expiresAt,
        })
        .returning();
      if (offer === undefined) {
        throw new Error(`Nie zapisano oferty drugiej szansy dla zamówienia ${order.id}`);
      }
      await this.outbox.add(
        tx,
        SecondChanceOffered.create({
          aggregateId: offer.id,
          payload: {
            auctionId: offer.auctionId,
            sourceOrderId: order.id,
            sellerId: offer.sellerId,
            bidderId: offer.bidderId,
            amount: money(offer.amount, offer.currency),
            expiresAt: expiresAt.toISOString(),
          },
        }),
      );
      this.logger.log({ offerId: offer.id, orderId: order.id }, 'Wysłano ofertę drugiej szansy');
      return offer;
    });
  }

  /** Oferta dla jej adresata; inni dostają 404. */
  async forBidder(offerId: string, bidderId: string): Promise<BidderOfferView> {
    const [offer] = await this.db
      .select()
      .from(secondChanceOffers)
      .where(eq(secondChanceOffers.id, offerId));
    if (offer?.bidderId !== bidderId) {
      throw notFound();
    }
    return this.view(this.db, offer);
  }

  /**
   * Akceptacja: nowe zamówienie AWAITING_PAYMENT z ceną oferty. Ponowienie po akceptacji zwraca
   * ofertę z tym samym zamówieniem.
   *
   * @throws {DomainError} NOT_FOUND, SECOND_CHANCE_CLOSED, BIDDING_BLOCKED
   */
  async accept(offerId: string, bidderId: string): Promise<BidderOfferView> {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const offer = await this.lockOffer(tx, offerId, bidderId);
      if (offer.status === 'ACCEPTED') {
        return this.view(tx, offer);
      }
      if (offer.status !== 'PENDING' || offer.expiresAt.getTime() <= now.getTime()) {
        throw closed();
      }
      const block = await this.blocks.active(bidderId, 'BIDDING', tx);
      if (block !== undefined) {
        throw accountBlockedError('BIDDING_BLOCKED', block);
      }
      const source = await lockOrder(tx, offer.sourceOrderId);
      if (source?.order.status !== 'CANCELLED_UNPAID' || !source.item.isActive) {
        throw closed();
      }
      await tx
        .update(orderItems)
        .set({ isActive: false })
        .where(and(eq(orderItems.auctionId, offer.auctionId), eq(orderItems.isActive, true)));
      const order = await this.orders.createForSecondChance(tx, {
        offerId: offer.id,
        auctionId: offer.auctionId,
        buyerId: offer.bidderId,
        sellerId: offer.sellerId,
        currency: offer.currency,
        price: offer.amount,
        acceptedAt: now,
        snapshot: source.item.itemSnapshot,
        runnerUps: source.item.runnerUps,
      });
      const accepted = await this.resolve(tx, offer, 'ACCEPTED', now, order);
      this.logger.log({ offerId, orderId: order.id }, 'Przyjęto ofertę drugiej szansy');
      return this.view(tx, accepted);
    });
  }

  /** Odrzucenie bez konsekwencji. Ponowienie po odrzuceniu zwraca ofertę. */
  async decline(offerId: string, bidderId: string): Promise<BidderOfferView> {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const offer = await this.lockOffer(tx, offerId, bidderId);
      if (offer.status === 'DECLINED') {
        return this.view(tx, offer);
      }
      if (offer.status !== 'PENDING' || offer.expiresAt.getTime() <= now.getTime()) {
        throw closed();
      }
      return this.view(tx, await this.resolve(tx, offer, 'DECLINED', now));
    });
  }

  @ScheduledJob({ queue: 'orders', name: 'orders.expire-second-chance', every: 60_000 })
  async run(): Promise<number> {
    return this.expire(new Date());
  }

  /** Wygaszenie ofert po terminie (`now`: chwila sprawdzenia); zwraca liczbę wygaszonych. */
  async expire(now: Date): Promise<number> {
    const due = await this.db
      .select({ id: secondChanceOffers.id })
      .from(secondChanceOffers)
      .where(and(eq(secondChanceOffers.status, 'PENDING'), lte(secondChanceOffers.expiresAt, now)))
      .orderBy(asc(secondChanceOffers.expiresAt))
      .limit(EXPIRE_BATCH);
    let expired = 0;
    for (const { id } of due) {
      const done = await this.db.transaction(async (tx) => {
        const [offer] = await tx
          .select()
          .from(secondChanceOffers)
          .where(eq(secondChanceOffers.id, id))
          .for('update');
        if (offer?.status !== 'PENDING' || offer.expiresAt.getTime() > now.getTime()) {
          return false;
        }
        await this.resolve(tx, offer, 'EXPIRED', now);
        return true;
      });
      expired += done ? 1 : 0;
    }
    return expired;
  }

  // --- Wewnętrzne ---

  private async context(db: Database | Transaction, order: Order, item: OrderItem, now: Date) {
    const offers = await db
      .select()
      .from(secondChanceOffers)
      .where(eq(secondChanceOffers.auctionId, item.auctionId))
      .orderBy(asc(secondChanceOffers.createdAt));
    const buyers = await db
      .selectDistinct({ buyerId: orders.buyerId })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(eq(orderItems.auctionId, item.auctionId));
    const excluded = new Set([
      ...offers.map((offer) => offer.bidderId),
      ...buyers.map((row) => row.buyerId),
    ]);
    const candidate = nextRunnerUp(item.runnerUps, excluded);
    const blocker = secondChanceBlocker({
      status: order.status,
      cancelledAt: order.cancelledAt,
      latest: item.isActive,
      pendingOffer: offers.some((offer) => offer.status === 'PENDING'),
      candidate,
      now,
    });
    return { offers, candidate, blocker };
  }

  private async lockOffer(
    tx: Transaction,
    offerId: string,
    bidderId: string,
  ): Promise<SecondChanceOffer> {
    const [offer] = await tx
      .select()
      .from(secondChanceOffers)
      .where(eq(secondChanceOffers.id, offerId))
      .for('update');
    if (offer?.bidderId !== bidderId) {
      throw notFound();
    }
    return offer;
  }

  private async resolve(
    tx: Transaction,
    offer: SecondChanceOffer,
    status: 'ACCEPTED' | 'DECLINED' | 'EXPIRED',
    now: Date,
    order?: Order,
  ): Promise<SecondChanceOffer> {
    const [resolved] = await tx
      .update(secondChanceOffers)
      .set({ status, respondedAt: now, orderId: order?.id ?? null, updatedAt: now })
      .where(eq(secondChanceOffers.id, offer.id))
      .returning();
    if (resolved === undefined) {
      throw new Error(`Nie zapisano odpowiedzi na ofertę ${offer.id}`);
    }
    await this.outbox.add(
      tx,
      SecondChanceOfferResolved.create({
        aggregateId: offer.id,
        payload: {
          auctionId: offer.auctionId,
          sourceOrderId: offer.sourceOrderId,
          sellerId: offer.sellerId,
          bidderId: offer.bidderId,
          amount: money(offer.amount, offer.currency),
          status,
          orderPublicId: order?.publicId ?? null,
        },
      }),
    );
    return resolved;
  }

  private async view(
    db: Database | Transaction,
    offer: SecondChanceOffer,
  ): Promise<BidderOfferView> {
    const [source] = await db
      .select({ snapshot: orderItems.itemSnapshot })
      .from(orderItems)
      .where(eq(orderItems.orderId, offer.sourceOrderId))
      .limit(1);
    if (source === undefined) {
      throw new Error(`Oferta ${offer.id} bez zamówienia źródłowego`);
    }
    const price = money(offer.amount, offer.currency);
    if (offer.orderId !== null) {
      const [order] = await db.select().from(orders).where(eq(orders.id, offer.orderId));
      if (order !== undefined) {
        return {
          offer,
          snapshot: source.snapshot,
          pokFee: money(order.pokFee, order.currency),
          total: money(order.itemsTotal + order.pokFee, order.currency),
          orderPublicId: order.publicId,
        };
      }
    }
    const quote = await this.fees.quote(price, new Date());
    return {
      offer,
      snapshot: source.snapshot,
      pokFee: quote.fee,
      total: quote.total,
      orderPublicId: null,
    };
  }

  private async publicIds(offers: readonly SecondChanceOffer[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const offer of offers) {
      if (offer.orderId !== null) {
        const found = await this.orders.byId(offer.orderId);
        if (found !== undefined) {
          map.set(found.id, found.publicId);
        }
      }
    }
    return map;
  }
}

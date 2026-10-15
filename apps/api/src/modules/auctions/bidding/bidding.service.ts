// Silnik licytacji (F-15, PROJECT.md §15.1, §15.6). Każda oferta to jedna transakcja z blokadą
// wiersza aukcji: oferty na tę samą aukcję wykonują się po kolei, a rozstrzygnięcie liczy czysta
// funkcja `resolve` z @biddy/shared. Czas bierzemy z `clock_timestamp()` po uzyskaniu blokady
// (`now()` to początek transakcji, która mogła czekać na blokadę).
import {
  anonymizeName,
  type AuctionBiddingState,
  type CurrencyCode,
  formatMoney,
  isReserveMet,
  minimumNextBid,
  money,
  replay,
  resolve,
  type ResolvedBid,
} from '@biddy/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, countDistinct, desc, eq, lt, ne, sql } from 'drizzle-orm';

import { APP_CONFIG, type AppConfig } from '../../../infra/config/index.js';
import { type Database, DRIZZLE, newId, type Transaction } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { Outbox } from '../../../infra/outbox/index.js';
import { BuyerStandingService, ProfileService } from '../../identity/index.js';
import {
  AuctionEnded,
  AuctionExtended,
  BidCancelled,
  BidPlaced,
  UserOutbid,
} from '../auctions.events.js';
import { AuctionClosingService } from '../closing/auction-closing.service.js';
import { type Auction, auctions, type Bid, type BidKind, bids } from '../db/auctions.schema.js';

/** Wynik złożenia oferty: zapisana oferta użytkownika i stan aukcji po niej. */
export interface BidOutcome {
  readonly bid: Bid;
  readonly auction: Auction;
  /** Ponowienie z tym samym Idempotency-Key: oferta z pierwszego żądania, bez nowego zapisu. */
  readonly replayed: boolean;
}

export interface BidHistoryEntry {
  readonly id: string;
  readonly sequence: number;
  readonly amount: number;
  readonly kind: BidKind;
  readonly createdAt: Date;
  /** Zanonimizowane imię licytującego, np. „k***a”. */
  readonly bidder: string;
}

export interface BidHistory {
  readonly currency: CurrencyCode;
  readonly items: readonly BidHistoryEntry[];
  /** Kursor kolejnej strony (`before`) albo null. */
  readonly nextBefore: number | null;
}

const HISTORY_PAGE = 50;
/** Statusy, w których aukcja nie jest publiczna (oferty i historia: 404). */
const HIDDEN_STATUSES = new Set(['DRAFT', 'PENDING_REVIEW']);

function notFound(): DomainError {
  return new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono aukcji.' });
}

/** Stan licytacji z wiersza aukcji (opublikowanej, więc z ceną wywoławczą). */
export function biddingState(auction: Auction): AuctionBiddingState {
  return {
    currency: auction.currency,
    startPrice: auction.startPrice ?? 0,
    reservePrice: auction.reservePrice,
    currentPrice: auction.currentPrice,
    leaderId: auction.leaderId,
    leaderMaxAmount: auction.leaderMaxAmount,
  };
}

/** Minimalna kolejna oferta aktywnej aukcji (null po zakończeniu). */
export function nextMinimumBid(auction: Auction): number | null {
  if (auction.status !== 'ACTIVE' || auction.startPrice === null) {
    return null;
  }
  return minimumNextBid({
    startPrice: money(auction.startPrice, auction.currency),
    currentPrice:
      auction.currentPrice === null ? null : money(auction.currentPrice, auction.currency),
  }).amount;
}

export function reserveMet(auction: Auction): boolean | null {
  return isReserveMet(biddingState(auction));
}

@Injectable()
export class BiddingService {
  private readonly logger = new Logger(BiddingService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(BuyerStandingService) private readonly buyers: BuyerStandingService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject(AuctionClosingService) private readonly closing: AuctionClosingService,
    private readonly outbox: Outbox,
  ) {}

  /** Oferta z maksimum (licytacja automatyczna, §6.4). */
  async placeBid(
    bidderId: string,
    auctionId: string,
    maxAmount: number,
    idempotencyKey: string,
  ): Promise<BidOutcome> {
    return this.db.transaction(async (tx) => {
      const request = { auctionId, maxAmount, kind: 'MANUAL' as const };
      const earlier = await this.findByKey(tx, bidderId, idempotencyKey, request);
      if (earlier !== undefined) {
        return earlier;
      }
      const auction = await this.lock(tx, auctionId);
      // Równoległe żądanie z tym samym kluczem mogło zapisać ofertę, gdy czekaliśmy na blokadę.
      const concurrent = await this.findByKey(tx, bidderId, idempotencyKey, request);
      if (concurrent !== undefined) {
        return concurrent;
      }
      const now = await this.clock(tx);
      this.assertOpen(auction, now);
      await this.assertBuyer(tx, auction, bidderId, maxAmount, { countAuctions: true });

      const result = resolve(biddingState(auction), { bidderId, maxAmount });
      if (!result.accepted) {
        const minimum = money(result.minimumBid, auction.currency);
        throw new DomainError({
          code: 'BID_TOO_LOW',
          detail:
            auction.leaderId === bidderId
              ? 'Prowadzisz w tej aukcji. Nowe maksimum musi być wyższe niż dotychczasowe.'
              : `Najniższa możliwa oferta to ${formatPln(minimum.amount)}.`,
          extensions: { minimumBid: result.minimumBid },
        });
      }

      const window = this.config.auctions.antiSnipingWindowMs;
      const endsAt = auction.endsAt ?? now;
      const extend = result.changed && window > 0 && endsAt.getTime() - now.getTime() < window;
      const newEndsAt = extend ? new Date(now.getTime() + window) : endsAt;

      const saved = await this.insertBids(tx, auction, result.bids, now, idempotencyKey);
      const [updated] = await tx
        .update(auctions)
        .set({
          currentPrice: result.state.currentPrice,
          leaderId: result.state.leaderId,
          leaderMaxAmount: result.state.leaderMaxAmount,
          bidCount: sql`${auctions.bidCount} + ${saved.length}`,
          bidSequence: sql`${auctions.bidSequence} + ${saved.length}`,
          endsAt: newEndsAt,
          version: sql`${auctions.version} + 1`,
          updatedAt: now,
        })
        .where(eq(auctions.id, auction.id))
        .returning();
      const bid = saved[0];
      if (updated === undefined || bid === undefined) {
        throw new Error(`Zapis oferty w aukcji ${auction.id} nie zwrócił wierszy`);
      }

      const price = money(updated.currentPrice ?? 0, updated.currency);
      const events = [
        BidPlaced.create({
          aggregateId: updated.id,
          payload: {
            bidId: bid.id,
            bidderId,
            kind: 'MANUAL',
            currentPrice: price,
            leaderId: updated.leaderId ?? bidderId,
            bidCount: updated.bidCount,
            endsAt: newEndsAt.toISOString(),
            reserveMet: reserveMet(updated),
          },
        }),
      ];
      if (result.outbidUserId !== null) {
        events.push(
          UserOutbid.create({
            aggregateId: updated.id,
            payload: {
              userId: result.outbidUserId,
              currentPrice: price,
              endsAt: newEndsAt.toISOString(),
            },
          }),
        );
      }
      if (extend) {
        events.push(
          AuctionExtended.create({
            aggregateId: updated.id,
            payload: { previousEndsAt: endsAt.toISOString(), endsAt: newEndsAt.toISOString() },
          }),
        );
      }
      await this.outbox.add(tx, ...events);
      return { bid, auction: updated, replayed: false };
    });
  }

  /** Kup teraz: dostępne do pierwszej oferty; kończy aukcję jako sprzedaną (§6.2). */
  async buyNow(buyerId: string, auctionId: string, idempotencyKey: string): Promise<BidOutcome> {
    return this.db.transaction(async (tx) => {
      const request = { auctionId, maxAmount: undefined, kind: 'BUY_NOW' as const };
      const earlier = await this.findByKey(tx, buyerId, idempotencyKey, request);
      if (earlier !== undefined) {
        return earlier;
      }
      const auction = await this.lock(tx, auctionId);
      const concurrent = await this.findByKey(tx, buyerId, idempotencyKey, request);
      if (concurrent !== undefined) {
        return concurrent;
      }
      const now = await this.clock(tx);
      this.assertOpen(auction, now);
      if (auction.buyNowPrice === null || auction.bidCount > 0) {
        throw new DomainError({
          code: 'BUY_NOW_UNAVAILABLE',
          ...(auction.buyNowPrice === null ? { detail: 'Ta aukcja nie ma opcji Kup teraz.' } : {}),
        });
      }
      const price = auction.buyNowPrice;
      await this.assertBuyer(tx, auction, buyerId, price, { countAuctions: false });

      const [bid] = await this.insertBids(
        tx,
        auction,
        [{ bidderId: buyerId, kind: 'MANUAL', amount: price, maxAmount: price }],
        now,
        idempotencyKey,
        'BUY_NOW',
      );
      const [updated] = await tx
        .update(auctions)
        .set({
          status: 'ENDED_SOLD',
          currentPrice: price,
          leaderId: buyerId,
          leaderMaxAmount: price,
          bidCount: sql`${auctions.bidCount} + 1`,
          bidSequence: sql`${auctions.bidSequence} + 1`,
          endsAt: now,
          version: sql`${auctions.version} + 1`,
          updatedAt: now,
        })
        .where(eq(auctions.id, auction.id))
        .returning();
      if (updated === undefined || bid === undefined) {
        throw new Error(`Kup teraz w aukcji ${auction.id} nie zwróciło wierszy`);
      }
      // Zamówienie w tej samej transakcji co zakończenie aukcji (F-16).
      await this.closing.settleSale(tx, updated, 'BUY_NOW', now);
      const finalPrice = money(price, updated.currency);
      await this.outbox.add(
        tx,
        BidPlaced.create({
          aggregateId: updated.id,
          payload: {
            bidId: bid.id,
            bidderId: buyerId,
            kind: 'BUY_NOW',
            currentPrice: finalPrice,
            leaderId: buyerId,
            bidCount: updated.bidCount,
            endsAt: now.toISOString(),
            reserveMet: reserveMet(updated),
          },
        }),
        AuctionEnded.create({
          aggregateId: updated.id,
          payload: {
            sellerId: updated.sellerId,
            outcome: 'SOLD',
            winnerId: buyerId,
            finalPrice,
            endedBy: 'BUY_NOW',
            endedAt: now.toISOString(),
          },
        }),
      );
      return { bid, auction: updated, replayed: false };
    });
  }

  /** Publiczna historia ofert od najnowszej, z zanonimizowanymi licytującymi. */
  async history(auctionId: string, before?: number): Promise<BidHistory> {
    const [auction] = await this.db.select().from(auctions).where(eq(auctions.id, auctionId));
    if (auction === undefined || HIDDEN_STATUSES.has(auction.status)) {
      throw notFound();
    }
    const rows = await this.db
      .select()
      .from(bids)
      .where(
        and(
          eq(bids.auctionId, auctionId),
          eq(bids.status, 'VALID'),
          before === undefined ? undefined : lt(bids.sequence, before),
        ),
      )
      .orderBy(desc(bids.sequence))
      .limit(HISTORY_PAGE + 1);
    const page = rows.slice(0, HISTORY_PAGE);
    const names = await this.profiles.displayNames(page.map((row) => row.bidderId));
    return {
      currency: auction.currency,
      items: page.map((row) => ({
        id: row.id,
        sequence: row.sequence,
        amount: row.amount,
        kind: row.kind,
        createdAt: row.createdAt,
        bidder: anonymizeName(names.get(row.bidderId) ?? ''),
      })),
      nextBefore: rows.length > HISTORY_PAGE ? (page.at(-1)?.sequence ?? null) : null,
    };
  }

  /**
   * Unieważnienie oferty przez personel (§15.6): oferta i wszystkie automatyczne → CANCELLED,
   * przeliczenie aukcji od zera z pozostałych ofert ręcznych (te same reguły `resolve`).
   * `ends_at` się nie zmienia. Tylko aktywna aukcja (po zakończeniu: F-26).
   */
  async cancelBid(
    staffId: string,
    bidId: string,
    reason: 'TYPO' | 'FRAUD',
    note: string,
  ): Promise<Auction> {
    return this.db.transaction(async (tx) => {
      const [target] = await tx.select().from(bids).where(eq(bids.id, bidId));
      if (target === undefined) {
        throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono oferty.' });
      }
      const auction = await this.lock(tx, target.auctionId);
      const [bid] = await tx.select().from(bids).where(eq(bids.id, bidId));
      if (auction.status !== 'ACTIVE') {
        throw new DomainError({
          code: 'CONFLICT',
          detail: 'Unieważnić można ofertę w aktywnej aukcji.',
        });
      }
      if (bid?.status !== 'VALID' || bid.kind !== 'MANUAL') {
        throw new DomainError({
          code: 'CONFLICT',
          detail:
            bid?.kind === 'AUTO'
              ? 'Oferta automatyczna wynika z ręcznej: unieważnij ofertę ręczną licytującego.'
              : 'Ta oferta jest już unieważniona.',
        });
      }
      const now = await this.clock(tx);
      await tx
        .update(bids)
        .set({ status: 'CANCELLED', cancelReason: reason, cancelledBy: staffId, cancelledAt: now })
        .where(eq(bids.id, bid.id));
      await tx
        .update(bids)
        .set({ status: 'CANCELLED', cancelReason: 'REPLAY', cancelledAt: now })
        .where(
          and(eq(bids.auctionId, auction.id), eq(bids.kind, 'AUTO'), eq(bids.status, 'VALID')),
        );

      const manual = await tx
        .select()
        .from(bids)
        .where(
          and(eq(bids.auctionId, auction.id), eq(bids.kind, 'MANUAL'), eq(bids.status, 'VALID')),
        )
        .orderBy(asc(bids.sequence));
      const result = replay(
        {
          currency: auction.currency,
          startPrice: auction.startPrice ?? 0,
          reservePrice: auction.reservePrice,
        },
        manual.map((row) => ({ bidderId: row.bidderId, maxAmount: row.maxAmount })),
      );

      // Ważne oferty dostają nowe numery w kolejności replayu (automatyczne tuż po swojej ręcznej),
      // więc historia i kolejny replay widzą ten sam porządek.
      let sequence = auction.bidSequence;
      let valid = 0;
      for (const [index, step] of result.steps.entries()) {
        const row = manual[index];
        if (row === undefined) {
          continue;
        }
        if (!step.result.accepted) {
          await tx
            .update(bids)
            .set({ status: 'CANCELLED', cancelReason: 'REPLAY', cancelledAt: now })
            .where(eq(bids.id, row.id));
          continue;
        }
        const [own, ...auto] = step.result.bids;
        sequence += 1;
        valid += 1;
        await tx
          .update(bids)
          .set({ sequence, amount: own?.amount ?? row.amount })
          .where(eq(bids.id, row.id));
        for (const generated of auto) {
          sequence += 1;
          valid += 1;
          await tx.insert(bids).values({
            id: newId(),
            auctionId: auction.id,
            bidderId: generated.bidderId,
            sequence,
            amount: generated.amount,
            maxAmount: generated.maxAmount,
            kind: 'AUTO',
            createdAt: row.createdAt,
          });
        }
      }

      const [updated] = await tx
        .update(auctions)
        .set({
          currentPrice: result.state.currentPrice,
          leaderId: result.state.leaderId,
          leaderMaxAmount: result.state.leaderMaxAmount,
          bidCount: valid,
          bidSequence: sequence,
          version: sql`${auctions.version} + 1`,
          updatedAt: now,
        })
        .where(eq(auctions.id, auction.id))
        .returning();
      if (updated === undefined) {
        throw notFound();
      }
      await this.outbox.add(
        tx,
        BidCancelled.create({
          aggregateId: updated.id,
          payload: {
            bidId: bid.id,
            bidderId: bid.bidderId,
            reason,
            cancelledBy: staffId,
            previousLeaderId: auction.leaderId,
            leaderId: updated.leaderId,
            currentPrice:
              updated.currentPrice === null ? null : money(updated.currentPrice, updated.currency),
            bidCount: updated.bidCount,
          },
        }),
      );
      this.logger.warn(
        { auctionId: updated.id, bidId: bid.id, staffId, reason, note },
        'Unieważniono ofertę i przeliczono aukcję',
      );
      return updated;
    });
  }

  // --- Wewnętrzne ---

  private async lock(tx: Transaction, auctionId: string): Promise<Auction> {
    const [auction] = await tx
      .select()
      .from(auctions)
      .where(eq(auctions.id, auctionId))
      .for('update');
    if (auction === undefined || HIDDEN_STATUSES.has(auction.status)) {
      throw notFound();
    }
    return auction;
  }

  /** Aktualny czas bazy (nie początek transakcji). */
  private async clock(tx: Transaction): Promise<Date> {
    const result = await tx.execute<{ now: Date | string }>(sql`select clock_timestamp() as now`);
    const value = result.rows[0]?.now;
    return value instanceof Date ? value : new Date(value ?? Date.now());
  }

  private assertOpen(auction: Auction, now: Date): void {
    if (auction.status !== 'ACTIVE' || auction.endsAt === null || auction.endsAt <= now) {
      throw new DomainError({ code: 'AUCTION_ENDED' });
    }
  }

  /** Własna aukcja, blokada licytowania i limity kupującego (§4.1). */
  private async assertBuyer(
    tx: Transaction,
    auction: Auction,
    bidderId: string,
    amount: number,
    { countAuctions }: { readonly countAuctions: boolean },
  ): Promise<void> {
    if (auction.sellerId === bidderId) {
      throw new DomainError({ code: 'OWN_AUCTION' });
    }
    const standing = await this.buyers.get(bidderId, tx);
    if (standing.biddingBlockedUntil !== null && standing.biddingBlockedUntil > new Date()) {
      throw new DomainError({
        code: 'BIDDING_BLOCKED',
        detail: `Masz blokadę licytowania do ${formatDate(standing.biddingBlockedUntil)}.`,
        extensions: { blockedUntil: standing.biddingBlockedUntil.toISOString() },
      });
    }
    const { maxBidAmount, maxActiveAuctions } = standing.limits;
    if (maxBidAmount !== null && amount > maxBidAmount) {
      throw new DomainError({
        code: 'BID_LIMIT_EXCEEDED',
        detail: `Jako nowy kupujący możesz zaoferować najwyżej ${formatPln(maxBidAmount)}. Limit rośnie po opłaconych zamówieniach.`,
        extensions: { limit: maxBidAmount, limitKind: 'BID_AMOUNT' },
      });
    }
    if (countAuctions && maxActiveAuctions !== null) {
      const [row] = await tx
        .select({ value: countDistinct(bids.auctionId) })
        .from(bids)
        .innerJoin(auctions, eq(auctions.id, bids.auctionId))
        .where(
          and(
            eq(bids.bidderId, bidderId),
            eq(bids.status, 'VALID'),
            eq(auctions.status, 'ACTIVE'),
            ne(bids.auctionId, auction.id),
          ),
        );
      if ((row?.value ?? 0) >= maxActiveAuctions) {
        throw new DomainError({
          code: 'BID_LIMIT_EXCEEDED',
          detail: `Jako nowy kupujący możesz licytować najwyżej ${String(maxActiveAuctions)} aukcji naraz. Limit rośnie po opłaconych zamówieniach.`,
          extensions: { limit: maxActiveAuctions, limitKind: 'ACTIVE_AUCTIONS' },
        });
      }
    }
  }

  /** Oferty z kolejnymi numerami; pierwsza (oferta użytkownika) dostaje klucz idempotencji. */
  private async insertBids(
    tx: Transaction,
    auction: Auction,
    resolved: readonly ResolvedBid[],
    now: Date,
    idempotencyKey: string,
    ownKind: 'MANUAL' | 'BUY_NOW' = 'MANUAL',
  ): Promise<Bid[]> {
    const rows = resolved.map((bid, index) => ({
      id: newId(),
      auctionId: auction.id,
      bidderId: bid.bidderId,
      sequence: auction.bidSequence + index + 1,
      amount: bid.amount,
      maxAmount: bid.maxAmount,
      kind: index === 0 ? ownKind : bid.kind,
      idempotencyKey: index === 0 ? idempotencyKey : null,
      createdAt: now,
    }));
    return tx.insert(bids).values(rows).returning();
  }

  /**
   * Oferta wcześniejszego żądania z tym samym kluczem i aktualny stan aukcji. Ten sam klucz
   * z inną aukcją, kwotą albo rodzajem oferty: 422 IDEMPOTENCY_KEY_REUSED.
   */
  private async findByKey(
    tx: Transaction,
    bidderId: string,
    idempotencyKey: string,
    request: {
      readonly auctionId: string;
      readonly maxAmount: number | undefined;
      readonly kind: 'MANUAL' | 'BUY_NOW';
    },
  ): Promise<BidOutcome | undefined> {
    const [bid] = await tx
      .select()
      .from(bids)
      .where(and(eq(bids.bidderId, bidderId), eq(bids.idempotencyKey, idempotencyKey)));
    if (bid === undefined) {
      return undefined;
    }
    if (
      bid.auctionId !== request.auctionId ||
      bid.kind !== request.kind ||
      (request.maxAmount !== undefined && bid.maxAmount !== request.maxAmount)
    ) {
      throw new DomainError({ code: 'IDEMPOTENCY_KEY_REUSED' });
    }
    const [auction] = await tx.select().from(auctions).where(eq(auctions.id, bid.auctionId));
    if (auction === undefined) {
      throw notFound();
    }
    return { bid, auction, replayed: true };
  }
}

/** Kwota w groszach do komunikatu, np. „21 zł” albo „20,49 zł” (bez arytmetyki float). */
function formatPln(amount: number): string {
  return formatMoney(money(amount), { trailingZeroDisplay: 'stripIfInteger' });
}

function formatDate(date: Date): string {
  return date.toLocaleString('pl-PL', {
    timeZone: 'Europe/Warsaw',
    dateStyle: 'long',
    timeStyle: 'short',
  });
}

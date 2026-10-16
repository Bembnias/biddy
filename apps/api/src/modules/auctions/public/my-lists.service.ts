// Listy Moje Biddy (F-21): aukcje, w których użytkownik licytuje (aktywne, wygrane, przegrane),
// z jego maksimum i zamówieniem zwycięzcy, oraz obserwowane aukcje.
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, countDistinct, desc, eq, inArray, max, ne, or, sql } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { type Order, OrderService } from '../../orders/index.js';
import { type Auction, auctions, bids, watchlist } from '../db/auctions.schema.js';
import { type AuctionCard, AuctionCards } from './auction-cards.js';
import type { BiddingOutcome } from './auction-view.service.js';

export const MY_BIDS_FILTERS = ['ACTIVE', 'WON', 'LOST'] as const;
export type MyBidsFilter = (typeof MY_BIDS_FILTERS)[number];

export const MY_BIDS_PAGE = 24;
const WATCHLIST_LIMIT = 100;

export interface MyBidEntry {
  readonly card: AuctionCard;
  readonly maxAmount: number;
  readonly leading: boolean;
  readonly outcome: BiddingOutcome;
  /** Zamówienie zwycięzcy (wygrane). */
  readonly order: Order | undefined;
}

function outcomeOf(auction: Auction, userId: string): BiddingOutcome {
  const leading = auction.leaderId === userId;
  if (auction.status === 'ENDED_SOLD') {
    return leading ? 'WON' : 'LOST';
  }
  if (auction.status === 'ENDED_UNSOLD') {
    return leading ? 'RESERVE_NOT_MET' : 'LOST';
  }
  return 'NONE';
}

@Injectable()
export class MyListsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AuctionCards) private readonly cards: AuctionCards,
    @Inject(OrderService) private readonly orders: OrderService,
  ) {}

  /** Aukcje z ważnymi ofertami użytkownika według filtra; strona od 1. */
  async bids(
    userId: string,
    filter: MyBidsFilter,
    page: number,
  ): Promise<{ items: MyBidEntry[]; total: number }> {
    const mine = and(eq(bids.bidderId, userId), eq(bids.status, 'VALID'));
    const condition = {
      ACTIVE: eq(auctions.status, 'ACTIVE'),
      WON: and(eq(auctions.status, 'ENDED_SOLD'), eq(auctions.leaderId, userId)),
      LOST: or(
        inArray(auctions.status, ['ENDED_UNSOLD', 'CANCELLED']),
        and(eq(auctions.status, 'ENDED_SOLD'), ne(auctions.leaderId, userId)),
      ),
    }[filter];
    const [totals] = await this.db
      .select({ total: countDistinct(bids.auctionId) })
      .from(bids)
      .innerJoin(auctions, eq(auctions.id, bids.auctionId))
      .where(and(mine, condition));
    const rows = await this.db
      .select({ auction: auctions, maxAmount: max(bids.maxAmount) })
      .from(bids)
      .innerJoin(auctions, eq(auctions.id, bids.auctionId))
      .where(and(mine, condition))
      .groupBy(auctions.id)
      .orderBy(
        filter === 'ACTIVE' ? asc(auctions.endsAt) : desc(auctions.updatedAt),
        asc(auctions.id),
      )
      .limit(MY_BIDS_PAGE)
      .offset((page - 1) * MY_BIDS_PAGE);
    const cards = await this.cards.cards(rows.map((row) => row.auction));
    const orders =
      filter === 'WON'
        ? await this.orders.activeForAuctions(rows.map((row) => row.auction.id))
        : new Map<string, Order>();
    return {
      total: totals?.total ?? 0,
      items: rows.map((row, index) => {
        const order = orders.get(row.auction.id);
        return {
          card: cards[index] as AuctionCard,
          maxAmount: row.maxAmount ?? 0,
          leading: row.auction.leaderId === userId,
          outcome: outcomeOf(row.auction, userId),
          order: order?.buyerId === userId ? order : undefined,
        };
      }),
    };
  }

  /** Obserwowane: aktywne najpierw (najbliższy koniec), potem zakończone. */
  async watchlist(userId: string): Promise<AuctionCard[]> {
    const rows = await this.db
      .select({ auction: auctions })
      .from(watchlist)
      .innerJoin(auctions, eq(auctions.id, watchlist.auctionId))
      .where(eq(watchlist.userId, userId))
      .orderBy(
        sql`case when ${auctions.status} = 'ACTIVE' then 0 else 1 end`,
        asc(auctions.endsAt),
        desc(watchlist.createdAt),
      )
      .limit(WATCHLIST_LIMIT);
    return this.cards.cards(rows.map((row) => row.auction));
  }
}

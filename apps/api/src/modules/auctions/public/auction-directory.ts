// Aukcje dla powiadomień (F-20, moduł notifications): podsumowanie do treści (tytuł, adres, cena,
// koniec) i odbiorcy (obserwujący i licytujący). Bez maksimów i danych licytujących. Przedmiot
// rozmów (F-29, moduł messaging): podsumowanie ze zdjęciem głównym.
import { auctionSlug, type CurrencyCode } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';

import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { ItemService } from '../../catalog/index.js';
import { type AuctionStatus, auctions, bids, watchlist } from '../db/auctions.schema.js';
import { AuctionCards } from './auction-cards.js';

export interface AuctionNotice {
  readonly id: string;
  readonly publicId: string;
  readonly slug: string;
  readonly title: string;
  readonly sellerId: string;
  readonly status: AuctionStatus;
  readonly currency: CurrencyCode;
  /** Aktualna albo wywoławcza cena (grosze). */
  readonly price: number;
  readonly bidCount: number;
  readonly endsAt: Date | null;
}

/** Aukcja jako przedmiot rozmowy (F-29): podsumowanie i miniatura zdjęcia głównego (320 px). */
export interface AuctionSubject extends AuctionNotice {
  readonly coverUrl: string | null;
}

@Injectable()
export class AuctionDirectory {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(ItemService) private readonly items: ItemService,
    @Inject(AuctionCards) private readonly cards: AuctionCards,
  ) {}

  async notices(auctionIds: readonly string[], tx?: Transaction): Promise<AuctionNotice[]> {
    if (auctionIds.length === 0) {
      return [];
    }
    const rows = await (tx ?? this.db)
      .select()
      .from(auctions)
      .where(inArray(auctions.id, [...new Set(auctionIds)]));
    const items = new Map(
      (
        await this.items.getMany(
          rows.map((row) => row.itemId),
          tx,
        )
      ).map((item) => [item.id, item]),
    );
    return rows.map((row) => {
      const title = items.get(row.itemId)?.title ?? '';
      return {
        id: row.id,
        publicId: row.publicId,
        slug: auctionSlug(title),
        title,
        sellerId: row.sellerId,
        status: row.status,
        currency: row.currency,
        price: row.currentPrice ?? row.startPrice ?? 0,
        bidCount: row.bidCount,
        endsAt: row.endsAt,
      };
    });
  }

  async notice(auctionId: string, tx?: Transaction): Promise<AuctionNotice | undefined> {
    return (await this.notices([auctionId], tx))[0];
  }

  /** Przedmioty rozmów według ID aukcji (nieznane aukcje nie trafiają do wyniku). */
  async subjects(auctionIds: readonly string[]): Promise<Map<string, AuctionSubject>> {
    if (auctionIds.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .select()
      .from(auctions)
      .where(inArray(auctions.id, [...new Set(auctionIds)]));
    const cards = await this.cards.cards(rows);
    return new Map(
      cards.map(({ auction, title, slug, cover }) => [
        auction.id,
        {
          id: auction.id,
          publicId: auction.publicId,
          slug,
          title,
          sellerId: auction.sellerId,
          status: auction.status,
          currency: auction.currency,
          price: auction.currentPrice ?? auction.startPrice ?? 0,
          bidCount: auction.bidCount,
          endsAt: auction.endsAt,
          coverUrl: cover?.thumb ?? null,
        },
      ]),
    );
  }

  /** Obserwujący i licytujący (ważne oferty) aukcji, bez sprzedającego; każdy raz. */
  async audience(auctionId: string, tx?: Transaction): Promise<string[]> {
    const executor = tx ?? this.db;
    const [auction] = await executor
      .select({ sellerId: auctions.sellerId })
      .from(auctions)
      .where(eq(auctions.id, auctionId));
    if (auction === undefined) {
      return [];
    }
    const [watchers, bidders] = await Promise.all([
      executor
        .select({ userId: watchlist.userId })
        .from(watchlist)
        .where(eq(watchlist.auctionId, auctionId)),
      executor
        .selectDistinct({ userId: bids.bidderId })
        .from(bids)
        .where(and(eq(bids.auctionId, auctionId), eq(bids.status, 'VALID'))),
    ]);
    return [
      ...new Set(
        [...watchers, ...bidders].map((row) => row.userId).filter((id) => id !== auction.sellerId),
      ),
    ];
  }
}

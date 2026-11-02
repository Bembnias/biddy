// Obserwowane aukcje (F-20): obserwujący dostają powiadomienie godzinę przed końcem (moduł
// notifications); lista obserwowanych w Moje Biddy (F-21).
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { auctions, watchlist } from '../db/auctions.schema.js';

const HIDDEN_STATUSES = new Set(['DRAFT', 'PENDING_REVIEW']);

@Injectable()
export class WatchlistService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Obserwowanie aktywnej aukcji (idempotentne). Własna albo zakończona: 409. */
  async watch(userId: string, auctionId: string): Promise<void> {
    const [auction] = await this.db
      .select({ status: auctions.status, sellerId: auctions.sellerId })
      .from(auctions)
      .where(eq(auctions.id, auctionId));
    if (auction === undefined || HIDDEN_STATUSES.has(auction.status)) {
      throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono aukcji.' });
    }
    if (auction.sellerId === userId) {
      throw new DomainError({
        code: 'CONFLICT',
        detail: 'Nie możesz obserwować własnej aukcji.',
      });
    }
    if (auction.status !== 'ACTIVE') {
      throw new DomainError({ code: 'CONFLICT', detail: 'Aukcja już się zakończyła.' });
    }
    await this.db.insert(watchlist).values({ userId, auctionId }).onConflictDoNothing();
  }

  async unwatch(userId: string, auctionId: string): Promise<void> {
    await this.db
      .delete(watchlist)
      .where(and(eq(watchlist.userId, userId), eq(watchlist.auctionId, auctionId)));
  }

  async isWatching(userId: string, auctionId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ auctionId: watchlist.auctionId })
      .from(watchlist)
      .where(and(eq(watchlist.userId, userId), eq(watchlist.auctionId, auctionId)));
    return row !== undefined;
  }
}

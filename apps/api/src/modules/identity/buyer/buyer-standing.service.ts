// Stan konta kupującego (F-15, PROJECT.md §4.1): poziom i limity licytowania oraz blokada
// licytowania. Poziom z historii zamówień i nadpisania limitów (`users.limits`) liczy F-61; do
// tego czasu każdy kupujący ma poziom „nowy”.
import { BUYER_LIMITS, type BuyerLevel, type BuyerLevelLimits } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { users } from '../db/identity.schema.js';

export interface BuyerStanding {
  readonly level: BuyerLevel;
  readonly limits: BuyerLevelLimits;
  /** Koniec blokady licytowania albo null; blokada działa, gdy data jest w przyszłości. */
  readonly biddingBlockedUntil: Date | null;
}

@Injectable()
export class BuyerStandingService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Stan kupującego; z `tx` w transakcji wywołującego (np. składanie oferty). */
  async get(userId: string, tx?: Transaction): Promise<BuyerStanding> {
    const [row] = await (tx ?? this.db)
      .select({ biddingBlockedUntil: users.biddingBlockedUntil })
      .from(users)
      .where(eq(users.id, userId));
    if (row === undefined) {
      throw new Error(`Nie ma użytkownika ${userId}`);
    }
    const level: BuyerLevel = 'NEW';
    return { level, limits: BUYER_LIMITS[level], biddingBlockedUntil: row.biddingBlockedUntil };
  }
}

// Stan konta kupującego (F-15, F-61, PROJECT.md §4.1): poziom z historii zamówień, limity
// licytowania z polityki kont i nadpisań (`users.limits`) oraz aktywna blokada licytowania.
import {
  type BuyerHistory,
  type BuyerLevel,
  type BuyerLevelLimits,
  buyerLevel,
  effectiveBuyerLimits,
  hasLimitsOverride,
} from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { users } from '../db/identity.schema.js';
import { type ActiveBlock, AccountBlockService } from '../standing/account-block.service.js';
import { AccountPolicyService } from '../standing/account-policy.service.js';
import { buyerHistoryOf, TradeHistoryService } from '../standing/trade-history.service.js';

export interface BuyerStanding {
  readonly level: BuyerLevel;
  readonly limits: BuyerLevelLimits;
  /** Limity albo poziom ustawione ręcznie (`users.limits`). */
  readonly overridden: boolean;
  readonly history: BuyerHistory;
  /** Aktywna blokada licytowania albo null (`until` null = bezterminowa). */
  readonly biddingBlock: ActiveBlock | null;
}

@Injectable()
export class BuyerStandingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AccountPolicyService) private readonly policies: AccountPolicyService,
    @Inject(TradeHistoryService) private readonly trades: TradeHistoryService,
    @Inject(AccountBlockService) private readonly blocks: AccountBlockService,
  ) {}

  /** Stan kupującego; z `tx` w transakcji wywołującego (np. składanie oferty). */
  async get(userId: string, tx?: Transaction): Promise<BuyerStanding> {
    const [row] = await (tx ?? this.db)
      .select({ createdAt: users.createdAt, limits: users.limits })
      .from(users)
      .where(eq(users.id, userId));
    if (row === undefined) {
      throw new Error(`Nie ma użytkownika ${userId}`);
    }
    // Po kolei: w transakcji wywołującego wszystkie zapytania idą jednym połączeniem.
    const policy = await this.policies.current();
    const counts = await this.trades.counts(userId, tx);
    const block = await this.blocks.active(userId, 'BIDDING', tx);
    const override = row.limits ?? undefined;
    const history = buyerHistoryOf(counts, row.createdAt);
    const level = buyerLevel(history, policy, new Date(), override);
    return {
      level,
      limits: effectiveBuyerLimits(level, policy, override),
      overridden: hasLimitsOverride(override, 'buyer'),
      history,
      biddingBlock: block ?? null,
    };
  }
}

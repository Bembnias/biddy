// Stan konta sprzedawcy (F-14, F-61, PROJECT.md §4.1): poziom z historii sprzedaży, limity
// z polityki kont i nadpisań (`users.limits`), KYC, aktywna blokada wystawiania i potwierdzenie
// informacji o weryfikacji tożsamości. Status KYC z operatora przyjdzie z F-32; do tego czasu
// poziom „z KYC” daje tylko nadpisanie.
import {
  effectiveSellerLimits,
  hasLimitsOverride,
  KYC_REQUIRED_ABOVE,
  type SellerHistory,
  type SellerLevel,
  type SellerLevelLimits,
  sellerLevel,
} from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { users } from '../db/identity.schema.js';
import { type ActiveBlock, AccountBlockService } from '../standing/account-block.service.js';
import { AccountPolicyService } from '../standing/account-policy.service.js';
import { sellerHistoryOf, TradeHistoryService } from '../standing/trade-history.service.js';

export interface SellerStanding {
  readonly level: SellerLevel;
  readonly limits: SellerLevelLimits;
  /** Limity albo poziom ustawione ręcznie (`users.limits`). */
  readonly overridden: boolean;
  readonly history: SellerHistory;
  /** Pozytywna weryfikacja u operatora płatności (F-32). */
  readonly kycVerified: boolean;
  /** Wartość aukcji, powyżej której wymagane jest KYC (grosze). */
  readonly kycRequiredAbove: number;
  /** Aktywna blokada wystawiania albo null (`until` null = bezterminowa). */
  readonly listingBlock: ActiveBlock | null;
  /** Kiedy sprzedawca potwierdził informację o weryfikacji tożsamości (null = jeszcze nie). */
  readonly kycNoticeAcceptedAt: Date | null;
}

@Injectable()
export class SellerStandingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AccountPolicyService) private readonly policies: AccountPolicyService,
    @Inject(TradeHistoryService) private readonly trades: TradeHistoryService,
    @Inject(AccountBlockService) private readonly blocks: AccountBlockService,
  ) {}

  /** Stan sprzedawcy; z `tx` w transakcji wywołującego (np. publikacja aukcji). */
  async get(userId: string, tx?: Transaction): Promise<SellerStanding> {
    const [row] = await (tx ?? this.db)
      .select({
        limits: users.limits,
        kycNoticeAcceptedAt: users.sellerKycNoticeAcceptedAt,
      })
      .from(users)
      .where(eq(users.id, userId));
    if (row === undefined) {
      throw new Error(`Nie ma użytkownika ${userId}`);
    }
    // Po kolei: w transakcji wywołującego wszystkie zapytania idą jednym połączeniem.
    const policy = await this.policies.current();
    const counts = await this.trades.counts(userId, tx);
    const block = await this.blocks.active(userId, 'LISTING', tx);
    const override = row.limits ?? undefined;
    const kycVerified = false;
    const history = sellerHistoryOf(counts, kycVerified);
    const level = sellerLevel(history, policy, override);
    return {
      level,
      limits: effectiveSellerLimits(level, history, policy, override),
      overridden: hasLimitsOverride(override, 'seller'),
      history,
      kycVerified,
      kycRequiredAbove: KYC_REQUIRED_ABOVE,
      listingBlock: block ?? null,
      kycNoticeAcceptedAt: row.kycNoticeAcceptedAt,
    };
  }

  /** Zapisuje potwierdzenie informacji o KYC (dowód poinformowania, §17); kolejne nie zmienia daty. */
  async acceptKycNotice(userId: string, tx: Transaction): Promise<void> {
    const [row] = await tx
      .select({ acceptedAt: users.sellerKycNoticeAcceptedAt })
      .from(users)
      .where(eq(users.id, userId));
    if (row !== undefined && row.acceptedAt === null) {
      await tx
        .update(users)
        .set({ sellerKycNoticeAcceptedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, userId));
    }
  }
}

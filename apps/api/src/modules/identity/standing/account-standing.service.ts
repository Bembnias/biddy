// Przegląd stanu konta (F-61): poziomy, limity, następny poziom, aktywne blokady i liczniki
// strike'ów dla `GET /me/standing` i widoku personelu; nadpisania limitów (`users.limits`).
import {
  type AccountPolicy,
  type UserLimitsOverride,
  userLimitsOverrideSchema,
} from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { type BuyerStanding, BuyerStandingService } from '../buyer/buyer-standing.service.js';
import { users } from '../db/identity.schema.js';
import type { AccountBlockRow, StrikeRow } from '../db/standing.schema.js';
import { type SellerStanding, SellerStandingService } from '../seller/seller-standing.service.js';
import { AccountPolicyService } from './account-policy.service.js';
import { countableStrikes } from './block-rules.js';
import { nextBuyerLevel, nextSellerLevel, type NextLevel } from './next-level.js';
import { StrikeService } from './strike.service.js';

export interface StandingOverview {
  readonly policy: AccountPolicy;
  readonly buyer: BuyerStanding;
  readonly seller: SellerStanding;
  readonly nextBuyer: NextLevel<BuyerStanding['level']> | null;
  readonly nextSeller: NextLevel<SellerStanding['level']> | null;
  /** Strike'i, które liczą się do następnej blokady (niecofnięte, z okna, niezużyte). */
  readonly countable: { readonly buyer: number; readonly seller: number };
  readonly override: UserLimitsOverride | null;
  readonly strikes: readonly StrikeRow[];
  readonly blocks: readonly AccountBlockRow[];
}

@Injectable()
export class AccountStandingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AccountPolicyService) private readonly policies: AccountPolicyService,
    @Inject(BuyerStandingService) private readonly buyers: BuyerStandingService,
    @Inject(SellerStandingService) private readonly sellers: SellerStandingService,
    @Inject(StrikeService) private readonly strikeService: StrikeService,
  ) {}

  async overview(userId: string): Promise<StandingOverview> {
    // Najpierw nadpisania: nieistniejący użytkownik to 404, a nie błąd standing services.
    const override = await this.override(userId);
    const [policy, buyer, seller, history] = await Promise.all([
      this.policies.current(),
      this.buyers.get(userId),
      this.sellers.get(userId),
      this.strikeService.history(userId),
    ]);
    const now = new Date();
    return {
      policy,
      buyer,
      seller,
      nextBuyer: nextBuyerLevel(
        buyer.level,
        buyer.history,
        policy,
        now,
        override?.buyer?.level !== undefined,
      ),
      nextSeller: nextSellerLevel(
        seller.level,
        seller.history,
        policy,
        override?.seller?.level !== undefined,
      ),
      countable: {
        buyer: countableStrikes('BUYER', history.strikes, history.blocks, policy, now).length,
        seller: countableStrikes('SELLER', history.strikes, history.blocks, policy, now).length,
      },
      override,
      strikes: history.strikes,
      blocks: history.blocks,
    };
  }

  /** Nadpisania limitów użytkownika albo null. */
  async override(userId: string): Promise<UserLimitsOverride | null> {
    const [row] = await this.db
      .select({ limits: users.limits })
      .from(users)
      .where(eq(users.id, userId));
    if (row === undefined) {
      throw userNotFound();
    }
    return row.limits;
  }

  /** Ustawia nadpisania (`null` albo pusty obiekt usuwa); działa od następnej oferty i publikacji. */
  async setOverride(userId: string, override: UserLimitsOverride | null): Promise<void> {
    const parsed = override === null ? null : userLimitsOverrideSchema.parse(override);
    const empty =
      parsed === null ||
      ((parsed.buyer === undefined || Object.keys(parsed.buyer).length === 0) &&
        (parsed.seller === undefined || Object.keys(parsed.seller).length === 0));
    const [updated] = await this.db
      .update(users)
      .set({ limits: empty ? null : parsed, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    if (updated === undefined) {
      throw userNotFound();
    }
  }
}

function userNotFound(): DomainError {
  return new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono użytkownika.' });
}

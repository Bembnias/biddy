// Następny poziom konta i brakujące warunki (F-61, PROJECT.md §4.1) do widoku „Limity i strike'i”:
// klient pokazuje, co podniesie limity, bez własnej kopii progów.
import type {
  AccountPolicy,
  BuyerHistory,
  BuyerLevel,
  SellerHistory,
  SellerLevel,
} from '@biddy/shared';

const DAY_MS = 24 * 60 * 60 * 1000;

export const LEVEL_REQUIREMENT_KINDS = [
  'PAID_ORDERS',
  'COMPLETED_ORDERS',
  'ACCOUNT_AGE_DAYS',
  'COMPLETED_SALES',
  'NO_LOST_DISPUTES',
  'KYC',
] as const;
export type LevelRequirementKind = (typeof LEVEL_REQUIREMENT_KINDS)[number];

export interface LevelRequirement {
  readonly kind: LevelRequirementKind;
  readonly current: number;
  readonly required: number;
  readonly met: boolean;
}

export interface NextLevel<TLevel extends string> {
  readonly level: TLevel;
  readonly requirements: readonly LevelRequirement[];
}

function requirement(
  kind: LevelRequirementKind,
  current: number,
  required: number,
): LevelRequirement {
  return { kind, current, required, met: current >= required };
}

/** Następny poziom kupującego albo null (zaufany albo poziom ustawiony ręcznie). */
export function nextBuyerLevel(
  level: BuyerLevel,
  history: BuyerHistory,
  policy: AccountPolicy,
  now: Date,
  levelOverridden: boolean,
): NextLevel<BuyerLevel> | null {
  if (levelOverridden || level === 'TRUSTED') {
    return null;
  }
  const rules = policy.buyer;
  if (level === 'NEW') {
    return {
      level: 'CHECKED',
      requirements: [requirement('PAID_ORDERS', history.paidOrders, rules.checkedAfterPaidOrders)],
    };
  }
  const ageDays = Math.floor((now.getTime() - history.accountCreatedAt.getTime()) / DAY_MS);
  return {
    level: 'TRUSTED',
    requirements: [
      requirement('COMPLETED_ORDERS', history.completedOrders, rules.trustedAfterCompletedOrders),
      requirement('ACCOUNT_AGE_DAYS', ageDays, rules.trustedMinAccountAgeDays),
    ],
  };
}

/** Następny poziom sprzedającego albo null (z KYC albo poziom ustawiony ręcznie). */
export function nextSellerLevel(
  level: SellerLevel,
  history: SellerHistory,
  policy: AccountPolicy,
  levelOverridden: boolean,
): NextLevel<SellerLevel> | null {
  if (levelOverridden || level === 'KYC') {
    return null;
  }
  if (level === 'NEW') {
    return {
      level: 'VERIFIED',
      requirements: [
        requirement(
          'COMPLETED_SALES',
          history.completedSales,
          policy.seller.verifiedAfterCompletedSales,
        ),
        {
          kind: 'NO_LOST_DISPUTES',
          current: history.lostDisputes,
          required: 0,
          met: history.lostDisputes === 0,
        },
      ],
    };
  }
  return {
    level: 'KYC',
    requirements: [{ kind: 'KYC', current: 0, required: 1, met: history.kycVerified }],
  };
}

// Polityka kont (F-61, PROJECT.md §4.1): limity poziomów kupującego i sprzedającego, progi
// poziomów i reguły strike'ów. Wartości domyślne obowiązują, dopóki admin nie zapisze nowej wersji
// (`account_policies`, zmiana bez deployu); poziomy liczą czyste funkcje z historii zamówień.
import { z } from 'zod';

import { BUYER_LEVELS, type BuyerLevel } from '../bidding/buyers.js';
import { SELLER_LEVELS, type SellerLevel } from '../listing/listing.js';

export interface BuyerLevelLimits {
  /** Maks. kwota oferty (maksimum licytacji automatycznej) w groszach albo null (bez limitu). */
  readonly maxBidAmount: number | null;
  /** Maks. liczba aukcji z aktywną ofertą albo null (bez limitu). */
  readonly maxActiveAuctions: number | null;
}

export interface SellerLevelLimits {
  /** Maks. liczba aktywnych aukcji (także czekających na moderatora) albo null (bez limitu). */
  readonly maxActiveAuctions: number | null;
  /** Maks. wartość aukcji w groszach albo null (bez limitu). */
  readonly maxAuctionValue: number | null;
}

const amount = z.int().min(100).max(Number.MAX_SAFE_INTEGER);
const count = z.int().min(1).max(100_000);
const days = z.int().min(1).max(3650);

const buyerLimitsSchema = z
  .object({
    maxBidAmount: amount.nullable().describe('Maks. oferta w groszach albo null (bez limitu)'),
    maxActiveAuctions: count.nullable().describe('Maks. aukcji z aktywną ofertą albo null'),
  })
  .strict();

const sellerLimitsSchema = z
  .object({
    maxActiveAuctions: count.nullable().describe('Maks. aktywnych aukcji albo null'),
    maxAuctionValue: amount.nullable().describe('Maks. wartość aukcji w groszach albo null'),
  })
  .strict();

/** Walidacja polityki (zapis wersji przez admina, odczyt z bazy, odpowiedź API). */
export const accountPolicySchema = z
  .object({
    buyer: z
      .object({
        levels: z
          .object({
            NEW: buyerLimitsSchema,
            CHECKED: buyerLimitsSchema,
            TRUSTED: buyerLimitsSchema,
          })
          .strict(),
        checkedAfterPaidOrders: count.describe('Opłacone zamówienia do poziomu „sprawdzony”'),
        trustedAfterCompletedOrders: count.describe('Zakończone zamówienia do poziomu „zaufany”'),
        trustedMinAccountAgeDays: z.int().min(0).max(3650).describe('Min. wiek konta zaufanego'),
      })
      .strict(),
    seller: z
      .object({
        levels: z
          .object({
            NEW: sellerLimitsSchema,
            VERIFIED: sellerLimitsSchema,
            KYC: sellerLimitsSchema,
          })
          .strict(),
        verifiedAfterCompletedSales: count.describe('Zakończone sprzedaże do „zweryfikowany”'),
        kycExtendedAfterSales: count.describe('Sprzedaże, po których sprzedawca z KYC ma więcej'),
        kycExtendedMaxActiveAuctions: count.describe('Aktywne aukcje sprzedawcy z KYC po progu'),
      })
      .strict(),
    strikes: z
      .object({
        windowDays: days.describe('Strike liczy się do progu przez tyle dni'),
        blockThreshold: z.int().min(1).max(20).describe("Tyle strike'ów w oknie daje blokadę"),
        blockDays: days.describe('Długość pierwszej blokady'),
        escalationWindowDays: days.describe(
          'Kolejna blokada w tylu dniach od poprzedniej jest bezterminowa',
        ),
        appealWindowDays: days.describe('Na odwołanie od nadania jest tyle dni'),
      })
      .strict(),
  })
  .strict();

export type AccountPolicy = z.infer<typeof accountPolicySchema>;

/** Wartości startowe z §4.1 (z decyzjami nr 88 i 110). */
export const DEFAULT_ACCOUNT_POLICY: AccountPolicy = {
  buyer: {
    levels: {
      NEW: { maxBidAmount: 250_000, maxActiveAuctions: 10 },
      CHECKED: { maxBidAmount: 500_000, maxActiveAuctions: 50 },
      TRUSTED: { maxBidAmount: null, maxActiveAuctions: null },
    },
    checkedAfterPaidOrders: 1,
    trustedAfterCompletedOrders: 3,
    trustedMinAccountAgeDays: 30,
  },
  seller: {
    levels: {
      NEW: { maxActiveAuctions: 5, maxAuctionValue: 500_000 },
      VERIFIED: { maxActiveAuctions: 20, maxAuctionValue: 500_000 },
      KYC: { maxActiveAuctions: 50, maxAuctionValue: null },
    },
    verifiedAfterCompletedSales: 3,
    kycExtendedAfterSales: 10,
    kycExtendedMaxActiveAuctions: 100,
  },
  strikes: {
    windowDays: 90,
    blockThreshold: 3,
    blockDays: 30,
    escalationWindowDays: 365,
    appealWindowDays: 180,
  },
};

/** Nadpisania limitów jednego użytkownika (`users.limits`); `null` w limicie = bez limitu. */
export const userLimitsOverrideSchema = z
  .object({
    buyer: z
      .object({
        level: z.enum(BUYER_LEVELS).optional(),
        maxBidAmount: amount.nullable().optional(),
        maxActiveAuctions: count.nullable().optional(),
      })
      .strict()
      .optional(),
    seller: z
      .object({
        level: z.enum(SELLER_LEVELS).optional(),
        maxActiveAuctions: count.nullable().optional(),
        maxAuctionValue: amount.nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type UserLimitsOverride = z.infer<typeof userLimitsOverrideSchema>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Historia zakupów kupującego (z `trade_records`). */
export interface BuyerHistory {
  readonly paidOrders: number;
  readonly completedOrders: number;
  readonly accountCreatedAt: Date;
}

/** Historia sprzedaży (z `trade_records`) i status KYC (F-32). */
export interface SellerHistory {
  readonly completedSales: number;
  readonly lostDisputes: number;
  readonly kycVerified: boolean;
}

/** Poziom kupującego z historii (§4.1); nadpisanie poziomu ma pierwszeństwo. */
export function buyerLevel(
  history: BuyerHistory,
  policy: AccountPolicy,
  now: Date,
  override?: UserLimitsOverride,
): BuyerLevel {
  if (override?.buyer?.level !== undefined) {
    return override.buyer.level;
  }
  const rules = policy.buyer;
  const ageDays = (now.getTime() - history.accountCreatedAt.getTime()) / DAY_MS;
  if (
    history.completedOrders >= rules.trustedAfterCompletedOrders &&
    ageDays >= rules.trustedMinAccountAgeDays
  ) {
    return 'TRUSTED';
  }
  return history.paidOrders >= rules.checkedAfterPaidOrders ? 'CHECKED' : 'NEW';
}

/** Poziom sprzedającego z historii (§4.1); nadpisanie poziomu ma pierwszeństwo. */
export function sellerLevel(
  history: SellerHistory,
  policy: AccountPolicy,
  override?: UserLimitsOverride,
): SellerLevel {
  if (override?.seller?.level !== undefined) {
    return override.seller.level;
  }
  if (history.kycVerified) {
    return 'KYC';
  }
  return history.completedSales >= policy.seller.verifiedAfterCompletedSales &&
    history.lostDisputes === 0
    ? 'VERIFIED'
    : 'NEW';
}

/** Limity kupującego: limity poziomu z nadpisanymi polami. */
export function effectiveBuyerLimits(
  level: BuyerLevel,
  policy: AccountPolicy,
  override?: UserLimitsOverride,
): BuyerLevelLimits {
  const base = policy.buyer.levels[level];
  const custom = override?.buyer;
  return {
    maxBidAmount: custom?.maxBidAmount === undefined ? base.maxBidAmount : custom.maxBidAmount,
    maxActiveAuctions:
      custom?.maxActiveAuctions === undefined ? base.maxActiveAuctions : custom.maxActiveAuctions,
  };
}

/**
 * Limity sprzedającego: limity poziomu z nadpisanymi polami. Sprzedawca z KYC po
 * `kycExtendedAfterSales` zakończonych sprzedażach ma więcej aktywnych aukcji (§4.1).
 */
export function effectiveSellerLimits(
  level: SellerLevel,
  history: Pick<SellerHistory, 'completedSales'>,
  policy: AccountPolicy,
  override?: UserLimitsOverride,
): SellerLevelLimits {
  const base = policy.seller.levels[level];
  const extended =
    level === 'KYC' &&
    base.maxActiveAuctions !== null &&
    history.completedSales >= policy.seller.kycExtendedAfterSales
      ? Math.max(base.maxActiveAuctions, policy.seller.kycExtendedMaxActiveAuctions)
      : base.maxActiveAuctions;
  const custom = override?.seller;
  return {
    maxActiveAuctions:
      custom?.maxActiveAuctions === undefined ? extended : custom.maxActiveAuctions,
    maxAuctionValue:
      custom?.maxAuctionValue === undefined ? base.maxAuctionValue : custom.maxAuctionValue,
  };
}

/** Czy limit jest nadpisany dla danej roli (dopisek „ustawione przez Biddy”). */
export function hasLimitsOverride(
  override: UserLimitsOverride | undefined,
  role: 'buyer' | 'seller',
): boolean {
  const entry = override?.[role];
  return entry !== undefined && Object.keys(entry).length > 0;
}

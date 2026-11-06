import { describe, expect, it } from 'vitest';

import {
  type AccountPolicy,
  accountPolicySchema,
  blockKindOf,
  buyerLevel,
  DEFAULT_ACCOUNT_POLICY,
  effectiveBuyerLimits,
  effectiveSellerLimits,
  hasLimitsOverride,
  sellerLevel,
  strikeRoleOf,
  userLimitsOverrideSchema,
} from '../index.js';

const NOW = new Date('2026-11-02T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
const POLICY = DEFAULT_ACCOUNT_POLICY;

describe('DEFAULT_ACCOUNT_POLICY (§4.1, decyzje nr 88 i 110)', () => {
  it('przechodzi własny schemat', () => {
    expect(accountPolicySchema.parse(POLICY)).toEqual(POLICY);
  });

  it('maks. oferta: nowy 2500 zł, sprawdzony 5000 zł, zaufany bez limitu', () => {
    expect(POLICY.buyer.levels.NEW.maxBidAmount).toBe(250_000);
    expect(POLICY.buyer.levels.CHECKED.maxBidAmount).toBe(500_000);
    expect(POLICY.buyer.levels.TRUSTED.maxBidAmount).toBeNull();
  });

  it('reguły strike’ów: 3 w 90 dni, blokada 30 dni, eskalacja w 365 dniach', () => {
    expect(POLICY.strikes).toMatchObject({
      windowDays: 90,
      blockThreshold: 3,
      blockDays: 30,
      escalationWindowDays: 365,
    });
  });

  it('schemat odrzuca ujemne i zerowe wartości oraz nieznane pola', () => {
    const broken: unknown = {
      ...POLICY,
      strikes: { ...POLICY.strikes, blockThreshold: 0 },
    };
    expect(accountPolicySchema.safeParse(broken).success).toBe(false);
    expect(
      accountPolicySchema.safeParse({
        ...POLICY,
        buyer: {
          ...POLICY.buyer,
          levels: { ...POLICY.buyer.levels, NEW: { maxBidAmount: -1, maxActiveAuctions: 10 } },
        },
      }).success,
    ).toBe(false);
    expect(accountPolicySchema.safeParse({ ...POLICY, extra: true }).success).toBe(false);
  });
});

describe('buyerLevel', () => {
  const history = (paidOrders: number, completedOrders: number, ageDays: number) => ({
    paidOrders,
    completedOrders,
    accountCreatedAt: daysAgo(ageDays),
  });

  it('bez opłaconych zamówień: nowy', () => {
    expect(buyerLevel(history(0, 0, 400), POLICY, NOW)).toBe('NEW');
  });

  it('po pierwszym opłaconym zamówieniu: sprawdzony', () => {
    expect(buyerLevel(history(1, 0, 1), POLICY, NOW)).toBe('CHECKED');
  });

  it('3 zakończone zamówienia i konto ≥ 30 dni: zaufany', () => {
    expect(buyerLevel(history(3, 3, 30), POLICY, NOW)).toBe('TRUSTED');
  });

  it('3 zakończone zamówienia, ale konto młodsze niż 30 dni: sprawdzony', () => {
    expect(buyerLevel(history(3, 3, 29), POLICY, NOW)).toBe('CHECKED');
  });

  it('nadpisany poziom ma pierwszeństwo', () => {
    expect(buyerLevel(history(5, 5, 400), POLICY, NOW, { buyer: { level: 'NEW' } })).toBe('NEW');
  });

  it('progi z polityki, nie stałe w kodzie', () => {
    const strict: AccountPolicy = {
      ...POLICY,
      buyer: { ...POLICY.buyer, checkedAfterPaidOrders: 2 },
    };
    expect(buyerLevel(history(1, 0, 10), strict, NOW)).toBe('NEW');
  });
});

describe('sellerLevel', () => {
  it('bez sprzedaży: nowy', () => {
    expect(sellerLevel({ completedSales: 0, lostDisputes: 0, kycVerified: false }, POLICY)).toBe(
      'NEW',
    );
  });

  it('3 zakończone sprzedaże bez przegranych sporów: zweryfikowany', () => {
    expect(sellerLevel({ completedSales: 3, lostDisputes: 0, kycVerified: false }, POLICY)).toBe(
      'VERIFIED',
    );
  });

  it('przegrany spór zatrzymuje na poziomie nowego', () => {
    expect(sellerLevel({ completedSales: 10, lostDisputes: 1, kycVerified: false }, POLICY)).toBe(
      'NEW',
    );
  });

  it('KYC daje najwyższy poziom', () => {
    expect(sellerLevel({ completedSales: 0, lostDisputes: 0, kycVerified: true }, POLICY)).toBe(
      'KYC',
    );
  });
});

describe('effectiveBuyerLimits i effectiveSellerLimits', () => {
  it('limity poziomu bez nadpisań', () => {
    expect(effectiveBuyerLimits('CHECKED', POLICY)).toEqual({
      maxBidAmount: 500_000,
      maxActiveAuctions: 50,
    });
  });

  it('nadpisane pole wygrywa, null znaczy bez limitu, pozostałe pola z poziomu', () => {
    expect(effectiveBuyerLimits('NEW', POLICY, { buyer: { maxBidAmount: null } })).toEqual({
      maxBidAmount: null,
      maxActiveAuctions: 10,
    });
  });

  it('sprzedawca z KYC po 10 sprzedażach ma 100 aktywnych aukcji', () => {
    expect(effectiveSellerLimits('KYC', { completedSales: 9 }, POLICY).maxActiveAuctions).toBe(50);
    expect(effectiveSellerLimits('KYC', { completedSales: 10 }, POLICY).maxActiveAuctions).toBe(
      100,
    );
  });

  it('nadpisanie limitu aukcji sprzedawcy', () => {
    expect(
      effectiveSellerLimits('NEW', { completedSales: 0 }, POLICY, {
        seller: { maxActiveAuctions: 2, maxAuctionValue: 100_000 },
      }),
    ).toEqual({ maxActiveAuctions: 2, maxAuctionValue: 100_000 });
  });

  it('hasLimitsOverride: tylko niepusta rola', () => {
    expect(hasLimitsOverride(undefined, 'buyer')).toBe(false);
    expect(hasLimitsOverride({ buyer: {} }, 'buyer')).toBe(false);
    expect(hasLimitsOverride({ buyer: { maxBidAmount: null } }, 'buyer')).toBe(true);
    expect(hasLimitsOverride({ buyer: { maxBidAmount: null } }, 'seller')).toBe(false);
  });

  it('schemat nadpisań odrzuca nieznane pola i kwoty poniżej 1 zł', () => {
    expect(userLimitsOverrideSchema.safeParse({ buyer: { maxBid: 1 } }).success).toBe(false);
    expect(userLimitsOverrideSchema.safeParse({ buyer: { maxBidAmount: 50 } }).success).toBe(false);
    expect(userLimitsOverrideSchema.safeParse({ seller: { level: 'KYC' } }).success).toBe(true);
  });
});

describe('strikeRoleOf i blockKindOf', () => {
  it('rola wynika z powodu, przy OTHER ze wskazania', () => {
    expect(strikeRoleOf('UNPAID')).toBe('BUYER');
    expect(strikeRoleOf('AUCTION_CANCELLED_WITH_BIDS')).toBe('SELLER');
    expect(strikeRoleOf('OTHER', 'SELLER')).toBe('SELLER');
  });

  it('kupujący traci licytowanie, sprzedający wystawianie', () => {
    expect(blockKindOf('BUYER')).toBe('BIDDING');
    expect(blockKindOf('SELLER')).toBe('LISTING');
  });
});

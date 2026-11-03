import { describe, expect, it } from 'vitest';

import { isoWeekKey, type PayoutFacts, payoutBlocker } from './payout-rules.js';

const NOW = new Date('2026-11-02T12:00:00Z');

const ready: PayoutFacts = {
  profileComplete: true,
  holdUntil: null,
  block: undefined,
  kycStatus: 'VERIFIED',
  available: 5_000,
  receivable: 0,
  amount: 5_000,
  trigger: 'MANUAL',
  now: NOW,
};

describe('payoutBlocker', () => {
  it('wypłata możliwa: dane, brak blokad, KYC, kwota ≤ saldo i ≥ 20 zł', () => {
    expect(payoutBlocker(ready)).toBeUndefined();
    expect(payoutBlocker({ ...ready, amount: 2_000 })).toBeUndefined();
  });

  it('kolejność: blokada F-61, dane, blokada po zmianie rachunku, należność, saldo, minimum, KYC', () => {
    const everything: PayoutFacts = {
      ...ready,
      block: { id: 'b1', until: null },
      profileComplete: false,
      holdUntil: new Date('2026-11-03T12:00:00Z'),
      receivable: 300,
      available: 0,
      amount: 0,
      kycStatus: 'PENDING',
    };
    expect(payoutBlocker(everything)).toEqual({
      code: 'PAYOUTS_BLOCKED',
      until: null,
      blockId: 'b1',
    });
    expect(payoutBlocker({ ...everything, block: undefined })?.code).toBe(
      'PAYOUT_PROFILE_INCOMPLETE',
    );
    expect(payoutBlocker({ ...everything, block: undefined, profileComplete: true })).toEqual({
      code: 'PAYOUTS_ON_HOLD',
      until: new Date('2026-11-03T12:00:00Z'),
    });
    expect(
      payoutBlocker({ ...everything, block: undefined, profileComplete: true, holdUntil: null }),
    ).toEqual({ code: 'RECEIVABLE_OUTSTANDING', receivable: 300 });
    expect(payoutBlocker({ ...ready, available: 0, amount: 0, kycStatus: 'PENDING' })).toEqual({
      code: 'INSUFFICIENT_BALANCE',
      available: 0,
    });
    expect(payoutBlocker({ ...ready, amount: 1_999, kycStatus: 'PENDING' })).toEqual({
      code: 'PAYOUT_BELOW_MINIMUM',
      minimum: 2_000,
    });
    expect(payoutBlocker({ ...ready, kycStatus: 'PENDING' })?.code).toBe('SELLER_NOT_VERIFIED');
    expect(payoutBlocker({ ...ready, kycStatus: undefined })?.code).toBe('SELLER_NOT_VERIFIED');
  });

  it('blokada po zmianie rachunku kończy się w chwili `holdUntil`', () => {
    expect(payoutBlocker({ ...ready, holdUntil: NOW })).toBeUndefined();
    expect(payoutBlocker({ ...ready, holdUntil: new Date(NOW.getTime() + 1) })?.code).toBe(
      'PAYOUTS_ON_HOLD',
    );
  });

  it('kwota ponad saldo to brak środków; saldo uśpione i zamknięcie konta bez minimum', () => {
    expect(payoutBlocker({ ...ready, amount: 5_001 })?.code).toBe('INSUFFICIENT_BALANCE');
    expect(payoutBlocker({ ...ready, amount: 1_999, trigger: 'WEEKLY' })?.code).toBe(
      'PAYOUT_BELOW_MINIMUM',
    );
    expect(
      payoutBlocker({ ...ready, available: 1_200, amount: 1_200, trigger: 'DORMANT_BALANCE' }),
    ).toBeUndefined();
    expect(
      payoutBlocker({ ...ready, available: 1, amount: 1, trigger: 'ACCOUNT_CLOSURE' }),
    ).toBeUndefined();
  });
});

describe('isoWeekKey', () => {
  it('tydzień ISO 8601 z rokiem czwartku tygodnia', () => {
    expect(isoWeekKey('2026-11-02')).toBe('2026-W45');
    expect(isoWeekKey('2026-11-08')).toBe('2026-W45');
    expect(isoWeekKey('2026-11-09')).toBe('2026-W46');
    // 1 stycznia 2027 to piątek: należy do ostatniego tygodnia 2026 roku (W53).
    expect(isoWeekKey('2027-01-01')).toBe('2026-W53');
    expect(isoWeekKey('2027-01-04')).toBe('2027-W01');
    // 29 grudnia 2025 (poniedziałek) należy do pierwszego tygodnia 2026.
    expect(isoWeekKey('2025-12-29')).toBe('2026-W01');
  });
});

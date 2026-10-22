import { describe, expect, it } from 'vitest';

import { requestHash } from './fake-records.js';
import {
  FAKE_BLIK_CODES,
  paymentScenario,
  registrationStatus,
  sellerShareOfRefund,
} from './fake-scenarios.js';

describe('paymentScenario: magiczne kody BLIK', () => {
  it.each([
    [{ type: 'BLIK', code: FAKE_BLIK_CODES.SUCCEED }, 'SUCCEED'],
    [{ type: 'BLIK', code: FAKE_BLIK_CODES.DECLINE }, 'DECLINE'],
    [{ type: 'BLIK', code: FAKE_BLIK_CODES.HANG }, 'HANG'],
    [{ type: 'BLIK', code: '123456' }, 'INVALID_CODE'],
    [{ type: 'BLIK' }, 'BUYER'],
    [{ type: 'CARD' }, 'BUYER'],
    [{ type: 'PAY_BY_LINK', bankId: 'mbank' }, 'BUYER'],
    [{ type: 'APPLE_PAY' }, 'BUYER'],
  ] as const)('%j → %s', (method, scenario) => {
    expect(paymentScenario(method)).toBe(scenario);
  });

  it('kody z PROJECT.md §7.8', () => {
    expect(FAKE_BLIK_CODES).toEqual({ SUCCEED: '777123', DECLINE: '111111', HANG: '222222' });
  });
});

describe('registrationStatus: symulacja KYC adresem e-mail', () => {
  it.each([
    ['jan@example.com', 'VERIFIED'],
    ['jan+kyc-pending@example.com', 'PENDING'],
    ['Jan+KYC-Rejected@example.com', 'REJECTED'],
    // Znacznik liczy się tylko w części lokalnej adresu.
    ['jan@kyc-rejected.example.com', 'VERIFIED'],
  ])('%s → %s', (email, status) => {
    expect(registrationStatus(email)).toBe(status);
  });
});

describe('sellerShareOfRefund: zwroty schodzą najpierw z części sprzedawcy', () => {
  it.each([
    // [część sprzedawcy, zwrócono wcześniej, zwrot, z salda sprzedawcy]
    [8_000, 0, 3_000, 3_000],
    [8_000, 3_000, 5_000, 5_000],
    [8_000, 6_000, 4_000, 2_000],
    [8_000, 8_000, 2_000, 0],
    [8_000, 0, 10_000, 8_000],
  ])('cena %i, wcześniej %i, zwrot %i → %i', (sellerAmount, before, refund, share) => {
    expect(sellerShareOfRefund(sellerAmount, before, refund)).toBe(share);
  });

  it('suma części z kolejnych zwrotów nie przekracza części sprzedawcy', () => {
    const refunds = [1_500, 2_500, 3_000, 2_000, 1_000];
    let before = 0;
    let total = 0;
    for (const refund of refunds) {
      total += sellerShareOfRefund(8_000, before, refund);
      before += refund;
    }
    expect(total).toBe(8_000);
  });
});

describe('requestHash', () => {
  it('nie zależy od kolejności pól ani od pól undefined, a zależy od wartości', () => {
    expect(requestHash({ a: 1, b: { c: 'x', d: [1, 2] } })).toBe(
      requestHash({ b: { d: [1, 2], c: 'x' }, a: 1, e: undefined }),
    );
    expect(requestHash({ a: 1 })).not.toBe(requestHash({ a: 2 }));
    expect(requestHash({ list: [1, 2] })).not.toBe(requestHash({ list: [2, 1] }));
  });
});

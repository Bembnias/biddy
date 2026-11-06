import { DEFAULT_ACCOUNT_POLICY } from '@biddy/shared';
import { describe, expect, it } from 'vitest';

import { nextBuyerLevel, nextSellerLevel } from './next-level.js';
import {
  counterfeitBlockStatement,
  strikesBlockStatement,
  strikeSourceKey,
  strikeStatement,
} from './statements.js';

const POLICY = DEFAULT_ACCOUNT_POLICY;
const EXPIRES = new Date('2027-01-31T12:00:00.000Z');

describe('strikeStatement (statement of reasons)', () => {
  it('brak płatności: zamówienie, data wygaśnięcia, skutek i odwołanie', () => {
    const text = strikeStatement({
      reason: 'UNPAID',
      role: 'BUYER',
      context: { orderPublicId: 'B-4821', title: 'Wazon' },
      expiresAt: EXPIRES,
      policy: POLICY,
    });
    expect(text).toContain('zamówienie B-4821 („Wazon”)');
    expect(text).toContain('31 stycznia 2027');
    expect(text).toContain("3 strike'i w ciągu 90 dni blokują licytowanie na 30 dni");
    expect(text).toContain('Możesz się odwołać');
  });

  it('anulowanie aukcji z ofertami: tytuł aukcji i blokada wystawiania', () => {
    const text = strikeStatement({
      reason: 'AUCTION_CANCELLED_WITH_BIDS',
      role: 'SELLER',
      context: { title: 'Rower' },
      expiresAt: EXPIRES,
      policy: POLICY,
    });
    expect(text).toMatch(/^Aukcja „Rower” została anulowana, choć miała już oferty\./);
    expect(text).toContain('blokują wystawianie aukcji');
  });

  it('podróbka: notatka personelu i natychmiastowa blokada', () => {
    const text = strikeStatement({
      reason: 'COUNTERFEIT',
      role: 'SELLER',
      context: {},
      note: 'Brak hologramu na metce.',
      expiresAt: EXPIRES,
      policy: POLICY,
    });
    expect(text).toContain('Brak hologramu na metce.');
    expect(text).toContain('zablokowane do decyzji moderatora');
  });
});

describe('uzasadnienia blokad', () => {
  it('terminowa: data końca', () => {
    expect(
      strikesBlockStatement({
        kind: 'BIDDING',
        strikeCount: 3,
        endsAt: new Date('2026-12-02T13:05:00.000Z'),
        policy: POLICY,
      }),
    ).toMatch(/^Licytowanie zablokowane do 2 grudnia 2026 .*14:05, bo w ciągu 90 dni/);
  });

  it('bezterminowa: druga blokada w ciągu 12 miesięcy', () => {
    expect(
      strikesBlockStatement({ kind: 'LISTING', strikeCount: 3, endsAt: null, policy: POLICY }),
    ).toContain('Wystawianie aukcji zablokowane bezterminowo');
  });

  it('podróbka', () => {
    expect(counterfeitBlockStatement('PAYOUTS')).toMatch(/^Wypłaty zablokowane do decyzji/);
  });

  it('klucz źródła', () => {
    expect(strikeSourceKey('UNPAID', 'o-1')).toBe('UNPAID:o-1');
  });
});

describe('następny poziom', () => {
  const NOW = new Date('2026-11-02T12:00:00.000Z');

  it('nowy kupujący: brakuje opłaconego zamówienia', () => {
    expect(
      nextBuyerLevel(
        'NEW',
        { paidOrders: 0, completedOrders: 0, accountCreatedAt: NOW },
        POLICY,
        NOW,
        false,
      ),
    ).toEqual({
      level: 'CHECKED',
      requirements: [{ kind: 'PAID_ORDERS', current: 0, required: 1, met: false }],
    });
  });

  it('sprawdzony: zakończone zamówienia i wiek konta', () => {
    const next = nextBuyerLevel(
      'CHECKED',
      {
        paidOrders: 2,
        completedOrders: 1,
        accountCreatedAt: new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000),
      },
      POLICY,
      NOW,
      false,
    );
    expect(next?.requirements).toEqual([
      { kind: 'COMPLETED_ORDERS', current: 1, required: 3, met: false },
      { kind: 'ACCOUNT_AGE_DAYS', current: 40, required: 30, met: true },
    ]);
  });

  it('zaufany albo poziom nadpisany: brak następnego', () => {
    const history = { paidOrders: 0, completedOrders: 0, accountCreatedAt: NOW };
    expect(nextBuyerLevel('TRUSTED', history, POLICY, NOW, false)).toBeNull();
    expect(nextBuyerLevel('NEW', history, POLICY, NOW, true)).toBeNull();
  });

  it('sprzedawca zweryfikowany: następny to KYC', () => {
    expect(
      nextSellerLevel(
        'VERIFIED',
        { completedSales: 3, lostDisputes: 0, kycVerified: false },
        POLICY,
        false,
      ),
    ).toEqual({
      level: 'KYC',
      requirements: [{ kind: 'KYC', current: 0, required: 1, met: false }],
    });
  });
});

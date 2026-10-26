import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { bidIncrement, money, MoneyError, quickBidAmounts } from '../index.js';

const zl = (value: number) => money(Math.round(value * 100));
const amounts = (minimum: number) =>
  quickBidAmounts(zl(minimum)).map((value) => value.amount / 100);

describe('quickBidAmounts (F-63)', () => {
  it.each([
    [325, [325, 350, 400]],
    [350, [350, 375, 400]],
    [20, [20, 25, 30]],
    [20.5, [20.5, 25, 30]],
    [1, [1, 2.5, 5]],
    [99, [99, 100, 110]],
    [100, [100, 125, 150]],
    [495, [495, 500, 550]],
    [500, [500, 550, 600]],
    [1000, [1000, 1125, 1250]],
    [5000, [5000, 5250, 5500]],
  ])('minimalna %s zł → %j zł', (minimum, expected) => {
    expect(amounts(minimum)).toEqual(expected);
  });

  it('kwoty rosną, pierwsza to minimalna oferta, kolejne są wielokrotnościami kroku', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000_000 }), (amount) => {
        const minimum = money(amount);
        const step = bidIncrement(minimum).amount;
        const [first, second, third] = quickBidAmounts(minimum);
        expect(first).toEqual(minimum);
        expect(second.amount).toBeGreaterThan(first.amount);
        expect(third.amount).toBeGreaterThan(second.amount);
        expect(second.amount % (step * 5)).toBe(0);
        expect(third.amount % (step * 10)).toBe(0);
      }),
    );
  });

  it('waluta bez tabeli przebić: błąd', () => {
    expect(() => quickBidAmounts({ amount: 100, currency: 'EUR' } as never)).toThrow(MoneyError);
  });
});

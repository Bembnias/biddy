import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { bidIncrement, money, MoneyError, minimumNextBid } from '../index.js';

const zl = (value: number) => money(Math.round(value * 100));

describe('bidIncrement: tabela z PROJECT.md §6.3', () => {
  it.each([
    [0, 0.5],
    [19.99, 0.5],
    [20, 1],
    [99.99, 1],
    [100, 5],
    [499.99, 5],
    [500, 10],
    [999.99, 10],
    [1000, 25],
    [4999.99, 25],
    [5000, 50],
    [250_000, 50],
  ])('cena %s zł → przebicie %s zł', (price, increment) => {
    expect(bidIncrement(zl(price))).toEqual(zl(increment));
  });

  it('błędy: ujemna cena, waluta bez tabeli', () => {
    expect(() => bidIncrement(money(-1))).toThrow(MoneyError);
    expect(() => bidIncrement({ amount: 100, currency: 'EUR' } as never)).toThrow(MoneyError);
  });
});

describe('minimumNextBid', () => {
  it('bez ofert: cena wywoławcza', () => {
    expect(minimumNextBid({ startPrice: zl(1), currentPrice: null })).toEqual(zl(1));
  });

  it.each([
    [19.99, 20.49],
    [20, 21],
    [5000, 5050],
  ])('z ofertami: cena %s zł → minimalna oferta %s zł', (price, next) => {
    expect(minimumNextBid({ startPrice: zl(1), currentPrice: zl(price) })).toEqual(zl(next));
  });

  it('własności: oferta zawsze powyżej ceny, przebicie i minimalna oferta rosną z ceną', () => {
    const price = fc.integer({ min: 0, max: 1_000_000_000 });
    fc.assert(
      fc.property(price, price, (a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        const state = (amount: number) => ({ startPrice: money(100), currentPrice: money(amount) });
        expect(minimumNextBid(state(low)).amount).toBeGreaterThan(low);
        expect(bidIncrement(money(low)).amount).toBeLessThanOrEqual(
          bidIncrement(money(high)).amount,
        );
        expect(minimumNextBid(state(low)).amount).toBeLessThanOrEqual(
          minimumNextBid(state(high)).amount,
        );
      }),
    );
  });
});

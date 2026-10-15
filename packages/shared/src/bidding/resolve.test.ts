import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  anonymizeName,
  type AuctionBiddingState,
  bidIncrement,
  type IncomingBid,
  initialBiddingState,
  isReserveMet,
  money,
  replay,
  resolve,
} from '../index.js';

const AUCTION = { currency: 'PLN' as const, startPrice: 1_000, reservePrice: null };

/** Stan po złożeniu ofert po kolei (oferty odrzucone pomija). */
function place(
  bids: readonly [string, number][],
  auction: Pick<AuctionBiddingState, 'currency' | 'startPrice' | 'reservePrice'> = AUCTION,
): AuctionBiddingState {
  let state = initialBiddingState(auction);
  for (const [bidderId, maxAmount] of bids) {
    const result = resolve(state, { bidderId, maxAmount });
    if (result.accepted) {
      state = result.state;
    }
  }
  return state;
}

describe('resolve: reguły z PROJECT.md §6.4', () => {
  it('pierwsza oferta: co najmniej cena wywoławcza, cena = wywoławcza', () => {
    const empty = initialBiddingState(AUCTION);
    expect(resolve(empty, { bidderId: 'a', maxAmount: 999 })).toEqual({
      accepted: false,
      reason: 'BID_TOO_LOW',
      minimumBid: 1_000,
    });
    expect(resolve(empty, { bidderId: 'a', maxAmount: 5_000 })).toEqual({
      accepted: true,
      state: { ...empty, currentPrice: 1_000, leaderId: 'a', leaderMaxAmount: 5_000 },
      bids: [{ bidderId: 'a', kind: 'MANUAL', amount: 1_000, maxAmount: 5_000 }],
      changed: true,
      outbidUserId: null,
    });
  });

  it('nowy lider: cena = min(maksimum, maksimum lidera + krok); poprzedni lider przebity', () => {
    const state = place([['a', 10_000]]);
    const result = resolve(state, { bidderId: 'b', maxAmount: 20_000 });
    expect(result).toMatchObject({
      accepted: true,
      state: { currentPrice: 10_500, leaderId: 'b', leaderMaxAmount: 20_000 },
      bids: [{ bidderId: 'b', kind: 'MANUAL', amount: 10_500 }],
      changed: true,
      outbidUserId: 'a',
    });
    // Maksimum tuż nad liderem: cena = nowe maksimum.
    expect(resolve(state, { bidderId: 'b', maxAmount: 10_100 })).toMatchObject({
      state: { currentPrice: 10_100, leaderId: 'b' },
    });
  });

  it('lider odpowiada automatycznie: cena = min(maksimum lidera, maksimum + krok)', () => {
    const state = place([['a', 10_000]]);
    expect(resolve(state, { bidderId: 'b', maxAmount: 5_000 })).toMatchObject({
      accepted: true,
      // Krok przy 50 zł to 1 zł (§6.3).
      state: { currentPrice: 5_100, leaderId: 'a' },
      bids: [
        { bidderId: 'b', kind: 'MANUAL', amount: 5_000, maxAmount: 5_000 },
        { bidderId: 'a', kind: 'AUTO', amount: 5_100, maxAmount: 10_000 },
      ],
      outbidUserId: null,
    });
  });

  it('remis wygrywa wcześniejsza oferta', () => {
    const state = place([['a', 10_000]]);
    expect(resolve(state, { bidderId: 'b', maxAmount: 10_000 })).toMatchObject({
      state: { currentPrice: 10_000, leaderId: 'a' },
    });
  });

  it('oferta poniżej minimalnej kolejnej: odrzucona z najniższą możliwą kwotą', () => {
    const state = place([
      ['a', 10_000],
      ['b', 1_999],
    ]);
    expect(state.currentPrice).toBe(2_049);
    expect(resolve(state, { bidderId: 'c', maxAmount: 2_099 })).toEqual({
      accepted: false,
      reason: 'BID_TOO_LOW',
      minimumBid: 2_149,
    });
  });

  it('lider podnosi maksimum: cena bez zmian, musi być wyższe niż dotychczas', () => {
    const state = place([
      ['a', 10_000],
      ['b', 5_000],
    ]);
    expect(resolve(state, { bidderId: 'a', maxAmount: 10_000 })).toMatchObject({
      accepted: false,
      minimumBid: 10_001,
    });
    expect(resolve(state, { bidderId: 'a', maxAmount: 30_000 })).toMatchObject({
      accepted: true,
      state: { currentPrice: 5_100, leaderId: 'a', leaderMaxAmount: 30_000 },
      changed: false,
    });
  });

  it('cena minimalna: rośnie do niej, gdy maksimum lidera ją osiąga (także przy podniesieniu)', () => {
    const auction = { ...AUCTION, reservePrice: 15_000 };
    const below = place([['a', 10_000]], auction);
    expect(below.currentPrice).toBe(1_000);
    expect(isReserveMet(below)).toBe(false);

    const raised = resolve(below, { bidderId: 'a', maxAmount: 20_000 });
    expect(raised).toMatchObject({ state: { currentPrice: 15_000 }, changed: true });
    expect(place([['a', 20_000]], auction).currentPrice).toBe(15_000);
    expect(
      place(
        [
          ['a', 12_000],
          ['b', 30_000],
        ],
        auction,
      ),
    ).toMatchObject({
      currentPrice: 15_000,
      leaderId: 'b',
    });
    expect(isReserveMet(place([['a', 20_000]], auction))).toBe(true);
    expect(isReserveMet(place([['a', 20_000]]))).toBeNull();
  });
});

// --- Property-based ---

const auctionArbitrary = fc
  .record({
    startPrice: fc.integer({ min: 100, max: 50_000 }),
    reserveFactor: fc.option(fc.integer({ min: 100, max: 400 }), { nil: null }),
  })
  .map(({ startPrice, reserveFactor }) => ({
    currency: 'PLN' as const,
    startPrice,
    reservePrice: reserveFactor === null ? null : Math.round((startPrice * reserveFactor) / 100),
  }));

const bidsArbitrary = (startPrice: number) =>
  fc.array(
    fc.record({
      bidderId: fc.constantFrom('a', 'b', 'c', 'd', 'e'),
      maxAmount: fc.integer({ min: Math.floor(startPrice / 2), max: startPrice * 6 }),
    }),
    { minLength: 1, maxLength: 40 },
  );

const scenario = auctionArbitrary.chain((auction) =>
  fc.tuple(fc.constant(auction), bidsArbitrary(auction.startPrice)),
);

/**
 * Wzór liczony inaczej niż `resolve` (bez symulowania kolejnych ofert):
 * - lider = najwyższe aktualne maksimum (remis: kto wcześniej je złożył);
 * - S = najwyższe maksimum pozostałych licytujących, złożone ofertą nr tS;
 * - L = maksimum lidera w chwili tS albo, jeśli wtedy było niższe niż S, maksimum, którym lider
 *   później przejął prowadzenie (późniejsze podniesienia nie zmieniają ceny, reguła 5);
 * - cena = min(L, S + krok(S)), a przy jednym licytującym cena wywoławcza;
 * - cena rośnie do ceny minimalnej, gdy końcowe maksimum lidera ją osiąga (reguła 4).
 */
function oracle(
  auction: Pick<AuctionBiddingState, 'currency' | 'startPrice' | 'reservePrice'>,
  accepted: readonly IncomingBid[],
) {
  const latest = new Map<string, { max: number; index: number }>();
  accepted.forEach((bid, index) => latest.set(bid.bidderId, { max: bid.maxAmount, index }));
  const ranked = [...latest.entries()].sort(([, a], [, b]) => b.max - a.max || a.index - b.index);
  const [leader, second] = ranked;
  if (leader === undefined) {
    return { leaderId: null, currentPrice: null };
  }
  const [leaderId, { max: leaderMax }] = leader;
  let price = auction.startPrice;
  if (second !== undefined) {
    const { max: s, index: tS } = second[1];
    const leaderBids = accepted
      .map((bid, index) => ({ ...bid, index }))
      .filter((bid) => bid.bidderId === leaderId);
    const atTs = Math.max(
      0,
      ...leaderBids.filter((bid) => bid.index <= tS).map((bid) => bid.maxAmount),
    );
    const takeover = leaderBids.find((bid) => bid.index > tS && bid.maxAmount > s)?.maxAmount;
    const l = atTs >= s ? atTs : (takeover ?? leaderMax);
    price = Math.min(l, s + bidIncrement(money(s)).amount);
  }
  if (auction.reservePrice !== null && leaderMax >= auction.reservePrice) {
    price = Math.max(price, auction.reservePrice);
  }
  return { leaderId, currentPrice: price };
}

describe('resolve: własności (property-based)', () => {
  it('niezmienniki §15.1 po każdej ofercie', () => {
    fc.assert(
      fc.property(scenario, ([auction, bids]) => {
        let state = initialBiddingState(auction);
        for (const bid of bids) {
          const result = resolve(state, bid);
          if (!result.accepted) {
            expect(result.minimumBid).toBeGreaterThan(bid.maxAmount);
            continue;
          }
          const next = result.state;
          const price = next.currentPrice ?? 0;
          // Cena nie maleje, nie przekracza maksimum lidera, nie jest niższa niż wywoławcza.
          expect(price).toBeGreaterThanOrEqual(state.currentPrice ?? 0);
          expect(price).toBeLessThanOrEqual(next.leaderMaxAmount ?? 0);
          expect(price).toBeGreaterThanOrEqual(auction.startPrice);
          // „Zmiana” = zmiana ceny albo lidera (warunek anti-snipingu).
          expect(result.changed).toBe(
            price !== state.currentPrice || next.leaderId !== state.leaderId,
          );
          // Kwota każdej zapisanej oferty nie przekracza jej maksimum.
          for (const saved of result.bids) {
            expect(saved.amount).toBeLessThanOrEqual(saved.maxAmount);
          }
          state = next;
        }
      }),
      { numRuns: 300 },
    );
  });

  it('stan po kolejnych ofertach = wzór niezależny (lider, cena, remis, cena minimalna)', () => {
    fc.assert(
      fc.property(scenario, ([auction, bids]) => {
        const result = replay(auction, bids);
        const accepted = result.steps
          .filter((step) => step.result.accepted)
          .map((step) => step.bid);
        expect({
          leaderId: result.state.leaderId,
          currentPrice: result.state.currentPrice,
        }).toEqual(oracle(auction, accepted));
      }),
      { numRuns: 500 },
    );
  });

  it('replay bez unieważnionej oferty = złożenie pozostałych ofert po kolei', () => {
    fc.assert(
      fc.property(scenario, fc.nat(), ([auction, bids], pick) => {
        const accepted = replay(auction, bids)
          .steps.filter((step) => step.result.accepted)
          .map((step) => step.bid);
        const remaining = accepted.filter((_, index) => index !== pick % accepted.length);
        const replayed = replay(auction, remaining);
        let state = initialBiddingState(auction);
        const saved = [];
        for (const bid of remaining) {
          const result = resolve(state, bid);
          if (result.accepted) {
            state = result.state;
            saved.push(...result.bids);
          }
        }
        expect(replayed.state).toEqual(state);
        expect(replayed.bids).toEqual(saved);
      }),
    );
  });
});

describe('anonymizeName', () => {
  it.each([
    ['Kasia Kupująca', 'k***a'],
    ['Łukasz', 'ł***z'],
    ['A', 'a***'],
    ['  !!  ', '***'],
  ])('%s → %s', (name, expected) => {
    expect(anonymizeName(name)).toBe(expected);
  });
});

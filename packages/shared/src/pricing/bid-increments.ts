// Kroki przebicia (F-13, PROJECT.md §6.3): minimalne przebicie zależy od aktualnej ceny.
// Tabela jest w kodzie, a nie w bazie: silnik licytacji (F-15) przelicza historię ofert od nowa
// (§15.6) i musi dostać ten sam wynik, a formularz oferty pokazuje tę samą minimalną ofertę.
import { add } from '../money/arithmetic.js';
import type { CurrencyCode } from '../money/currency.js';
import { MoneyError } from '../money/errors.js';
import { assertMoney, money, type Money } from '../money/money.js';

export interface BidIncrementBand {
  /** Dolna granica przedziału aktualnej ceny w groszach (włącznie). */
  readonly from: number;
  /** Minimalne przebicie w groszach. */
  readonly increment: number;
}

/** Tabela z §6.3 (PLN): przedziały rosnąco, każdy do początku następnego. */
export const BID_INCREMENTS: Readonly<Partial<Record<CurrencyCode, readonly BidIncrementBand[]>>> =
  {
    PLN: [
      { from: 0, increment: 50 },
      { from: 2_000, increment: 100 },
      { from: 10_000, increment: 500 },
      { from: 50_000, increment: 1_000 },
      { from: 100_000, increment: 2_500 },
      { from: 500_000, increment: 5_000 },
    ],
  };

/**
 * Minimalne przebicie przy danej aktualnej cenie.
 *
 * @example bidIncrement(money(1_999)) // 50 gr; bidIncrement(money(2_000)) // 1 zł
 * @throws {MoneyError} gdy cena jest ujemna albo waluta nie ma tabeli przebić
 */
export function bidIncrement(currentPrice: Money): Money {
  assertMoney(currentPrice);
  if (currentPrice.amount < 0) {
    throw new MoneyError(`Cena nie może być ujemna, otrzymano ${currentPrice.amount}`);
  }
  const bands = BID_INCREMENTS[currentPrice.currency];
  if (bands === undefined) {
    throw new MoneyError(`Brak tabeli kroków przebicia dla waluty ${currentPrice.currency}`);
  }
  let increment = bands[0]?.increment ?? 0;
  for (const band of bands) {
    if (currentPrice.amount >= band.from) {
      increment = band.increment;
    }
  }
  return money(increment, currentPrice.currency);
}

export interface BiddingState {
  readonly startPrice: Money;
  /** Aktualna cena albo null, gdy aukcja nie ma jeszcze ofert. */
  readonly currentPrice: Money | null;
}

/**
 * Najniższa ważna oferta (§6.4, reguła 1): bez ofert cena wywoławcza, z ofertami aktualna cena
 * plus minimalne przebicie.
 *
 * @example minimumNextBid({ startPrice: money(100), currentPrice: money(1_999) }) // 20,49 zł
 */
export function minimumNextBid(state: BiddingState): Money {
  assertMoney(state.startPrice);
  if (state.currentPrice === null) {
    return state.startPrice;
  }
  return add(state.currentPrice, bidIncrement(state.currentPrice));
}

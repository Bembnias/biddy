import type { CurrencyCode } from './currency.js';
import { MoneyError } from './errors.js';
import { assertMoney, assertSafeInteger, assertSameCurrency, money, type Money } from './money.js';

// Każda operacja sprawdza walutę i zakres wyniku: przekroczenie `Number.MAX_SAFE_INTEGER`
// kończy się błędem `MoneyError`, a nie cichą utratą precyzji.

/** a + b */
export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(BigInt(a.amount) + BigInt(b.amount), a.currency);
}

/** a − b */
export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(BigInt(a.amount) - BigInt(b.amount), a.currency);
}

/**
 * Mnożenie przez liczbę całkowitą (np. liczbę sztuk).
 * Do mnożenia przez ułamek lub procent służą `percentOf` i `divideRoundHalfUp`.
 */
export function multiply(m: Money, factor: number): Money {
  assertMoney(m);
  assertSafeInteger(factor, 'Mnożnik');
  return money(BigInt(m.amount) * BigInt(factor), m.currency);
}

/** −m */
export function negate(m: Money): Money {
  assertMoney(m);
  return money(-m.amount, m.currency);
}

/** |m| */
export function abs(m: Money): Money {
  assertMoney(m);
  return money(Math.abs(m.amount), m.currency);
}

/**
 * Suma listy kwot. Dla listy, która może być pusta, waluta musi być podana jawnie,
 * bo z pustej listy nie da się jej odczytać.
 */
export function sum(items: readonly [Money, ...Money[]]): Money;
export function sum(items: readonly Money[], currency: CurrencyCode): Money;
export function sum(items: readonly Money[], currency?: CurrencyCode): Money {
  let resolved = currency;
  if (resolved === undefined) {
    const [first] = items;
    if (first === undefined) {
      throw new MoneyError('Suma pustej listy kwot wymaga jawnie podanej waluty');
    }
    assertMoney(first);
    resolved = first.currency;
  }
  const reference = money(0, resolved);
  // Sumujemy w bigint, więc przejściowe przekroczenie zakresu (np. [MAX, 1, −1]) nie jest błędem;
  // liczy się tylko wynik końcowy.
  let total = 0n;
  for (const item of items) {
    assertSameCurrency(reference, item);
    total += BigInt(item.amount);
  }
  return money(total, resolved);
}

/** Porównanie do sortowania: −1 gdy a < b, 0 gdy równe, 1 gdy a > b. */
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amount < b.amount) {
    return -1;
  }
  return a.amount > b.amount ? 1 : 0;
}

/**
 * Czy kwoty są równe. Porównanie kwot w różnych walutach to błąd programisty,
 * dlatego rzuca `CurrencyMismatchError` zamiast zwracać `false`.
 */
export function equals(a: Money, b: Money): boolean {
  return compare(a, b) === 0;
}

/** m = 0 */
export function isZero(m: Money): boolean {
  assertMoney(m);
  return m.amount === 0;
}

/** m > 0 */
export function isPositive(m: Money): boolean {
  assertMoney(m);
  return m.amount > 0;
}

/** m < 0 */
export function isNegative(m: Money): boolean {
  assertMoney(m);
  return m.amount < 0;
}

/** Najmniejsza z podanych kwot (wszystkie w tej samej walucie). */
export function min(first: Money, ...rest: readonly Money[]): Money {
  return pick(first, rest, (candidate, best) => compare(candidate, best) < 0);
}

/** Największa z podanych kwot (wszystkie w tej samej walucie). */
export function max(first: Money, ...rest: readonly Money[]): Money {
  return pick(first, rest, (candidate, best) => compare(candidate, best) > 0);
}

function pick(
  first: Money,
  rest: readonly Money[],
  isBetter: (candidate: Money, best: Money) => boolean,
): Money {
  assertMoney(first);
  let best = first;
  for (const candidate of rest) {
    if (isBetter(candidate, best)) {
      best = candidate;
    }
  }
  return best;
}

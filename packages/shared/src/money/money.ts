import { DEFAULT_CURRENCY, isCurrencyCode, type CurrencyCode } from './currency.js';
import { CurrencyMismatchError, MoneyError } from './errors.js';

/**
 * Kwota pieniężna: całkowita liczba jednostek podrzędnych waluty (dla PLN: groszy) plus waluta.
 * Zwykły obiekt, bez klas, więc przechodzi bez zmian przez JSON, API i bazę danych.
 *
 * @example { amount: 1299, currency: 'PLN' } // 12,99 zł
 */
export type Money = {
  readonly amount: number;
  readonly currency: CurrencyCode;
};

/** Granice zakresu kwot jako bigint (zakres `Number.isSafeInteger`). */
export const MAX_AMOUNT = BigInt(Number.MAX_SAFE_INTEGER);
export const MIN_AMOUNT = BigInt(Number.MIN_SAFE_INTEGER);

/**
 * Tworzy kwotę z liczby jednostek podrzędnych (groszy).
 * Przyjmuje `number` (musi być bezpieczną liczbą całkowitą) albo `bigint` (np. z kolumny `bigint`
 * w Postgresie lub z obliczeń pośrednich), o ile mieści się w bezpiecznym zakresie.
 *
 * @example money(1299) // 12,99 zł
 * @throws {MoneyError} gdy kwota nie jest całkowita, wykracza poza zakres lub waluta jest nieznana
 */
export function money(amount: number | bigint, currency: CurrencyCode = DEFAULT_CURRENCY): Money {
  assertCurrencyCode(currency);
  return { amount: toSafeAmount(amount), currency };
}

/** Kwota zerowa w danej walucie. */
export function zero(currency: CurrencyCode = DEFAULT_CURRENCY): Money {
  return money(0, currency);
}

/** Sprawdza w czasie działania, czy wartość jest poprawną kwotą (np. dane z API lub bazy). */
export function isMoney(value: unknown): value is Money {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { amount, currency } = value as Record<string, unknown>;
  return Number.isSafeInteger(amount) && isCurrencyCode(currency);
}

// --- Funkcje wewnętrzne modułu (nie są eksportowane z pakietu) ---

/** Zamienia kwotę na bezpieczną liczbę całkowitą; normalizuje -0 do 0. */
function toSafeAmount(amount: number | bigint): number {
  if (typeof amount === 'bigint') {
    if (amount > MAX_AMOUNT || amount < MIN_AMOUNT) {
      throw new MoneyError(`Kwota ${amount} wykracza poza bezpieczny zakres liczb całkowitych`);
    }
    return Number(amount);
  }
  if (typeof amount !== 'number') {
    throw new MoneyError(`Kwota musi być liczbą lub bigint, otrzymano ${typeof amount}`);
  }
  if (!Number.isSafeInteger(amount)) {
    throw new MoneyError(
      Number.isInteger(amount)
        ? `Kwota ${amount} wykracza poza bezpieczny zakres liczb całkowitych`
        : `Kwota musi być całkowitą liczbą jednostek podrzędnych (groszy), otrzymano ${amount}`,
    );
  }
  return amount === 0 ? 0 : amount;
}

/** @throws {MoneyError} gdy waluta nie jest obsługiwana */
export function assertCurrencyCode(currency: unknown): asserts currency is CurrencyCode {
  if (!isCurrencyCode(currency)) {
    throw new MoneyError(`Nieobsługiwana waluta: ${String(currency)}`);
  }
}

/** @throws {MoneyError} gdy wartość nie jest poprawną kwotą (np. ułamkowe grosze z błędnych danych) */
export function assertMoney(value: Money): void {
  if (!isMoney(value)) {
    throw new MoneyError(`Nieprawidłowa kwota: ${safeStringify(value)}`);
  }
}

/** @throws {CurrencyMismatchError} gdy kwoty są w różnych walutach */
export function assertSameCurrency(expected: Money, actual: Money): void {
  assertMoney(expected);
  assertMoney(actual);
  if (expected.currency !== actual.currency) {
    throw new CurrencyMismatchError(expected.currency, actual.currency);
  }
}

/** @throws {MoneyError} gdy wartość nie jest bezpieczną liczbą całkowitą */
export function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} musi być bezpieczną liczbą całkowitą, otrzymano ${value}`);
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

import type { CurrencyCode } from './currency.js';

/** Bazowy błąd operacji na kwotach: niecałkowita kwota, przekroczenie zakresu, zła waluta itp. */
export class MoneyError extends Error {
  override name = 'MoneyError';
}

/** Próba połączenia kwot w różnych walutach (dodawanie, porównanie, suma). */
export class CurrencyMismatchError extends MoneyError {
  override name = 'CurrencyMismatchError';
  readonly expected: CurrencyCode;
  readonly actual: CurrencyCode;

  constructor(expected: CurrencyCode, actual: CurrencyCode) {
    super(`Niezgodne waluty: oczekiwano ${expected}, otrzymano ${actual}`);
    this.expected = expected;
    this.actual = actual;
  }
}

/** Powód odrzucenia tekstu przez `parseMoney`, do zmapowania na komunikat w UI. */
export type MoneyParseErrorReason =
  'EMPTY' | 'INVALID_FORMAT' | 'TOO_MANY_DECIMALS' | 'OUT_OF_RANGE';

/** Tekst wpisany przez użytkownika nie jest poprawną kwotą. */
export class MoneyParseError extends MoneyError {
  override name = 'MoneyParseError';
  readonly reason: MoneyParseErrorReason;
  readonly input: string;

  constructor(reason: MoneyParseErrorReason, input: string, message: string) {
    super(message);
    this.reason = reason;
    this.input = input;
  }
}

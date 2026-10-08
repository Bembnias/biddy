/** Opis waluty obsługiwanej przez Biddy. */
export type CurrencyInfo = {
  /** Kod ISO 4217. */
  readonly code: string;
  /** Liczba miejsc po przecinku jednostki podrzędnej (PLN: 2, czyli kwoty w groszach). */
  readonly minorUnits: number;
  /** Symbol, który użytkownik może dopisać do kwoty w polu tekstowym (np. „zł”). */
  readonly symbol: string;
};

/**
 * Rejestr obsługiwanych walut. Na start tylko PLN; kolejną walutę (np. EUR) dodajemy wpisem tutaj,
 * a typ `CurrencyCode`, formatowanie i parsowanie biorą ją stąd automatycznie.
 */
export const CURRENCIES = {
  PLN: { code: 'PLN', minorUnits: 2, symbol: 'zł' },
} as const satisfies Record<string, CurrencyInfo>;

/** Kod obsługiwanej waluty. */
export type CurrencyCode = keyof typeof CURRENCIES;

/** Waluta domyślna platformy. */
export const DEFAULT_CURRENCY: CurrencyCode = 'PLN';

/** Sprawdza, czy wartość to kod obsługiwanej waluty (np. przy danych z API lub bazy). */
export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && Object.hasOwn(CURRENCIES, value);
}

/** Zwraca opis waluty. */
export function getCurrency(code: CurrencyCode): CurrencyInfo {
  return CURRENCIES[code];
}

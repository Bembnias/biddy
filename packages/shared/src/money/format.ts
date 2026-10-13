import { getCurrency, type CurrencyCode } from './currency.js';
import { MoneyError } from './errors.js';
import { assertMoney, type Money } from './money.js';

/**
 * Kwota jako dokładny ciąg dziesiętny z kropką, bez separatorów tysięcy i symbolu waluty,
 * np. do API płatności, eksportu dla księgowości lub logów.
 *
 * @example toDecimalString(money(1299)) // "12.99"
 * @example toDecimalString(money(-5)) // "-0.05"
 */
export function toDecimalString(m: Money): `${number}` {
  assertMoney(m);
  const { minorUnits } = getCurrency(m.currency);
  const sign = m.amount < 0 ? '-' : '';
  // Bezpieczna liczba całkowita zawsze ma zapis bez wykładnika, więc String() daje same cyfry.
  const digits = String(Math.abs(m.amount)).padStart(minorUnits + 1, '0');
  if (minorUnits === 0) {
    return `${sign}${digits}` as `${number}`;
  }
  const integerPart = digits.slice(0, -minorUnits);
  const fractionPart = digits.slice(-minorUnits);
  return `${sign}${integerPart}.${fractionPart}` as `${number}`;
}

export type FormatMoneyOptions = {
  /** Locale BCP 47, domyślnie `pl-PL`. */
  readonly locale?: string;
  /**
   * `auto` (domyślnie) zawsze pokazuje grosze („100,00 zł”), `stripIfInteger` pomija je przy
   * pełnych kwotach („100 zł”, ale „109,99 zł” i „0,50 zł”), np. w tekście
   * „Licytujesz 100 zł · zapłacisz 109,99 zł” (PROJECT.md §3.1) albo w tabeli kroków przebicia (§6.3).
   */
  readonly trailingZeroDisplay?: 'auto' | 'stripIfInteger';
};

/**
 * Kwota sformatowana do wyświetlenia, np. „12,99 zł” albo „12 345,67 zł”.
 *
 * Do `Intl.NumberFormat` przekazujemy dokładny ciąg dziesiętny, a nie `amount / 100`, więc
 * nawet kwoty z górnej granicy zakresu nie tracą groszy na zaokrągleniu liczby zmiennoprzecinkowej.
 *
 * Uwaga: dla `pl-PL` separatorem tysięcy i odstępem przed „zł” jest twarda spacja (U+00A0),
 * a liczby czterocyfrowe nie są grupowane („1000,00 zł”, ale „12 345,67 zł”).
 *
 * @throws {MoneyError} gdy kwota jest nieprawidłowa (także nieobsługiwana waluta) albo locale
 *   lub inne opcje są niepoprawne (np. surowy nagłówek `Accept-Language`: „pl-PL,en;q=0.9”)
 */
export function formatMoney(m: Money, options: FormatMoneyOptions = {}): string {
  const { locale = 'pl-PL', trailingZeroDisplay = 'auto' } = options;
  // Najpierw walidacja kwoty (w toDecimalString), żeby zła waluta dała MoneyError, a nie błąd Intl.
  const decimal = toDecimalString(m);
  return getFormatter(locale, m.currency, trailingZeroDisplay).format(decimal);
}

// Tworzenie Intl.NumberFormat jest kosztowne, a na liście ofert formatujemy dziesiątki kwot.
// Pamięć podręczna ma limit, bo locale może pochodzić z nagłówków żądania.
const FORMATTER_CACHE_LIMIT = 32;
const formatters = new Map<string, Intl.NumberFormat>();

function getFormatter(
  locale: string,
  currency: CurrencyCode,
  trailingZeroDisplay: NonNullable<FormatMoneyOptions['trailingZeroDisplay']>,
): Intl.NumberFormat {
  const key = `${locale}|${currency}|${trailingZeroDisplay}`;
  const cached = formatters.get(key);
  if (cached) {
    return cached;
  }
  const { minorUnits } = getCurrency(currency);
  let formatter: Intl.NumberFormat;
  try {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: minorUnits,
      maximumFractionDigits: minorUnits,
      trailingZeroDisplay,
    });
  } catch (error) {
    // Waluta jest już zwalidowana, więc Intl odrzuca tu locale albo pozostałe opcje.
    throw new MoneyError(
      `Nieprawidłowe opcje formatowania kwoty (locale: „${String(locale)}”, trailingZeroDisplay: „${String(trailingZeroDisplay)}”)`,
      { cause: error },
    );
  }
  if (formatters.size >= FORMATTER_CACHE_LIMIT) {
    formatters.clear();
  }
  formatters.set(key, formatter);
  return formatter;
}

import { DEFAULT_CURRENCY, getCurrency, type CurrencyCode, type CurrencyInfo } from './currency.js';
import { MoneyParseError } from './errors.js';
import { assertCurrencyCode, MAX_AMOUNT, MIN_AMOUNT, money, type Money } from './money.js';

/**
 * Liczba z opcjonalnym minusem (także U+2212), częścią całkowitą bez separatorów („1234”)
 * albo pogrupowaną po trzy cyfry spacją, twardą spacją lub wąską twardą spacją („1 234”),
 * oraz opcjonalną częścią ułamkową po przecinku lub kropce. Kropka i przecinek nie mogą
 * pełnić roli separatora tysięcy, więc „1.234,50” i „1,234.50” są odrzucane jako niejednoznaczne.
 */
const AMOUNT_PATTERN =
  /^(?<sign>[-\u2212])?(?<integer>[0-9]+|[0-9]{1,3}(?:[ \u00A0\u202F][0-9]{3})+)(?:[.,](?<fraction>[0-9]+))?$/;

const GROUP_SEPARATORS = /[ \u00A0\u202F]/g;

const LEADING_ZEROS = /^0+/;

/** Najwięcej cyfr znaczących, jakie może mieć kwota w bezpiecznym zakresie (16). */
const MAX_AMOUNT_DIGITS = MAX_AMOUNT.toString().length;

/**
 * Parsuje kwotę wpisaną przez użytkownika, np. „12”, „12,9”, „12,99”, „12.99”, „1 234,50”,
 * „-5 zł”. Działa na liczbach całkowitych (bigint), nigdy na `parseFloat`.
 *
 * Akceptuje: opcjonalny minus na początku, separator dziesiętny „,” lub „.”, spacje (także
 * twarde) jako separatory tysięcy, opcjonalny symbol („zł”) lub kod („PLN”) waluty na końcu.
 * Wynik `formatMoney` dla `pl-PL` można sparsować z powrotem.
 *
 * @throws {MoneyParseError} z polem `reason`: `EMPTY`, `INVALID_FORMAT`, `TOO_MANY_DECIMALS`
 *   (więcej cyfr po przecinku, niż ma waluta) albo `OUT_OF_RANGE`
 */
export function parseMoney(input: string, currency: CurrencyCode = DEFAULT_CURRENCY): Money {
  assertCurrencyCode(currency);
  if (typeof input !== 'string') {
    throw new MoneyParseError('INVALID_FORMAT', String(input), 'Kwota musi być tekstem');
  }
  const info = getCurrency(currency);
  const text = stripCurrencySuffix(input.trim(), info);
  if (text === '') {
    throw new MoneyParseError('EMPTY', input, 'Nie podano kwoty');
  }

  const groups = AMOUNT_PATTERN.exec(text)?.groups;
  const integer = groups?.['integer'];
  if (groups === undefined || integer === undefined) {
    throw new MoneyParseError('INVALID_FORMAT', input, `Nieprawidłowy format kwoty: „${input}”`);
  }
  const fraction = groups['fraction'] ?? '';
  if (fraction.length > info.minorUnits) {
    throw new MoneyParseError(
      'TOO_MANY_DECIMALS',
      input,
      info.minorUnits === 0
        ? `Kwota w ${info.code} nie może mieć części ułamkowej`
        : `Za dużo cyfr po przecinku (maksymalnie ${info.minorUnits})`,
    );
  }

  const digits = (
    integer.replace(GROUP_SEPARATORS, '') + fraction.padEnd(info.minorUnits, '0')
  ).replace(LEADING_ZEROS, '');
  // Liczbę cyfr sprawdzamy przed BigInt(): konwersja bardzo długiego ciągu (np. z formularza
  // lub CSV) kosztuje czas superliniowy, a wynik i tak byłby poza zakresem.
  if (digits.length > MAX_AMOUNT_DIGITS) {
    throw outOfRange(input);
  }
  const magnitude = BigInt(digits === '' ? '0' : digits);
  const amount = groups['sign'] === undefined ? magnitude : -magnitude;
  if (amount > MAX_AMOUNT || amount < MIN_AMOUNT) {
    throw outOfRange(input);
  }
  return money(amount, currency);
}

function outOfRange(input: string): MoneyParseError {
  return new MoneyParseError('OUT_OF_RANGE', input, 'Kwota jest poza obsługiwanym zakresem');
}

/** Usuwa z końca symbol lub kod waluty (bez rozróżniania wielkości liter) i odstęp przed nim. */
function stripCurrencySuffix(text: string, info: CurrencyInfo): string {
  const lower = text.toLowerCase();
  for (const suffix of [info.symbol, info.code]) {
    if (lower.endsWith(suffix.toLowerCase())) {
      return text.slice(0, text.length - suffix.length).trimEnd();
    }
  }
  return text;
}

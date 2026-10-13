import { describe, expect, it } from 'vitest';
import { formatMoney, money, MoneyError, toDecimalString, type Money } from './index.js';

const MAX = Number.MAX_SAFE_INTEGER;
const MIN = Number.MIN_SAFE_INTEGER;
const pln = (amount: number): Money => money(amount);

/** Twarda spacja: separator tysięcy i odstęp przed „zł” w pl-PL. */
const NBSP = '\u00A0';

describe('toDecimalString', () => {
  it.each([
    [0, '0.00'],
    [1, '0.01'],
    [5, '0.05'],
    [10, '0.10'],
    [99, '0.99'],
    [100, '1.00'],
    [1_299, '12.99'],
    [100_000, '1000.00'],
    [123_456_789, '1234567.89'],
    [-1, '-0.01'],
    [-5, '-0.05'],
    [-100, '-1.00'],
    [-1_299, '-12.99'],
    [MAX, '90071992547409.91'],
    [MIN, '-90071992547409.91'],
  ])('%i gr → "%s"', (amount, expected) => {
    expect(toDecimalString(pln(amount))).toBe(expected);
  });

  it('-0 z JSON-a daje "0.00", bez minusa', () => {
    expect(toDecimalString({ amount: -0, currency: 'PLN' })).toBe('0.00');
  });

  it('odrzuca nieprawidłową kwotę', () => {
    expect(() => toDecimalString({ amount: 12.5, currency: 'PLN' })).toThrow(MoneyError);
  });
});

describe('formatMoney', () => {
  it.each([
    [0, `0,00${NBSP}zł`],
    [5, `0,05${NBSP}zł`],
    [1_299, `12,99${NBSP}zł`],
    [-5, `-0,05${NBSP}zł`],
    [-1_299, `-12,99${NBSP}zł`],
    // pl-PL nie grupuje liczb czterocyfrowych...
    [100_000, `1000,00${NBSP}zł`],
    [999_999, `9999,99${NBSP}zł`],
    [-123_450, `-1234,50${NBSP}zł`],
    // ...ale grupuje od pięciu cyfr, twardą spacją
    [1_000_000, `10${NBSP}000,00${NBSP}zł`],
    [1_234_567, `12${NBSP}345,67${NBSP}zł`],
    [123_456_789, `1${NBSP}234${NBSP}567,89${NBSP}zł`],
    [-1_234_567, `-12${NBSP}345,67${NBSP}zł`],
  ])('pl-PL: %i gr → "%s"', (amount, expected) => {
    expect(formatMoney(pln(amount))).toBe(expected);
    expect(formatMoney(pln(amount), { locale: 'pl-PL' })).toBe(expected);
  });

  it('formatuje dokładny ciąg dziesiętny, a nie amount / 100 (brak utraty groszy na górze zakresu)', () => {
    // Jako float 90071992547409.91 to 90071992547409.906..., więc wyszłoby „…409,90 zł”.
    expect(formatMoney(pln(MAX))).toBe(`90${NBSP}071${NBSP}992${NBSP}547${NBSP}409,91${NBSP}zł`);
    expect(formatMoney(pln(MIN))).toBe(`-90${NBSP}071${NBSP}992${NBSP}547${NBSP}409,91${NBSP}zł`);
  });

  it.each([
    ['en-US', 1_234_567, `PLN${NBSP}12,345.67`],
    ['en-US', -5, `-PLN${NBSP}0.05`],
    ['de-DE', 1_234_567, `12.345,67${NBSP}PLN`],
  ])('inne locale (%s): %i gr → "%s"', (locale, amount, expected) => {
    expect(formatMoney(pln(amount), { locale })).toBe(expected);
  });

  it('wielokrotne formatowanie (z pamięci podręcznej formatterów) daje ten sam wynik', () => {
    const results = new Set<string>();
    for (let i = 0; i < 3; i++) {
      for (const locale of ['pl-PL', 'en-US', 'de-DE', 'pl-PL']) {
        results.add(`${locale}:${formatMoney(pln(1_299), { locale })}`);
      }
    }
    expect([...results].sort()).toEqual([
      'de-DE:12,99\u00A0PLN',
      'en-US:PLN\u00A012.99',
      'pl-PL:12,99\u00A0zł',
    ]);
  });

  it('odrzuca nieprawidłową kwotę', () => {
    expect(() => formatMoney({ amount: 0.5, currency: 'PLN' })).toThrow(MoneyError);
  });

  it.each([
    ['nieobsługiwana waluta', { amount: 100, currency: 'XYZ' }],
    ['waluta spoza rejestru, ale znana Intl', { amount: 100, currency: 'EUR' }],
    ['klucz z prototypu zamiast waluty', { amount: 1, currency: 'toString' }],
    ['null', null],
    ['undefined', undefined],
  ])('%s: rzuca MoneyError, a nie TypeError/RangeError z Intl', (_label, value) => {
    expect(() => formatMoney(value as unknown as Money)).toThrow(MoneyError);
    expect(() => formatMoney(value as unknown as Money)).toThrow(/^Nieprawidłowa kwota/);
  });

  it.each(['en_US', 'pl-PL,en;q=0.9', '', 'x'])(
    'nieprawidłowe locale "%s": rzuca MoneyError z przyczyną z Intl',
    (locale) => {
      let caught: unknown;
      try {
        formatMoney(pln(1_299), { locale });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(MoneyError);
      expect((caught as MoneyError).message).toContain(`locale: „${locale}”`);
      expect((caught as MoneyError).cause).toBeInstanceOf(RangeError);
      // Po błędzie poprawne formatowanie nadal działa (zły formatter nie trafia do pamięci podręcznej).
      expect(formatMoney(pln(1_299))).toBe(`12,99${NBSP}zł`);
    },
  );
});

describe('formatMoney: trailingZeroDisplay', () => {
  it.each([
    [10_000, `100${NBSP}zł`],
    [10_999, `109,99${NBSP}zł`],
    [1_299, `12,99${NBSP}zł`],
    [100, `1${NBSP}zł`],
    [50, `0,50${NBSP}zł`],
    [5, `0,05${NBSP}zł`],
    [0, `0${NBSP}zł`],
    [-100, `-1${NBSP}zł`],
    [-50, `-0,50${NBSP}zł`],
    [100_000, `1000${NBSP}zł`],
    [1_234_500, `12${NBSP}345${NBSP}zł`],
  ])('stripIfInteger, pl-PL: %i gr → "%s"', (amount, expected) => {
    expect(formatMoney(pln(amount), { trailingZeroDisplay: 'stripIfInteger' })).toBe(expected);
  });

  it('tekst przy przycisku licytacji z PROJECT.md §3.1', () => {
    const options = { trailingZeroDisplay: 'stripIfInteger' } as const;
    const text = `Licytujesz ${formatMoney(pln(10_000), options)} · zapłacisz ${formatMoney(pln(10_999), options)} + dostawa od ${formatMoney(pln(1_299), options)}`;
    expect(text).toBe(
      `Licytujesz 100${NBSP}zł · zapłacisz 109,99${NBSP}zł + dostawa od 12,99${NBSP}zł`,
    );
  });

  it('domyślnie (auto) grosze są zawsze widoczne, a ustawienia nie mieszają się w pamięci podręcznej', () => {
    const amount = pln(10_000);
    for (let i = 0; i < 2; i++) {
      expect(formatMoney(amount)).toBe(`100,00${NBSP}zł`);
      expect(formatMoney(amount, { trailingZeroDisplay: 'auto' })).toBe(`100,00${NBSP}zł`);
      expect(formatMoney(amount, { trailingZeroDisplay: 'stripIfInteger' })).toBe(`100${NBSP}zł`);
      expect(formatMoney(amount, { locale: 'en-US', trailingZeroDisplay: 'stripIfInteger' })).toBe(
        `PLN${NBSP}100`,
      );
    }
  });

  it('nieprawidłowa wartość opcji (z kodu bez typów) rzuca MoneyError', () => {
    const options = { trailingZeroDisplay: 'never' } as unknown as Parameters<
      typeof formatMoney
    >[1];
    expect(() => formatMoney(pln(100), options)).toThrow(MoneyError);
  });
});

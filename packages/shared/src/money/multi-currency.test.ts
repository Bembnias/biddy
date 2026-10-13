import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  add,
  compare,
  CURRENCIES,
  CurrencyMismatchError,
  equals,
  formatMoney,
  isCurrencyCode,
  isMoney,
  max,
  min,
  money,
  MoneyParseError,
  parseMoney,
  percentOf,
  splitGross,
  subtract,
  sum,
  toDecimalString,
  type CurrencyCode,
  type CurrencyInfo,
} from './index.js';

// Na razie obsługujemy tylko PLN. Ten plik sprawdza, że kolejna waluta to tylko wpis w CURRENCIES:
// na czas testów dopisujemy EUR i walutę bez części ułamkowej (JPY), a potem je usuwamy.
// Vitest izoluje pliki testowe, więc zmiana nie wycieka do innych testów.
const registry = CURRENCIES as Record<string, CurrencyInfo>;
const EUR = 'EUR' as CurrencyCode;
const JPY = 'JPY' as CurrencyCode;
const NBSP = '\u00A0';

beforeAll(() => {
  registry['EUR'] = { code: 'EUR', minorUnits: 2, symbol: '€' };
  registry['JPY'] = { code: 'JPY', minorUnits: 0, symbol: '¥' };
});

afterAll(() => {
  delete registry['EUR'];
  delete registry['JPY'];
});

describe('kolejna waluta w rejestrze', () => {
  it('jest rozpoznawana przez money() i isMoney()', () => {
    expect(isCurrencyCode('EUR')).toBe(true);
    expect(money(1_299, EUR)).toEqual({ amount: 1_299, currency: 'EUR' });
    expect(isMoney({ amount: 1, currency: 'EUR' })).toBe(true);
  });

  it.each([
    ['add', () => add(money(1), money(1, EUR))],
    ['subtract', () => subtract(money(1), money(1, EUR))],
    ['compare', () => compare(money(1), money(1, EUR))],
    ['equals', () => equals(money(1), money(1, EUR))],
    ['min', () => min(money(1), money(2), money(1, EUR))],
    ['max', () => max(money(1), money(1, EUR))],
    ['sum', () => sum([money(1), money(1, EUR)])],
    ['sum z jawną walutą', () => sum([money(1, EUR)], 'PLN')],
  ])('%s: mieszanie walut rzuca CurrencyMismatchError', (_label, operation) => {
    expect(operation).toThrow(CurrencyMismatchError);
  });

  it('CurrencyMismatchError wskazuje obie waluty', () => {
    try {
      add(money(1), money(1, EUR));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CurrencyMismatchError);
      expect(error).toMatchObject({ expected: 'PLN', actual: 'EUR' });
    }
  });

  it('operacje w jednej walucie zachowują ją', () => {
    expect(add(money(100, EUR), money(250, EUR))).toEqual(money(350, EUR));
    expect(sum([], EUR)).toEqual(money(0, EUR));
    expect(percentOf(money(2_000, EUR), 700)).toEqual(money(140, EUR));
    expect(splitGross(money(999, EUR), 2_300)).toEqual({
      net: money(812, EUR),
      vat: money(187, EUR),
    });
  });

  it('EUR: formatowanie i parsowanie biorą symbol i liczbę miejsc z rejestru', () => {
    expect(toDecimalString(money(1_234_567, EUR))).toBe('12345.67');
    expect(formatMoney(money(1_234_567, EUR))).toBe(`12${NBSP}345,67${NBSP}€`);
    expect(parseMoney('12 345,67 €', EUR)).toEqual(money(1_234_567, EUR));
    expect(parseMoney('12,99 eur', EUR)).toEqual(money(1_299, EUR));
    expect(() => parseMoney('12,99 zł', EUR)).toThrow(MoneyParseError);
  });

  it('JPY (0 miejsc po przecinku): kwota to pełne jednostki', () => {
    expect(toDecimalString(money(1_234, JPY))).toBe('1234');
    expect(toDecimalString(money(-5, JPY))).toBe('-5');
    expect(formatMoney(money(12_345, JPY))).toBe(`12${NBSP}345${NBSP}JPY`);
    expect(parseMoney('12 345', JPY)).toEqual(money(12_345, JPY));
    expect(() => parseMoney('12,5', JPY)).toThrow(
      expect.objectContaining({ reason: 'TOO_MANY_DECIMALS' }),
    );
  });
});

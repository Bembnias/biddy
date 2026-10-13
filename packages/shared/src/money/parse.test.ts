import { describe, expect, it, vi } from 'vitest';
import {
  formatMoney,
  money,
  MoneyError,
  MoneyParseError,
  parseMoney,
  toDecimalString,
  type CurrencyCode,
  type Money,
  type MoneyParseErrorReason,
} from './index.js';

const MAX = Number.MAX_SAFE_INTEGER;
const MIN = Number.MIN_SAFE_INTEGER;
const pln = (amount: number): Money => money(amount);

const NBSP = '\u00A0';
const NARROW_NBSP = '\u202F';

describe('parseMoney: poprawne kwoty', () => {
  it.each([
    ['12', 1_200],
    ['12,9', 1_290],
    ['12,99', 1_299],
    ['12.99', 1_299],
    ['12.9', 1_290],
    ['0,05', 5],
    ['0,5', 50],
    ['0', 0],
    ['007', 700],
    ['1000', 100_000],
    ['-12,99', -1_299],
    ['-0,05', -5],
    ['\u221212,99', -1_299],
    ['1 234,50', 123_450],
    [`1${NBSP}234,50`, 123_450],
    [`1${NARROW_NBSP}234,50`, 123_450],
    ['1 234.50', 123_450],
    ['1 000', 100_000],
    ['1 234 567,89', 123_456_789],
    [`-1${NBSP}234${NBSP}567,89`, -123_456_789],
    ['1234567,89', 123_456_789],
    ['12 zł', 1_200],
    ['12zł', 1_200],
    [`12,99${NBSP}zł`, 1_299],
    ['12,99 ZŁ', 1_299],
    ['12,99 Zł', 1_299],
    ['12,99 PLN', 1_299],
    ['12,99pln', 1_299],
    ['-5 zł', -500],
    ['  12,99  ', 1_299],
    ['\t12,99 zł\n', 1_299],
    ['90071992547409,91', MAX],
    ['-90071992547409,91', MIN],
    [`90${NBSP}071${NBSP}992${NBSP}547${NBSP}409,91${NBSP}zł`, MAX],
  ])('"%s" → %i gr', (input, expected) => {
    expect(parseMoney(input)).toEqual(pln(expected));
    expect(parseMoney(input, 'PLN')).toEqual(pln(expected));
  });

  it.each(['-0', '-0,00', '0,00 zł', '-0 zł'])('"%s" daje 0, a nie -0', (input) => {
    expect(Object.is(parseMoney(input).amount, 0)).toBe(true);
  });
});

describe('parseMoney: odrzucane dane', () => {
  it.each<[string, MoneyParseErrorReason]>([
    ['', 'EMPTY'],
    ['   ', 'EMPTY'],
    [NBSP, 'EMPTY'],
    ['zł', 'EMPTY'],
    [' PLN ', 'EMPTY'],
    ['12,999', 'TOO_MANY_DECIMALS'],
    ['0.001', 'TOO_MANY_DECIMALS'],
    ['1 234,567 zł', 'TOO_MANY_DECIMALS'],
    ['abc', 'INVALID_FORMAT'],
    ['12a', 'INVALID_FORMAT'],
    ['a12', 'INVALID_FORMAT'],
    ['12,99 €', 'INVALID_FORMAT'],
    ['12,99 EUR', 'INVALID_FORMAT'],
    ['zł 12', 'INVALID_FORMAT'],
    ['12 zł zł', 'INVALID_FORMAT'],
    ['1.234,50', 'INVALID_FORMAT'],
    ['1,234.50', 'INVALID_FORMAT'],
    ['1.234.567', 'INVALID_FORMAT'],
    ['12,,5', 'INVALID_FORMAT'],
    ['12,5,0', 'INVALID_FORMAT'],
    ['12.', 'INVALID_FORMAT'],
    ['12,', 'INVALID_FORMAT'],
    [',5', 'INVALID_FORMAT'],
    ['.5', 'INVALID_FORMAT'],
    ['-', 'INVALID_FORMAT'],
    ['--5', 'INVALID_FORMAT'],
    ['+5', 'INVALID_FORMAT'],
    ['- 5', 'INVALID_FORMAT'],
    ['5-', 'INVALID_FORMAT'],
    ['(5)', 'INVALID_FORMAT'],
    ['1 23', 'INVALID_FORMAT'],
    ['1234 567', 'INVALID_FORMAT'],
    ['12 34,5', 'INVALID_FORMAT'],
    ['1  234', 'INVALID_FORMAT'],
    ['12 ,5', 'INVALID_FORMAT'],
    ['1_000', 'INVALID_FORMAT'],
    ['1e3', 'INVALID_FORMAT'],
    ['0x10', 'INVALID_FORMAT'],
    ['Infinity', 'INVALID_FORMAT'],
    ['NaN', 'INVALID_FORMAT'],
    ['\u0661\u0662', 'INVALID_FORMAT'],
    ['12\n34', 'INVALID_FORMAT'],
    ['90071992547409,92', 'OUT_OF_RANGE'],
    ['-90071992547409,92', 'OUT_OF_RANGE'],
    ['99999999999999999999', 'OUT_OF_RANGE'],
    ['1'.repeat(400), 'OUT_OF_RANGE'],
  ])('"%s" → %s', (input, reason) => {
    let caught: unknown;
    try {
      parseMoney(input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MoneyParseError);
    expect(caught).toBeInstanceOf(MoneyError);
    expect(caught).toMatchObject({ reason, input });
  });

  it('komunikaty błędów są po polsku', () => {
    expect(() => parseMoney('')).toThrow('Nie podano kwoty');
    expect(() => parseMoney('12,999')).toThrow('Za dużo cyfr po przecinku (maksymalnie 2)');
    expect(() => parseMoney('abc')).toThrow('Nieprawidłowy format kwoty: „abc”');
    expect(() => parseMoney('99999999999999999999')).toThrow(
      'Kwota jest poza obsługiwanym zakresem',
    );
  });

  it('odrzuca wartość, która nie jest tekstem', () => {
    const untyped = parseMoney as (input: unknown) => Money;
    expect(() => untyped(12.99)).toThrow(MoneyParseError);
    expect(() => untyped(null)).toThrow(MoneyParseError);
  });

  it('odrzuca nieobsługiwaną walutę', () => {
    expect(() => parseMoney('12', 'EUR' as CurrencyCode)).toThrow(MoneyError);
  });
});

describe('parseMoney: bardzo długie dane wejściowe', () => {
  it.each([
    ['milion dziewiątek', '9'.repeat(1_000_000)],
    ['pogrupowane cyfry', `1${' 111'.repeat(250_000)}`],
    ['z częścią ułamkową', `${'1'.repeat(1_000_000)},99 zł`],
    ['ujemna', `-${'9'.repeat(1_000_000)}`],
    ['17 cyfr znaczących po zerach wiodących', `${'0'.repeat(50)}${'1'.repeat(15)},00`],
  ])('%s: OUT_OF_RANGE bez konwersji na bigint', (_label, input) => {
    const bigIntSpy = vi.spyOn(globalThis, 'BigInt');
    try {
      expect(() => parseMoney(input)).toThrow(expect.objectContaining({ reason: 'OUT_OF_RANGE' }));
      expect(bigIntSpy).not.toHaveBeenCalled();
    } finally {
      bigIntSpy.mockRestore();
    }
  });

  it('16 cyfr znaczących trafia do sprawdzenia zakresu (granica liczona na bigint)', () => {
    expect(parseMoney('90071992547409,91')).toEqual(pln(MAX));
    expect(() => parseMoney('90071992547409,92')).toThrow(
      expect.objectContaining({ reason: 'OUT_OF_RANGE' }),
    );
    expect(() => parseMoney('99999999999999,99')).toThrow(
      expect.objectContaining({ reason: 'OUT_OF_RANGE' }),
    );
  });

  it.each([
    [`${'0'.repeat(10_000)}12,50`, 1_250],
    [`-${'0'.repeat(10_000)}1`, -100],
    [`${'0'.repeat(30)}90071992547409,91`, MAX],
    ['0'.repeat(10_000), 0],
    [`${'0'.repeat(100)},00`, 0],
  ])('zera wiodące nie liczą się do limitu cyfr: "%s" → %i gr', (input, expected) => {
    expect(parseMoney(input)).toEqual(pln(expected));
  });
});

describe('parseMoney: właściwości (round-trip)', () => {
  it('parseMoney(toDecimalString(m)) = m, także z przecinkiem i z „zł”', () => {
    const failures: number[] = [];
    for (let amount = -100_000; amount <= 100_000; amount++) {
      const m = pln(amount);
      const decimal = toDecimalString(m);
      const ok =
        parseMoney(decimal).amount === amount &&
        parseMoney(decimal.replace('.', ',')).amount === amount &&
        parseMoney(`${decimal} zł`).amount === amount;
      if (!ok) {
        failures.push(amount);
      }
    }
    expect(failures).toEqual([]);
  });

  it('parseMoney(formatMoney(m)) = m dla pl-PL', () => {
    const amounts = [MAX, MIN, MAX - 1, MIN + 1, 0, 1, -1];
    for (let amount = -2_000_000; amount <= 2_000_000; amount += 997) {
      amounts.push(amount);
    }
    for (let power = 1; power <= Number.MAX_SAFE_INTEGER; power *= 10) {
      amounts.push(power, power - 1, -power, -(power - 1));
    }
    const failures = amounts.filter((amount) => {
      const formatted = formatMoney(pln(amount));
      return parseMoney(formatted).amount !== amount;
    });
    expect(failures).toEqual([]);
  });
});

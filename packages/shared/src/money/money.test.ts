import { describe, expect, it } from 'vitest';
import {
  CURRENCIES,
  CurrencyMismatchError,
  DEFAULT_CURRENCY,
  getCurrency,
  isCurrencyCode,
  isMoney,
  money,
  MoneyError,
  MoneyParseError,
  zero,
  type CurrencyCode,
} from './index.js';

const MAX = Number.MAX_SAFE_INTEGER;
const MIN = Number.MIN_SAFE_INTEGER;

describe('waluty', () => {
  it('PLN to waluta domyślna z groszami (2 miejsca po przecinku)', () => {
    expect(DEFAULT_CURRENCY).toBe('PLN');
    expect(CURRENCIES.PLN).toEqual({ code: 'PLN', minorUnits: 2, symbol: 'zł' });
    expect(getCurrency('PLN')).toBe(CURRENCIES.PLN);
  });

  it.each([
    ['PLN', true],
    ['pln', false],
    ['EUR', false],
    ['', false],
    ['toString', false],
    ['__proto__', false],
    ['constructor', false],
    [1, false],
    [null, false],
    [undefined, false],
  ])('isCurrencyCode(%j) → %s', (value, expected) => {
    expect(isCurrencyCode(value)).toBe(expected);
  });
});

describe('money()', () => {
  it.each([
    [1299, 1299],
    [0, 0],
    [-5, -5],
    [MAX, MAX],
    [MIN, MIN],
    [1299n, 1299],
    [0n, 0],
    [-5n, -5],
    [BigInt(MAX), MAX],
    [BigInt(MIN), MIN],
  ])('money(%s) → %s gr', (input, expected) => {
    expect(money(input)).toEqual({ amount: expected, currency: 'PLN' });
  });

  it('domyślnie używa PLN i przyjmuje walutę jawnie', () => {
    expect(money(100).currency).toBe('PLN');
    expect(money(100, 'PLN').currency).toBe('PLN');
  });

  it('normalizuje -0 do 0', () => {
    expect(Object.is(money(-0).amount, 0)).toBe(true);
  });

  it('daje zwykły obiekt, który przechodzi przez JSON bez zmian', () => {
    const m = money(1299);
    const json = JSON.stringify(m);
    expect(json).toBe('{"amount":1299,"currency":"PLN"}');
    expect(JSON.parse(json)).toEqual(m);
    expect(Object.getPrototypeOf(m)).toBe(Object.prototype);
  });

  it.each([
    ['ułamek grosza', 12.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['2^53', 2 ** 53],
    ['-(2^53)', -(2 ** 53)],
    ['bigint powyżej zakresu', BigInt(MAX) + 1n],
    ['bigint poniżej zakresu', BigInt(MIN) - 1n],
    ['tekst', '12' as unknown as number],
    ['null', null as unknown as number],
  ])('odrzuca kwotę: %s', (_label, input) => {
    expect(() => money(input)).toThrow(MoneyError);
  });

  it('komunikaty błędów rozróżniają ułamek od przekroczenia zakresu', () => {
    expect(() => money(12.5)).toThrow(/całkowitą liczbą jednostek podrzędnych/);
    expect(() => money(2 ** 53)).toThrow(/poza bezpieczny zakres/);
  });

  it('odrzuca nieobsługiwaną walutę', () => {
    expect(() => money(100, 'EUR' as CurrencyCode)).toThrow(MoneyError);
    expect(() => money(100, 'EUR' as CurrencyCode)).toThrow('Nieobsługiwana waluta: EUR');
  });
});

describe('zero()', () => {
  it('zwraca 0 w PLN', () => {
    expect(zero()).toEqual({ amount: 0, currency: 'PLN' });
    expect(zero('PLN')).toEqual({ amount: 0, currency: 'PLN' });
  });
});

describe('isMoney()', () => {
  it.each([
    [{ amount: 1299, currency: 'PLN' }, true],
    [{ amount: -1, currency: 'PLN' }, true],
    [{ amount: MAX, currency: 'PLN' }, true],
    [{ amount: 0, currency: 'PLN', extra: true }, true],
    [JSON.parse('{"amount":-0,"currency":"PLN"}'), true],
    [{ amount: 12.5, currency: 'PLN' }, false],
    [{ amount: '1299', currency: 'PLN' }, false],
    [{ amount: 1299n, currency: 'PLN' }, false],
    [{ amount: 2 ** 53, currency: 'PLN' }, false],
    [{ amount: 1299, currency: 'EUR' }, false],
    [{ amount: 1299 }, false],
    [{ currency: 'PLN' }, false],
    [1299, false],
    ['12,99 zł', false],
    [null, false],
    [undefined, false],
  ])('isMoney(%o) → %s', (value, expected) => {
    expect(isMoney(value)).toBe(expected);
  });
});

describe('klasy błędów', () => {
  it('CurrencyMismatchError dziedziczy po MoneyError i niesie obie waluty', () => {
    const error = new CurrencyMismatchError('PLN', 'EUR' as CurrencyCode);
    expect(error).toBeInstanceOf(CurrencyMismatchError);
    expect(error).toBeInstanceOf(MoneyError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('CurrencyMismatchError');
    expect(error.expected).toBe('PLN');
    expect(error.actual).toBe('EUR');
    expect(error.message).toBe('Niezgodne waluty: oczekiwano PLN, otrzymano EUR');
  });

  it('MoneyParseError dziedziczy po MoneyError i niesie powód oraz tekst wejściowy', () => {
    const error = new MoneyParseError('EMPTY', '  ', 'Nie podano kwoty');
    expect(error).toBeInstanceOf(MoneyError);
    expect(error.name).toBe('MoneyParseError');
    expect(error.reason).toBe('EMPTY');
    expect(error.input).toBe('  ');
  });

  it('MoneyError ma własną nazwę', () => {
    expect(new MoneyError('x').name).toBe('MoneyError');
  });
});

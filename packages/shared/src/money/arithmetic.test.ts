import { describe, expect, it } from 'vitest';
import {
  abs,
  add,
  compare,
  CurrencyMismatchError,
  equals,
  isNegative,
  isPositive,
  isZero,
  max,
  min,
  money,
  MoneyError,
  multiply,
  negate,
  subtract,
  sum,
  zero,
  type Money,
} from './index.js';

const MAX = Number.MAX_SAFE_INTEGER;
const MIN = Number.MIN_SAFE_INTEGER;
const pln = (amount: number): Money => money(amount);

/** Kwota z danych zewnętrznych, która omija konstruktor `money()`. */
const raw = (value: unknown): Money => value as Money;

describe('add / subtract', () => {
  it.each([
    [100, 250, 350],
    [-100, 50, -50],
    [0, 0, 0],
    [1299, -1299, 0],
    [MAX - 1, 1, MAX],
    [MIN + 1, -1, MIN],
    [MAX, MIN, 0],
  ])('add(%i, %i) = %i', (a, b, expected) => {
    expect(add(pln(a), pln(b))).toEqual(pln(expected));
  });

  it.each([
    [350, 250, 100],
    [50, 100, -50],
    [0, 0, 0],
    [-5, -5, 0],
    [MIN + 1, 1, MIN],
    [MAX - 1, -1, MAX],
  ])('subtract(%i, %i) = %i', (a, b, expected) => {
    expect(subtract(pln(a), pln(b))).toEqual(pln(expected));
  });

  it('wynik zero nie jest -0', () => {
    expect(Object.is(add(pln(-5), pln(5)).amount, 0)).toBe(true);
    expect(Object.is(subtract(pln(-5), pln(-5)).amount, 0)).toBe(true);
  });

  it.each([
    ['add(MAX, 1)', () => add(pln(MAX), pln(1))],
    ['add(MIN, -1)', () => add(pln(MIN), pln(-1))],
    ['add(MAX, MAX)', () => add(pln(MAX), pln(MAX))],
    ['subtract(MIN, 1)', () => subtract(pln(MIN), pln(1))],
    ['subtract(MAX, -1)', () => subtract(pln(MAX), pln(-1))],
    ['subtract(MAX, MIN)', () => subtract(pln(MAX), pln(MIN))],
  ])('%s: przekroczenie zakresu rzuca MoneyError', (_label, operation) => {
    expect(operation).toThrow(MoneyError);
  });

  it('nie modyfikuje argumentów', () => {
    const a = pln(100);
    const b = pln(200);
    add(a, b);
    subtract(a, b);
    expect(a).toEqual(pln(100));
    expect(b).toEqual(pln(200));
  });
});

describe('multiply', () => {
  it.each([
    [1299, 3, 3897],
    [1299, 1, 1299],
    [1299, 0, 0],
    [1299, -2, -2598],
    [-5, -1, 5],
    [MAX, 1, MAX],
    [MAX, -1, MIN],
    [MIN, -1, MAX],
    [2 ** 52 - 1, 2, 2 ** 53 - 2],
  ])('multiply(%i, %i) = %i', (amount, factor, expected) => {
    expect(multiply(pln(amount), factor)).toEqual(pln(expected));
  });

  it('wynik zero nie jest -0', () => {
    expect(Object.is(multiply(pln(-5), 0).amount, 0)).toBe(true);
  });

  it.each([
    ['ułamkowy mnożnik', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['mnożnik poza zakresem', 2 ** 53],
  ])('odrzuca %s', (_label, factor) => {
    expect(() => multiply(pln(100), factor)).toThrow(MoneyError);
  });

  it.each([
    [MAX, 2],
    [2 ** 52, 2],
    [MIN, 2],
    [-(2 ** 52), 2],
    [3, MAX],
  ])('multiply(%i, %i): przekroczenie zakresu rzuca MoneyError', (amount, factor) => {
    expect(() => multiply(pln(amount), factor)).toThrow(/poza bezpieczny zakres/);
  });
});

describe('negate / abs', () => {
  it.each([
    [5, -5, 5],
    [-5, 5, 5],
    [0, 0, 0],
    [MAX, -MAX, MAX],
    [MIN, MAX, MAX],
  ])('negate(%i) = %i, abs(%i) = %i', (amount, negated, absolute) => {
    expect(negate(pln(amount))).toEqual(pln(negated));
    expect(abs(pln(amount))).toEqual(pln(absolute));
  });

  it('negate(0) nie daje -0', () => {
    expect(Object.is(negate(zero()).amount, 0)).toBe(true);
  });
});

describe('sum', () => {
  it.each([
    [[1], 1],
    [[100, 250, -50], 300],
    [[MAX, -MAX], 0],
    [[MAX, 1, -1], MAX],
    [[MIN, -1, 1], MIN],
  ])('sum(%j) = %i', (amounts, expected) => {
    expect(sum(amounts.map(pln), 'PLN')).toEqual(pln(expected));
  });

  it('niepusta krotka nie wymaga waluty', () => {
    expect(sum([pln(1), pln(2)])).toEqual(pln(3));
  });

  it('pusta lista z jawną walutą daje zero', () => {
    expect(sum([], 'PLN')).toEqual(zero('PLN'));
  });

  it('pusta lista bez waluty rzuca MoneyError', () => {
    const untypedSum = sum as (items: readonly Money[]) => Money;
    expect(() => untypedSum([])).toThrow(MoneyError);
    expect(() => untypedSum([])).toThrow('Suma pustej listy kwot wymaga jawnie podanej waluty');
  });

  it('przekroczenie zakresu przez wynik końcowy rzuca MoneyError', () => {
    expect(() => sum([pln(MAX), pln(1)])).toThrow(MoneyError);
    expect(() => sum([pln(MIN), pln(MIN)])).toThrow(MoneyError);
  });

  it('odrzuca nieprawidłowy element listy', () => {
    expect(() => sum([pln(1), raw({ amount: 0.5, currency: 'PLN' })])).toThrow(MoneyError);
    // Bez jawnej waluty pierwszy element wyznacza walutę, więc też musi przejść walidację.
    expect(() => sum([raw(null)])).toThrow('Nieprawidłowa kwota: null');
    expect(() => sum([raw({ amount: 1, currency: 'XYZ' })])).toThrow(/Nieprawidłowa kwota/);
  });
});

describe('compare / equals', () => {
  it.each([
    [1, 2, -1],
    [2, 1, 1],
    [5, 5, 0],
    [-5, 5, -1],
    [MIN, MAX, -1],
    [MAX, MAX, 0],
  ] as const)('compare(%i, %i) = %i', (a, b, expected) => {
    expect(compare(pln(a), pln(b))).toBe(expected);
    expect(equals(pln(a), pln(b))).toBe(expected === 0);
  });

  it('nadaje się do sortowania', () => {
    const sorted = [300, -1, 0, 1299, 5].map(pln).sort(compare);
    expect(sorted.map((m) => m.amount)).toEqual([-1, 0, 5, 300, 1299]);
  });

  it('traktuje -0 z JSON-a jak 0', () => {
    const negativeZero = raw(JSON.parse('{"amount":-0,"currency":"PLN"}'));
    expect(equals(negativeZero, zero())).toBe(true);
  });
});

describe('isZero / isPositive / isNegative', () => {
  it.each([
    [0, true, false, false],
    [1, false, true, false],
    [-1, false, false, true],
    [MAX, false, true, false],
    [MIN, false, false, true],
  ])('kwota %i: zero=%s, dodatnia=%s, ujemna=%s', (amount, zeroFlag, positive, negative) => {
    const m = pln(amount);
    expect(isZero(m)).toBe(zeroFlag);
    expect(isPositive(m)).toBe(positive);
    expect(isNegative(m)).toBe(negative);
  });

  it('-0 z JSON-a jest zerem, a nie liczbą ujemną', () => {
    const negativeZero = raw({ amount: -0, currency: 'PLN' });
    expect(isZero(negativeZero)).toBe(true);
    expect(isNegative(negativeZero)).toBe(false);
  });
});

describe('min / max', () => {
  it.each([
    [[7], 7, 7],
    [[3, 1, 2], 1, 3],
    [[-5, 0, 5], -5, 5],
    [[MAX, MIN], MIN, MAX],
  ])('min/max(%j) = %i / %i', (amounts, expectedMin, expectedMax) => {
    const [first, ...rest] = amounts.map(pln);
    if (first === undefined) {
      throw new Error('Pusta lista w danych testowych');
    }
    expect(min(first, ...rest)).toEqual(pln(expectedMin));
    expect(max(first, ...rest)).toEqual(pln(expectedMax));
  });

  it('przy remisie zwraca pierwszą z równych kwot', () => {
    const a = pln(5);
    const b = pln(5);
    expect(min(a, b)).toBe(a);
    expect(max(a, b)).toBe(a);
  });

  it('odrzuca nieprawidłową kwotę także jako jedyny argument', () => {
    expect(() => min(raw({ amount: 1.5, currency: 'PLN' }))).toThrow(MoneyError);
    expect(() => max(raw({ amount: 1, currency: 'XYZ' }))).toThrow(MoneyError);
  });
});

describe('walidacja argumentów', () => {
  const invalid: [string, Money][] = [
    ['ułamkowe grosze', raw({ amount: 1.5, currency: 'PLN' })],
    ['kwota jako tekst', raw({ amount: '1', currency: 'PLN' })],
    ['kwota poza zakresem', raw({ amount: 2 ** 53, currency: 'PLN' })],
    ['nieznana waluta', raw({ amount: 1, currency: 'XYZ' })],
    ['null', raw(null)],
  ];

  it.each(invalid)(
    '%s: każda operacja rzuca MoneyError, a nie CurrencyMismatchError',
    (_l, bad) => {
      const ok = pln(1);
      const operations = [
        () => add(bad, ok),
        () => add(ok, bad),
        () => subtract(ok, bad),
        () => multiply(bad, 2),
        () => negate(bad),
        () => abs(bad),
        () => sum([ok, bad]),
        () => compare(ok, bad),
        () => equals(bad, ok),
        () => isZero(bad),
        () => isPositive(bad),
        () => isNegative(bad),
        () => min(ok, bad),
        () => max(bad, ok),
      ];
      for (const operation of operations) {
        expect(operation).toThrow(MoneyError);
        expect(operation).not.toThrow(CurrencyMismatchError);
      }
    },
  );
});

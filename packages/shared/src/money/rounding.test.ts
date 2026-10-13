import { describe, expect, it } from 'vitest';
import {
  add,
  BASIS_POINTS_SCALE,
  divideRoundHalfUp,
  money,
  MoneyError,
  negate,
  percentOf,
  splitGross,
  type Money,
} from './index.js';

const MAX = Number.MAX_SAFE_INTEGER;
const MIN = Number.MIN_SAFE_INTEGER;
const pln = (amount: number): Money => money(amount);
const VAT_23 = 2300;

const bigAbs = (value: bigint): bigint => (value < 0n ? -value : value);

/**
 * Wzorzec liczony inaczej niż implementacja: dla liczb nieujemnych zaokrąglenie half-up to
 * floor(n/d + 1/2) = floor((2n + d) / 2d), a znak wyniku dokładamy osobno (połówka od zera).
 */
function referenceRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n ? denominator > 0n : denominator < 0n;
  const n = bigAbs(numerator);
  const d = bigAbs(denominator);
  const rounded = (2n * n + d) / (2n * d);
  return negative ? -rounded : rounded;
}

describe('divideRoundHalfUp', () => {
  it.each([
    [0n, 7n, 0n],
    [10n, 5n, 2n],
    [-10n, 5n, -2n],
    [4n, 10n, 0n],
    [5n, 10n, 1n],
    [6n, 10n, 1n],
    [14n, 10n, 1n],
    [15n, 10n, 2n],
    [25n, 10n, 3n],
    [-4n, 10n, 0n],
    [-5n, 10n, -1n],
    [-15n, 10n, -2n],
    [-25n, 10n, -3n],
    [5n, -10n, -1n],
    [-5n, -10n, 1n],
    [1n, 3n, 0n],
    [2n, 3n, 1n],
    [-2n, 3n, -1n],
    [1n, 2n, 1n],
    [-1n, 2n, -1n],
    [35n * 10n ** 24n, 10n ** 25n, 4n],
    [-35n * 10n ** 24n, 10n ** 25n, -4n],
  ])('divideRoundHalfUp(%s, %s) = %s', (numerator, denominator, expected) => {
    expect(divideRoundHalfUp(numerator, denominator)).toBe(expected);
  });

  it('połówka idzie od zera, a nie do parzystej (to nie jest zaokrąglenie bankierskie)', () => {
    expect(divideRoundHalfUp(25n, 10n)).toBe(3n);
    expect(divideRoundHalfUp(-25n, 10n)).toBe(-3n);
    expect(divideRoundHalfUp(45n, 10n)).toBe(5n);
  });

  it('dzielenie przez zero rzuca MoneyError', () => {
    expect(() => divideRoundHalfUp(1n, 0n)).toThrow(MoneyError);
    expect(() => divideRoundHalfUp(0n, 0n)).toThrow('Dzielenie przez zero');
  });

  it('odrzuca argumenty typu number', () => {
    const untyped = divideRoundHalfUp as (n: unknown, d: unknown) => bigint;
    expect(() => untyped(5, 10n)).toThrow(MoneyError);
    expect(() => untyped(5n, 10)).toThrow(MoneyError);
  });

  it('właściwość: wynik to najbliższa liczba całkowita, remis od zera, zgodnie ze wzorcem', () => {
    const failures: string[] = [];
    for (let d = -25n; d <= 25n; d++) {
      if (d === 0n) {
        continue;
      }
      for (let n = -1000n; n <= 1000n; n++) {
        const q = divideRoundHalfUp(n, d);
        // |n/d − q| ≤ 1/2, czyli 2·|n − q·d| ≤ |d|
        const twiceError = 2n * bigAbs(n - q * d);
        const nearest = twiceError <= bigAbs(d);
        // przy remisie (dokładnie połowa) |q| > |n/d|, czyli |q·d| > |n|
        const tieAwayFromZero = twiceError !== bigAbs(d) || bigAbs(q * d) > bigAbs(n);
        if (!nearest || !tieAwayFromZero || q !== referenceRoundHalfUp(n, d)) {
          failures.push(`${n}/${d} → ${q}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('percentOf', () => {
  it.each([
    // §3.1 i §3.2: 7% do 1000 zł, 4% od nadwyżki
    ['7% z 100,00 zł = 7,00 zł', 10_000, 700, 700],
    ['7% z 20,00 zł = 1,40 zł', 2_000, 700, 140],
    ['7% z 1000,00 zł = 70,00 zł', 100_000, 700, 7_000],
    ['4% z 2000,00 zł = 80,00 zł', 200_000, 400, 8_000],
    ['4% z 9000,00 zł = 360,00 zł', 900_000, 400, 36_000],
    ['7% z 1,00 zł = 0,07 zł', 100, 700, 7],
    ['7% z 0,07 zł = 0,0049 → 0,00 zł', 7, 700, 0],
    ['7% z 0,08 zł = 0,0056 → 0,01 zł', 8, 700, 1],
    ['1% z 0,50 zł = 0,005 → 0,01 zł (remis w górę)', 50, 100, 1],
    ['1% z 0,49 zł = 0,0049 → 0,00 zł', 49, 100, 0],
    ['1% z 2,50 zł = 0,025 → 0,03 zł (nie bankierskie 0,02)', 250, 100, 3],
    ['1% z −0,50 zł = −0,005 → −0,01 zł (remis od zera)', -50, 100, -1],
    ['1% z −2,50 zł → −0,03 zł', -250, 100, -3],
    ['23% z 9,99 zł = 2,2977 → 2,30 zł', 999, 2_300, 230],
    ['0% z 123,45 zł = 0', 12_345, 0, 0],
    ['100% to ta sama kwota', 12_345, 10_000, 12_345],
    ['150% z 1,01 zł = 1,515 → 1,52 zł', 101, 15_000, 152],
    ['ujemna stawka: −7% z 20,00 zł', 2_000, -700, -140],
    ['100% z MAX', MAX, 10_000, MAX],
    ['100% z MIN', MIN, 10_000, MIN],
  ])('%s', (_label, amount, basisPoints, expected) => {
    expect(percentOf(pln(amount), basisPoints)).toEqual(pln(expected));
  });

  it('BASIS_POINTS_SCALE to 100% w punktach bazowych', () => {
    expect(BASIS_POINTS_SCALE).toBe(10_000);
  });

  it('dla dużych kwot liczy dokładnie (bigint), bez utraty precyzji', () => {
    const expected = referenceRoundHalfUp(BigInt(MAX) * 700n, 10_000n);
    expect(BigInt(percentOf(pln(MAX), 700).amount)).toBe(expected);
    expect(BigInt(percentOf(pln(MIN), 700).amount)).toBe(-expected);
  });

  it.each([
    ['ułamkowe punkty bazowe', 7.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('odrzuca stawkę: %s', (_label, basisPoints) => {
    expect(() => percentOf(pln(100), basisPoints)).toThrow(MoneyError);
  });

  it('wynik poza zakresem rzuca MoneyError', () => {
    expect(() => percentOf(pln(MAX), 10_001)).toThrow(MoneyError);
    expect(() => percentOf(pln(MIN), 20_000)).toThrow(MoneyError);
  });

  it('właściwość: zgodność ze wzorcem dla każdej kwoty z zakresu i zestawu stawek', () => {
    const rates = [0, 1, 7, 50, 99, 100, 250, 400, 700, 2_300, 3_333, 5_000, 9_999, 10_000, 12_345];
    const failures: string[] = [];
    for (const bp of rates) {
      for (let amount = -20_000; amount <= 20_000; amount++) {
        const actual = percentOf(pln(amount), bp).amount;
        const expected = referenceRoundHalfUp(BigInt(amount) * BigInt(bp), 10_000n);
        if (BigInt(actual) !== expected) {
          failures.push(`${bp} bp z ${amount} gr → ${actual}, oczekiwano ${expected}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('właściwość: symetria względem znaku i monotoniczność', () => {
    const failures: string[] = [];
    for (const bp of [1, 400, 700, 2_300]) {
      let previous = percentOf(pln(-10_001), bp).amount;
      for (let amount = -10_000; amount <= 10_000; amount++) {
        const current = percentOf(pln(amount), bp).amount;
        const mirrored = percentOf(negate(pln(amount)), bp).amount;
        if (current !== -mirrored || current < previous) {
          failures.push(`${bp} bp z ${amount} gr`);
        }
        previous = current;
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('POK z §3.1/§3.2 złożony z prymitywów (sam kalkulator to F-13)', () => {
  const FIXED_FEE = pln(299);

  it.each([
    ['20,00 zł → 4,39 zł', 2_000, 0, 439],
    ['100,00 zł → 9,99 zł', 10_000, 0, 999],
    ['1000,00 zł → 72,99 zł', 100_000, 0, 7_299],
    ['3000,00 zł → 152,99 zł', 100_000, 200_000, 15_299],
    ['10 000,00 zł → 432,99 zł', 100_000, 900_000, 43_299],
  ])('%s', (_label, firstTier, secondTier, expected) => {
    const pok = add(
      FIXED_FEE,
      add(percentOf(pln(firstTier), 700), percentOf(pln(secondTier), 400)),
    );
    expect(pok).toEqual(pln(expected));
  });
});

describe('splitGross', () => {
  it.each([
    // §3.2: POK brutto → netto przy VAT 23%
    ['4,39 zł → 3,57 zł netto', 439, 357, 82],
    ['9,99 zł → 8,12 zł netto', 999, 812, 187],
    ['72,99 zł → 59,34 zł netto', 7_299, 5_934, 1_365],
    ['152,99 zł → 124,38 zł netto', 15_299, 12_438, 2_861],
    ['432,99 zł → 352,02 zł netto', 43_299, 35_202, 8_097],
    ['0,01 zł → 0,01 zł netto', 1, 1, 0],
    ['0 zł', 0, 0, 0],
    ['zwrot −9,99 zł', -999, -812, -187],
  ])('VAT 23%%: %s', (_label, gross, net, vat) => {
    expect(splitGross(pln(gross), VAT_23)).toEqual({ net: pln(net), vat: pln(vat) });
  });

  it.each([
    // przy 100% netto = brutto / 2, więc nieparzyste kwoty dają dokładną połówkę
    [1, 1, 0],
    [3, 2, 1],
    [5, 3, 2],
    [-1, -1, 0],
    [-3, -2, -1],
  ])('remis zaokrągla netto od zera: brutto %i gr przy 100%% → netto %i, VAT %i', (g, n, v) => {
    expect(splitGross(pln(g), 10_000)).toEqual({ net: pln(n), vat: pln(v) });
  });

  it('stawka 0% oznacza VAT równy zero', () => {
    expect(splitGross(pln(12_345), 0)).toEqual({ net: pln(12_345), vat: pln(0) });
  });

  it('obsługuje skrajne kwoty bez przepełnienia', () => {
    for (const amount of [MAX, MIN]) {
      const { net, vat } = splitGross(pln(amount), VAT_23);
      expect(BigInt(net.amount) + BigInt(vat.amount)).toBe(BigInt(amount));
      expect(BigInt(net.amount)).toBe(referenceRoundHalfUp(BigInt(amount) * 10_000n, 12_300n));
    }
  });

  it.each([
    ['ujemna stawka', -100],
    ['ułamkowa stawka', 23.5],
    ['NaN', Number.NaN],
  ])('odrzuca stawkę: %s', (_label, rate) => {
    expect(() => splitGross(pln(999), rate)).toThrow(MoneyError);
  });

  it('właściwość: netto + VAT = brutto, zgodność ze wzorcem, symetria, monotoniczność', () => {
    const failures: string[] = [];
    for (const rate of [0, 500, 800, 2_300, 10_000]) {
      let previousNet = splitGross(pln(-20_001), rate).net.amount;
      for (let gross = -20_000; gross <= 20_000; gross++) {
        const { net, vat } = splitGross(pln(gross), rate);
        const mirrored = splitGross(pln(-gross), rate);
        const expectedNet = referenceRoundHalfUp(BigInt(gross) * 10_000n, 10_000n + BigInt(rate));
        const problems = [
          net.amount + vat.amount !== gross && 'netto + VAT ≠ brutto',
          BigInt(net.amount) !== expectedNet && `netto ≠ wzorzec ${expectedNet}`,
          gross >= 0 && !(net.amount >= 0 && net.amount <= gross) && 'netto poza [0, brutto]',
          gross >= 0 && !(vat.amount >= 0 && vat.amount <= gross) && 'VAT poza [0, brutto]',
          (mirrored.net.amount !== -net.amount || mirrored.vat.amount !== -vat.amount) &&
            'brak symetrii znaku',
          net.amount < previousNet && 'netto nie jest monotoniczne',
          // VAT z rozbicia różni się od VAT policzonego od netto najwyżej o 1 grosz
          Math.abs(vat.amount - percentOf(net, rate).amount) > 1 && 'VAT ≠ stawka × netto ± 1 gr',
        ].filter((problem) => problem !== false);
        if (problems.length > 0) {
          failures.push(`${rate} bp, brutto ${gross} gr: ${problems.join(', ')}`);
        }
        previousNet = net.amount;
      }
    }
    expect(failures).toEqual([]);
  });
});

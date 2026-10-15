import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  calculatePok,
  type FeeSchedule,
  feeScheduleSchema,
  feeTierRanges,
  money,
  MoneyError,
  percentOf,
} from '../index.js';

/** Cennik startowy z PROJECT.md §3.1. */
const STARTOWY: FeeSchedule = {
  currency: 'PLN',
  fixedFee: 299,
  tiers: [
    { upTo: 100_000, bp: 700 },
    { upTo: null, bp: 400 },
  ],
  vatRateBp: 2300,
};

const zl = (value: number) => money(Math.round(value * 100));

describe('calculatePok: przykłady z PROJECT.md §3.1 i §3.2', () => {
  it.each([
    [20, 4.39, 3.57],
    [100, 9.99, 8.12],
    [1000, 72.99, 59.34],
    [3000, 152.99, 124.38],
    [10_000, 432.99, 352.02],
  ])('%s zł → POK %s zł (netto %s zł)', (amount, fee, net) => {
    const quote = calculatePok(zl(amount), STARTOWY);
    expect(quote.fee).toEqual(zl(fee));
    expect(quote.net).toEqual(zl(net));
    expect(quote.vat.amount).toBe(quote.fee.amount - quote.net.amount);
    expect(quote.total).toEqual(money(zl(amount).amount + zl(fee).amount));
  });

  it('części składowe: opłata stała raz, część zmienna z progów', () => {
    expect(calculatePok(zl(3000), STARTOWY)).toMatchObject({
      itemsTotal: zl(3000),
      fixedFee: zl(2.99),
      variableFee: zl(150),
      fee: zl(152.99),
      vat: zl(28.61),
    });
  });

  it('granica progu należy do niższego progu: 4% dopiero od grosza powyżej 1000 zł', () => {
    expect(calculatePok(money(100_000), STARTOWY).variableFee).toEqual(zl(70));
    // 70 zł + 4% z 1 gr = 70,0004 zł → 70,00 zł; 70 zł + 4% z 13 gr = 70,0052 zł → 70,01 zł.
    expect(calculatePok(money(100_001), STARTOWY).variableFee).toEqual(zl(70));
    expect(calculatePok(money(100_013), STARTOWY).variableFee).toEqual(money(7_001));
  });

  it('zaokrąglenie half-up do grosza, raz dla całej części zmiennej', () => {
    // 7% z 0,50 zł = 3,5 gr → 4 gr; 7% z 0,07 zł = 0,49 gr → 0 gr.
    expect(calculatePok(money(50), STARTOWY).variableFee).toEqual(money(4));
    expect(calculatePok(money(7), STARTOWY).variableFee).toEqual(money(0));
    // Progi zaokrąglane osobno dałyby 2 gr (1 + 1), jedno zaokrąglenie 1 gr: 0,5 gr + 0,5 gr.
    const dwaProgi: FeeSchedule = {
      ...STARTOWY,
      fixedFee: 0,
      tiers: [
        { upTo: 10, bp: 500 },
        { upTo: null, bp: 500 },
      ],
    };
    expect(calculatePok(money(20), dwaProgi).fee).toEqual(money(1));
  });

  it('cennik z dodatkowymi polami (odpowiedź API, wiersz z bazy)', () => {
    const fromApi = { ...STARTOWY, id: 'x', validFrom: '2026-01-01T00:00:00.000Z', validTo: null };
    expect(calculatePok(zl(100), fromApi).fee).toEqual(zl(9.99));
  });

  it('kwota zerowa: sama opłata stała', () => {
    expect(calculatePok(money(0), STARTOWY).fee).toEqual(zl(2.99));
  });

  it('błędy: kwota ujemna, inna waluta, błędny cennik', () => {
    expect(() => calculatePok(money(-1), STARTOWY)).toThrow(MoneyError);
    expect(() =>
      calculatePok(money(100), { ...STARTOWY, currency: 'EUR' as FeeSchedule['currency'] }),
    ).toThrow(MoneyError);
    expect(() => calculatePok(money(100), { ...STARTOWY, tiers: [] })).toThrow(
      /Nieprawidłowy cennik POK/,
    );
  });
});

describe('feeScheduleSchema', () => {
  it('przyjmuje cennik startowy', () => {
    expect(feeScheduleSchema.parse(STARTOWY)).toEqual(STARTOWY);
  });

  it.each([
    ['brak progów', { tiers: [] }, 'tiers'],
    ['ostatni próg z limitem', { tiers: [{ upTo: 100, bp: 700 }] }, 'tiers.0.upTo'],
    [
      'próg bez limitu w środku',
      {
        tiers: [
          { upTo: null, bp: 700 },
          { upTo: null, bp: 400 },
        ],
      },
      'tiers.0.upTo',
    ],
    [
      'granice nie rosną',
      {
        tiers: [
          { upTo: 1000, bp: 700 },
          { upTo: 1000, bp: 500 },
          { upTo: null, bp: 400 },
        ],
      },
      'tiers.1.upTo',
    ],
    ['stawka powyżej 100%', { tiers: [{ upTo: null, bp: 10_001 }] }, 'tiers.0.bp'],
    ['stawka ułamkowa', { tiers: [{ upTo: null, bp: 7.5 }] }, 'tiers.0.bp'],
    ['ujemna opłata stała', { fixedFee: -1 }, 'fixedFee'],
    ['VAT ujemny', { vatRateBp: -1 }, 'vatRateBp'],
    ['nieznana waluta', { currency: 'EUR' }, 'currency'],
    ['nadmiarowe pole', { categoryId: 'x' }, ''],
  ])('odrzuca: %s', (_, patch, path) => {
    const result = feeScheduleSchema.safeParse({ ...STARTOWY, ...patch });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain(path);
  });
});

describe('feeTierRanges', () => {
  it('progi z dolnymi granicami', () => {
    expect(feeTierRanges(STARTOWY)).toEqual([
      { from: money(0), upTo: zl(1000), bp: 700 },
      { from: zl(1000), upTo: null, bp: 400 },
    ]);
  });
});

// --- Property-based (fast-check) ---

/** Dowolny poprawny cennik: 1–5 progów z rosnącymi granicami, stawki 0–100%. */
const scheduleArbitrary: fc.Arbitrary<FeeSchedule> = fc
  .record({
    fixedFee: fc.integer({ min: 0, max: 100_000 }),
    limits: fc.uniqueArray(fc.integer({ min: 1, max: 100_000_000 }), { maxLength: 4 }),
    rates: fc.array(fc.integer({ min: 0, max: 10_000 }), { minLength: 5, maxLength: 5 }),
    vatRateBp: fc.integer({ min: 0, max: 10_000 }),
  })
  .map(({ fixedFee, limits, rates, vatRateBp }) => {
    const bounds = [...limits].sort((a, b) => a - b);
    return {
      currency: 'PLN' as const,
      fixedFee,
      tiers: [...bounds, null].map((upTo, index) => ({ upTo, bp: rates[index] ?? 0 })),
      vatRateBp,
    };
  });

const amountArbitrary = fc.integer({ min: 0, max: 1_000_000_000_000 });

/**
 * Wzorzec liczony inaczej niż implementacja, jak progi podatkowe: kwota bazowa pełnych niższych
 * progów plus stawka bieżącego progu od nadwyżki ponad jego dolną granicę. Zaokrąglenie half-up
 * dla liczb nieujemnych: floor((2n + d) / 2d).
 */
function referencePok(amount: number, schedule: FeeSchedule): number {
  let base = 0n;
  let from = 0n;
  for (const tier of schedule.tiers) {
    const upTo = tier.upTo === null ? null : BigInt(tier.upTo);
    if (upTo === null || BigInt(amount) <= upTo) {
      const weighted = base + (BigInt(amount) - from) * BigInt(tier.bp);
      return schedule.fixedFee + Number((2n * weighted + 10_000n) / 20_000n);
    }
    base += (upTo - from) * BigInt(tier.bp);
    from = upTo;
  }
  throw new Error('cennik bez ostatniego progu');
}

describe('calculatePok: własności (property-based)', () => {
  it('zgodność z wzorem progów krańcowych', () => {
    fc.assert(
      fc.property(scheduleArbitrary, amountArbitrary, (schedule, amount) => {
        expect(calculatePok(money(amount), schedule).fee.amount).toBe(
          referencePok(amount, schedule),
        );
      }),
    );
  });

  it('monotoniczność: większa kwota nigdy nie daje mniejszego POK', () => {
    fc.assert(
      fc.property(scheduleArbitrary, amountArbitrary, amountArbitrary, (schedule, a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        expect(calculatePok(money(low), schedule).fee.amount).toBeLessThanOrEqual(
          calculatePok(money(high), schedule).fee.amount,
        );
      }),
    );
  });

  it('bez skoków: grosz więcej kwoty to najwyżej grosz więcej POK, także na granicy progu', () => {
    const nearBoundary = scheduleArbitrary.chain((schedule) =>
      fc.tuple(
        fc.constant(schedule),
        fc.oneof(
          amountArbitrary,
          fc
            .constantFrom(...schedule.tiers.map((tier) => tier.upTo ?? 0))
            .chain((bound) => fc.integer({ min: Math.max(0, bound - 2), max: bound + 2 })),
        ),
      ),
    );
    fc.assert(
      fc.property(nearBoundary, ([schedule, amount]) => {
        const step =
          calculatePok(money(amount + 1), schedule).fee.amount -
          calculatePok(money(amount), schedule).fee.amount;
        expect(step).toBeGreaterThanOrEqual(0);
        expect(step).toBeLessThanOrEqual(1);
      }),
    );
  });

  it('netto + VAT = brutto, kwota łączna = kwota + POK, opłata stała + część zmienna = POK', () => {
    fc.assert(
      fc.property(scheduleArbitrary, amountArbitrary, (schedule, amount) => {
        const quote = calculatePok(money(amount), schedule);
        expect(quote.net.amount + quote.vat.amount).toBe(quote.fee.amount);
        expect(quote.fixedFee.amount + quote.variableFee.amount).toBe(quote.fee.amount);
        expect(quote.total.amount).toBe(amount + quote.fee.amount);
      }),
    );
  });

  it('jeden próg: opłata stała + percentOf (ta sama funkcja zaokrąglenia)', () => {
    fc.assert(
      fc.property(amountArbitrary, fc.integer({ min: 0, max: 10_000 }), (amount, bp) => {
        const flat: FeeSchedule = { ...STARTOWY, tiers: [{ upTo: null, bp }] };
        expect(calculatePok(money(amount), flat).fee.amount).toBe(
          299 + percentOf(money(amount), bp).amount,
        );
      }),
    );
  });
});

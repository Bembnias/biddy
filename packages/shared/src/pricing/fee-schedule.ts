// Pakiet Ochrony Kupujących (F-13, PROJECT.md §3.1): cennik i kalkulator wspólny dla web, mobile
// i API. Klient pokazuje kwotę łączną tym samym kodem, którym backend liczy zamówienie.
import { z } from 'zod';

import { add } from '../money/arithmetic.js';
import { CURRENCIES, type CurrencyCode } from '../money/currency.js';
import { MoneyError } from '../money/errors.js';
import { assertMoney, money, type Money } from '../money/money.js';
import { BASIS_POINTS_SCALE, divideRoundHalfUp, splitGross } from '../money/rounding.js';

/** Próg cennika: stawka dla części kwoty do `upTo` (grosze, włącznie); `null` = bez limitu. */
export interface FeeTier {
  readonly upTo: number | null;
  /** Stawka w punktach bazowych: 700 = 7%. */
  readonly bp: number;
}

/**
 * Cennik POK: opłata stała raz na zamówienie i progi krańcowe (jak progi podatkowe). Zwykły
 * obiekt JSON: ten sam kształt ma wiersz `fee_schedules` i odpowiedź `GET /v1/fee-schedules/current`.
 */
export interface FeeSchedule {
  readonly currency: CurrencyCode;
  /** Opłata stała w groszach. */
  readonly fixedFee: number;
  readonly tiers: readonly FeeTier[];
  /** Stawka VAT od POK w punktach bazowych: 2300 = 23%. */
  readonly vatRateBp: number;
}

const currencyCodes = Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]];

export const feeTierSchema = z
  .object({
    upTo: z
      .int()
      .min(1)
      .max(Number.MAX_SAFE_INTEGER)
      .nullable()
      .describe('Górna granica progu w groszach (włącznie) albo null w ostatnim progu'),
    bp: z.int().min(0).max(BASIS_POINTS_SCALE).describe('Stawka w punktach bazowych (700 = 7%)'),
  })
  .strict();

/** Walidacja cennika (zapis w bazie, odczyt, odpowiedź API). */
export const feeScheduleSchema = z
  .object({
    currency: z.enum(currencyCodes),
    fixedFee: z.int().min(0).max(Number.MAX_SAFE_INTEGER).describe('Opłata stała w groszach'),
    tiers: z
      .array(feeTierSchema)
      .min(1)
      .max(20)
      .superRefine((tiers, context) => {
        tiers.forEach((tier, index) => {
          const last = index === tiers.length - 1;
          if (last !== (tier.upTo === null)) {
            context.addIssue({
              code: 'custom',
              path: [index, 'upTo'],
              message: last
                ? 'ostatni próg musi być bez limitu (upTo: null)'
                : 'tylko ostatni próg może być bez limitu',
            });
          }
          const previous = tiers[index - 1]?.upTo;
          if (
            previous !== undefined &&
            previous !== null &&
            tier.upTo !== null &&
            tier.upTo <= previous
          ) {
            context.addIssue({
              code: 'custom',
              path: [index, 'upTo'],
              message: 'granice progów muszą rosnąć',
            });
          }
        });
      }),
    vatRateBp: z.int().min(0).max(BASIS_POINTS_SCALE).describe('Stawka VAT (2300 = 23%)'),
  })
  .strict();

/** Próg z dolną granicą: część kwoty powyżej `from` do `upTo` (włącznie) ma stawkę `bp`. */
export interface FeeTierRange {
  readonly from: Money;
  readonly upTo: Money | null;
  readonly bp: number;
}

/** Progi cennika z dolnymi granicami, np. do opisu „7% kwoty do 1000 zł + 4% nadwyżki”. */
export function feeTierRanges(schedule: FeeSchedule): FeeTierRange[] {
  let from = 0;
  return schedule.tiers.map((tier) => {
    const range = {
      from: money(from, schedule.currency),
      upTo: tier.upTo === null ? null : money(tier.upTo, schedule.currency),
      bp: tier.bp,
    };
    from = tier.upTo ?? from;
    return range;
  });
}

/** Wynik kalkulatora POK. Zawsze `fee = fixedFee + variableFee` i `fee = net + vat`. */
export interface PokQuote {
  /** Suma wylicytowanych kwot zamówienia, od której liczymy POK. */
  readonly itemsTotal: Money;
  /** POK brutto. */
  readonly fee: Money;
  readonly fixedFee: Money;
  /** Część zależna od kwoty (suma progów), zaokrąglona raz, half-up. */
  readonly variableFee: Money;
  readonly net: Money;
  readonly vat: Money;
  /** Kwota z POK, bez dostawy. */
  readonly total: Money;
}

/**
 * POK dla sumy wylicytowanych kwot zamówienia: opłata stała + Σ (stawka × część kwoty w progu).
 *
 * Sumę iloczynów liczymy dokładnie (bigint) i zaokrąglamy raz, half-up do grosza: wynik zgadza
 * się ze wzorem z §3.1 i rośnie monotonicznie z kwotą, bez skoku na granicy progu.
 *
 * @example calculatePok(money(10_000), cennikStartowy).fee // 999 gr: 2,99 zł + 7% ze 100 zł
 * @throws {MoneyError} gdy kwota jest ujemna, w innej walucie niż cennik albo cennik jest błędny
 */
export function calculatePok(itemsTotal: Money, schedule: FeeSchedule): PokQuote {
  assertMoney(itemsTotal);
  assertFeeSchedule(schedule);
  if (itemsTotal.currency !== schedule.currency) {
    throw new MoneyError(
      `Cennik POK jest w ${String(schedule.currency)}, a kwota w ${String(itemsTotal.currency)}`,
    );
  }
  if (itemsTotal.amount < 0) {
    throw new MoneyError(`Kwota zamówienia nie może być ujemna, otrzymano ${itemsTotal.amount}`);
  }
  const amount = BigInt(itemsTotal.amount);
  let weighted = 0n;
  let lower = 0n;
  for (const tier of schedule.tiers) {
    const upper = tier.upTo === null ? amount : BigInt(tier.upTo);
    if (amount > lower) {
      const inTier = (amount < upper ? amount : upper) - lower;
      weighted += inTier * BigInt(tier.bp);
    }
    lower = upper;
  }
  const variableFee = money(
    divideRoundHalfUp(weighted, BigInt(BASIS_POINTS_SCALE)),
    schedule.currency,
  );
  const fixedFee = money(schedule.fixedFee, schedule.currency);
  const fee = add(fixedFee, variableFee);
  const { net, vat } = splitGross(fee, schedule.vatRateBp);
  return { itemsTotal, fee, fixedFee, variableFee, net, vat, total: add(itemsTotal, fee) };
}

/** Sprawdza pola cennika; dodatkowe pola (np. `id` i daty z API albo bazy) nie przeszkadzają. */
function assertFeeSchedule(schedule: FeeSchedule): void {
  const { currency, fixedFee, tiers, vatRateBp } = schedule;
  const result = feeScheduleSchema.safeParse({ currency, fixedFee, tiers, vatRateBp });
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new MoneyError(
      `Nieprawidłowy cennik POK: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim(),
    );
  }
}

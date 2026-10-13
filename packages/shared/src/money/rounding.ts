import { MoneyError } from './errors.js';
import { assertMoney, assertSafeInteger, money, type Money } from './money.js';

/** 100% wyrażone w punktach bazowych (1 bp = 0,01%, więc 700 bp = 7%, 2300 bp = 23%). */
export const BASIS_POINTS_SCALE = 10_000;

const SCALE = BigInt(BASIS_POINTS_SCALE);

/**
 * JEDYNA funkcja zaokrąglania kwot w Biddy (PROJECT.md §7.7): dzieli `numerator / denominator`
 * i zaokrągla wynik half-up do pełnej jednostki podrzędnej (grosza).
 *
 * „Half-up” oznacza połówkę zaokrągloną OD ZERA, symetrycznie dla liczb ujemnych:
 * 2,5 → 3, −2,5 → −3, 2,4 → 2, −2,4 → −2.
 *
 * Działa wyłącznie na liczbach całkowitych (bigint), bez arytmetyki zmiennoprzecinkowej.
 * Licznik zwykle jest iloczynem kwoty w groszach i stawki, np. `BigInt(m.amount) * 700n`
 * dla 7% przy mianowniku `10_000n`; bigint chroni ten iloczyn przed przepełnieniem.
 *
 * @example divideRoundHalfUp(2000n * 700n, 10_000n) // 140n: 7% z 20,00 zł = 1,40 zł
 * @throws {MoneyError} przy dzieleniu przez zero lub argumentach innych niż bigint
 */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (typeof numerator !== 'bigint' || typeof denominator !== 'bigint') {
    throw new MoneyError('divideRoundHalfUp przyjmuje wyłącznie argumenty typu bigint');
  }
  if (denominator === 0n) {
    throw new MoneyError('Dzielenie przez zero');
  }
  const numeratorNegative = numerator < 0n;
  const denominatorNegative = denominator < 0n;
  const negative = numeratorNegative !== denominatorNegative;
  const n = numeratorNegative ? -numerator : numerator;
  const d = denominatorNegative ? -denominator : denominator;
  const quotient = n / d;
  const remainder = n % d;
  // Reszta ≥ połowy dzielnika: zaokrąglamy wartość bezwzględną w górę, czyli od zera.
  const rounded = 2n * remainder >= d ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/**
 * Procent z kwoty, zaokrąglony half-up do grosza.
 *
 * @param basisPoints stawka w punktach bazowych (liczba całkowita): 700 = 7%
 * @example percentOf(money(2000), 700) // 140 gr, czyli 7% z 20,00 zł = 1,40 zł
 */
export function percentOf(m: Money, basisPoints: number): Money {
  assertMoney(m);
  assertSafeInteger(basisPoints, 'Stawka w punktach bazowych');
  return money(divideRoundHalfUp(BigInt(m.amount) * BigInt(basisPoints), SCALE), m.currency);
}

/** Kwota brutto rozbita na netto i VAT. Zawsze `net + vat === gross`. */
export type GrossSplit = {
  readonly net: Money;
  readonly vat: Money;
};

/**
 * Rozbija kwotę brutto (np. POK) na netto i VAT.
 * Netto = brutto × 10000 / (10000 + stawka), zaokrąglone half-up; VAT = brutto − netto,
 * więc suma części zawsze odtwarza brutto co do grosza (wymóg ledgera, §7.7).
 *
 * @param vatRateBp stawka VAT w punktach bazowych (liczba całkowita ≥ 0): 2300 = 23%
 * @example splitGross(money(999), 2300) // { net: 812 gr, vat: 187 gr }: 9,99 zł = 8,12 zł + 1,87 zł
 */
export function splitGross(gross: Money, vatRateBp: number): GrossSplit {
  assertMoney(gross);
  assertSafeInteger(vatRateBp, 'Stawka VAT w punktach bazowych');
  if (vatRateBp < 0) {
    throw new MoneyError(`Stawka VAT nie może być ujemna, otrzymano ${vatRateBp} bp`);
  }
  const grossAmount = BigInt(gross.amount);
  const net = divideRoundHalfUp(grossAmount * SCALE, SCALE + BigInt(vatRateBp));
  return {
    net: money(net, gross.currency),
    vat: money(grossAmount - net, gross.currency),
  };
}

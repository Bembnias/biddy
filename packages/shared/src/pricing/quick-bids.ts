// Szybkie kwoty w panelu licytacji (F-63): minimalna oferta i dwie „okrągłe” kwoty powyżej niej,
// liczone z kroku przebicia (§6.3), więc w każdym przedziale cen przyciski dają ładne liczby.
import { assertMoney, money, type Money } from '../money/money.js';
import { bidIncrement } from './bid-increments.js';

/** Druga kwota to wielokrotność 5 kroków przebicia, trzecia: wielokrotność 10 kroków. */
export const QUICK_BID_STEP_MULTIPLES = [5, 10] as const;

/** Najmniejsza wielokrotność `of` większa od `value`. */
const nextMultiple = (value: number, of: number) => (Math.floor(value / of) + 1) * of;

/**
 * Trzy szybkie kwoty: minimalna kolejna oferta, najmniejsza wielokrotność 5 kroków przebicia
 * większa od niej i najmniejsza wielokrotność 10 kroków większa od drugiej. Krok to przebicie
 * przy kwocie minimalnej.
 *
 * @example quickBidAmounts(money(32_500)) // 325 zł, 350 zł, 400 zł (krok 5 zł)
 */
export function quickBidAmounts(minimum: Money): readonly [Money, Money, Money] {
  assertMoney(minimum);
  const step = bidIncrement(minimum).amount;
  const [second, third] = QUICK_BID_STEP_MULTIPLES;
  const secondAmount = nextMultiple(minimum.amount, step * second);
  const thirdAmount = nextMultiple(secondAmount, step * third);
  return [minimum, money(secondAmount, minimum.currency), money(thirdAmount, minimum.currency)];
}

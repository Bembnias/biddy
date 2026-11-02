// Reguły checkoutu (F-25, PROJECT.md §6.8, §7.4) bez bazy danych: termin efektywny z przedłużeniem
// dla płatności w toku, suma do zapłaty, blokady nowej płatności i decyzja po udanej płatności.
import type { PaymentStatus } from '../../payments/index.js';
import type { OrderStatus } from '../db/orders.schema.js';

/** Płatność w PENDING założona przed terminem przesuwa anulowanie o tyle (§6.8). */
export const PENDING_PAYMENT_GRACE_MS = 30 * 60 * 1_000;

/** Nadanie: 5 dni roboczych od opłacenia (§7.4). */
export const SHIP_WITHIN_BUSINESS_DAYS = 5;

/** Metody płatności w checkoutcie web; Apple Pay i Google Pay z prawdziwym operatorem (F-31). */
export const CHECKOUT_PAYMENT_METHODS = ['BLIK', 'CARD', 'PAY_BY_LINK'] as const;
export type CheckoutPaymentMethod = (typeof CHECKOUT_PAYMENT_METHODS)[number];

/** Płatność widziana przez reguły (najnowsza najpierw w listach). */
export interface PaymentAttempt {
  readonly status: PaymentStatus;
  readonly createdAt: Date;
}

/** Płatność w PENDING założona przed terminem (przedłuża anulowanie). */
export function pendingBeforeDeadline(
  dueAt: Date,
  attempts: readonly PaymentAttempt[],
): PaymentAttempt | undefined {
  return attempts.find(
    (attempt) => attempt.status === 'PENDING' && attempt.createdAt.getTime() < dueAt.getTime(),
  );
}

/**
 * Chwila, od której zamówienie można anulować: termin płatności, a przy płatności w toku
 * założonej przed terminem termin + 30 min.
 */
export function effectivePaymentDeadline(dueAt: Date, attempts: readonly PaymentAttempt[]): Date {
  return pendingBeforeDeadline(dueAt, attempts) === undefined
    ? dueAt
    : new Date(dueAt.getTime() + PENDING_PAYMENT_GRACE_MS);
}

/** Suma do zapłaty: cena + POK + dostawa (grosze). */
export function checkoutTotal(order: {
  readonly itemsTotal: number;
  readonly pokFee: number;
  readonly shippingFee: number | null;
}): number {
  return order.itemsTotal + order.pokFee + (order.shippingFee ?? 0);
}

export type CheckoutBlocker =
  'ORDER_NOT_AWAITING_PAYMENT' | 'PAYMENT_DEADLINE_PASSED' | 'PAYMENT_IN_PROGRESS';

/**
 * Czy kupujący może zmienić dostawę albo zacząć płatność: zamówienie czeka na płatność, termin nie
 * minął (nowa płatność tylko przed terminem, bez przedłużenia), a żadna płatność nie jest w toku
 * ani udana (nie da się zapłacić dwa razy).
 */
export function checkoutBlocker(
  order: { readonly status: OrderStatus; readonly paymentDueAt: Date },
  attempts: readonly PaymentAttempt[],
  now: Date,
): CheckoutBlocker | undefined {
  if (order.status !== 'AWAITING_PAYMENT') {
    return 'ORDER_NOT_AWAITING_PAYMENT';
  }
  if (now.getTime() >= order.paymentDueAt.getTime()) {
    return 'PAYMENT_DEADLINE_PASSED';
  }
  if (attempts.some((attempt) => attempt.status === 'PENDING' || attempt.status === 'SUCCEEDED')) {
    return 'PAYMENT_IN_PROGRESS';
  }
  return undefined;
}

/** Co zrobić z udaną płatnością: opłacić zamówienie albo ją zwrócić. */
export type PaymentSettlement = 'PAY' | 'REFUND_LATE' | 'REFUND_DUPLICATE';

export function settlementFor(status: OrderStatus): PaymentSettlement {
  if (status === 'AWAITING_PAYMENT') {
    return 'PAY';
  }
  return status === 'CANCELLED_UNPAID' ? 'REFUND_LATE' : 'REFUND_DUPLICATE';
}

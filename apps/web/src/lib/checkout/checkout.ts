// Checkout (F-25): który ekran pokazać dla stanu zamówienia i ostatniej płatności, suma przed
// zapisem dostawy i klucz idempotencji płatności. Kwoty liczy API; tu liczymy tylko sumę na
// przycisku dla wybranej opcji, którą API porównuje ze swoją (expectedTotal).
import type { CheckoutDto } from '@biddy/api-client';

export type CheckoutStage =
  /** Formularz dostawy i płatności (także po nieudanej płatności). */
  | 'form'
  /** Płatność w toku albo udana, ale zamówienie jeszcze nie opłacone: odświeżamy co 2 s. */
  | 'waiting'
  /** Zamówienie opłacone (teraz albo wcześniej). */
  | 'paid'
  /** Termin minął albo zamówienie anulowane. */
  | 'expired';

export function checkoutStage(view: CheckoutDto): CheckoutStage {
  const { order, payment, blocker } = view;
  if (order.status === 'CANCELLED_UNPAID') {
    return 'expired';
  }
  if (order.status !== 'AWAITING_PAYMENT') {
    return 'paid';
  }
  if (payment?.status === 'PENDING' || payment?.status === 'SUCCEEDED') {
    return 'waiting';
  }
  return blocker === 'PAYMENT_DEADLINE_PASSED' ? 'expired' : 'form';
}

/** Suma na przycisku dla wybranej usługi: cena + POK + dostawa (grosze). */
export function totalWith(view: CheckoutDto, carrierId: string | undefined): number {
  const option = view.options.find((candidate) => candidate.carrierId === carrierId);
  return view.order.itemsTotal + view.order.pokFee + (option?.price ?? 0);
}

/** Nowy klucz Idempotency-Key dla próby płatności. */
export function newPaymentKey(): string {
  return crypto.randomUUID();
}

/** Odświeżanie checkoutu, gdy czekamy na wynik płatności. */
export const CHECKOUT_POLL_MS = 2_000;

// Wartości słownikowe płatności (F-23, PROJECT.md §7.8): statusy, metody, powody porażki, statusy
// sprzedawcy u operatora, powody nieudanych wypłat (F-27). Plik bez zależności runtime: czytają go tabele (*.schema.ts), które
// ładuje też drizzle-kit.

/** Operatorzy płatności, dla których przewidujemy adaptery (§7.6). */
export const PAYMENT_PROVIDERS = ['fake', 'payu', 'mangopay', 'stripe'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export function isPaymentProvider(value: string): value is PaymentProvider {
  return (PAYMENT_PROVIDERS as readonly string[]).includes(value);
}

/** Metody płatności z checkoutu (§7.8, `CreatePaymentInput.method`). */
export const PAYMENT_METHODS = ['BLIK', 'CARD', 'PAY_BY_LINK', 'APPLE_PAY', 'GOOGLE_PAY'] as const;
export type PaymentMethodType = (typeof PAYMENT_METHODS)[number];

/** Stan płatności u nas (i w migawce operatora). */
export const PAYMENT_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Powód nieudanej płatności, niezależny od operatora. */
export const PAYMENT_FAILURE_REASONS = [
  'DECLINED',
  'INVALID_BLIK_CODE',
  'EXPIRED',
  'CANCELLED',
  'SELLER_NOT_VERIFIED',
  'PROVIDER_ERROR',
] as const;
export type PaymentFailureReason = (typeof PAYMENT_FAILURE_REASONS)[number];

/**
 * Powód zwrotu płatności: `FULL_REFUND_REASONS` z ledgera (plik tabel nie importuje ledgera),
 * `NOT_PICKED_UP`, czyli zwrot ceny i POK bez dostawy (osobny szablon księgowania, §7.4),
 * i `DISPUTE_PARTIAL`, czyli zwrot części ceny w sporze (ORDER_PARTIALLY_REFUNDED, §7.5).
 * Checkout zwraca płatności spóźnione i zdublowane (F-25), cykl zamówienia nienadane,
 * nieodebrane i zaginione (F-26), spory pełne i częściowe (F-28), a chargebacki dojdą w F-31.
 */
export const REFUND_REASONS = [
  'NOT_SHIPPED',
  'LOST',
  'DISPUTE',
  'LATE_PAYMENT',
  'DUPLICATE_PAYMENT',
  'CHARGEBACK',
  'NOT_PICKED_UP',
  'DISPUTE_PARTIAL',
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

/** Stan zwrotu: PENDING do potwierdzenia przez operatora (webhook). */
export const REFUND_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/**
 * Zwolnienie środków sprzedającego u operatora (F-26): `NOT_REQUIRED` w modelu `SELLER_BALANCE`,
 * gdzie zwolnienie robi tylko ledger.
 */
export const FUND_RELEASE_STATUSES = ['PENDING', 'SUCCEEDED', 'NOT_REQUIRED'] as const;
export type FundReleaseStatus = (typeof FUND_RELEASE_STATUSES)[number];

/**
 * Powód nieudanej wypłaty (F-27): odrzucona przez operatora (webhook PAYOUT_FAILED) albo
 * odrzucona od razu przy zleceniu (błąd portu z tym samym kodem).
 */
export const PAYOUT_FAILURE_REASONS = [
  'REJECTED',
  'SELLER_NOT_VERIFIED',
  'INSUFFICIENT_BALANCE',
  'INVALID_REQUEST',
] as const;
export type PayoutFailureReason = (typeof PAYOUT_FAILURE_REASONS)[number];

/** Status weryfikacji (KYC) sprzedawcy u operatora. */
export const SELLER_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;
export type SellerStatus = (typeof SELLER_STATUSES)[number];

/** Rodzaj konta sprzedawcy u operatora: osoba prywatna albo firma (§4, DAC7). */
export const SELLER_ACCOUNT_TYPES = ['PRIVATE', 'BUSINESS'] as const;
export type SellerAccountType = (typeof SELLER_ACCOUNT_TYPES)[number];

/** Wynik obsługi webhooka: HANDLED albo IGNORED (zdarzenie bez obsługi w tej wersji). */
export const WEBHOOK_OUTCOMES = ['HANDLED', 'IGNORED'] as const;
export type WebhookOutcome = (typeof WEBHOOK_OUTCOMES)[number];

/** Lista wartości do warunku `in (…)` w CHECK. */
export function sqlList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

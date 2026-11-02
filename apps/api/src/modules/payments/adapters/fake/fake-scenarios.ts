// Magiczne wartości FakeGateway (F-23, PROJECT.md §7.8): kody BLIK wybierające wynik płatności
// i adresy e-mail wybierające wynik weryfikacji sprzedawcy. Działają tylko w adapterze testowym.
import type { FakePaymentScenario } from '../../db/fake-gateway.schema.js';
import type { SellerStatus } from '../../domain/payment-values.js';
import type { GatewayCapabilities, PaymentMethod } from '../../ports/payment-gateway.port.js';

/** Kody BLIK trybu testowego. */
export const FAKE_BLIK_CODES = {
  /** Płatność udana (po opóźnieniu, webhookiem). */
  SUCCEED: '777123',
  /** Płatność odrzucona (po opóźnieniu, webhookiem). */
  DECLINE: '111111',
  /** Płatność wisi w PENDING bez webhooka (test pollingu i terminów). */
  HANG: '222222',
} as const;

/**
 * Możliwości FakeGateway: model SELLER_BALANCE jak przewidujemy w PayU (środki od razu na saldzie
 * sprzedawcy u operatora, zwolnienie tylko w ledgerze), z przenoszeniem środków i bez wymogu KYC
 * przed płatnością (§7.6, decyzja 5).
 */
export const FAKE_CAPABILITIES: GatewayCapabilities = {
  holdModel: 'SELLER_BALANCE',
  maxHoldDays: 60,
  partialRefunds: true,
  blikCodeInOwnUi: true,
  embeddedKyc: false,
  savedCards: false,
  internalTransfers: true,
  paymentRequiresVerifiedSeller: false,
};

/** Scenariusz płatności: kod BLIK wybiera wynik, a pozostałe metody idą przez stronę testową. */
export function paymentScenario(method: PaymentMethod): FakePaymentScenario {
  if (method.type !== 'BLIK' || method.code === undefined) {
    return 'BUYER';
  }
  switch (method.code) {
    case FAKE_BLIK_CODES.SUCCEED:
      return 'SUCCEED';
    case FAKE_BLIK_CODES.DECLINE:
      return 'DECLINE';
    case FAKE_BLIK_CODES.HANG:
      return 'HANG';
    default:
      return 'INVALID_CODE';
  }
}

/**
 * Wynik rejestracji sprzedawcy: domyślnie od razu zweryfikowany; `+kyc-pending` albo
 * `+kyc-rejected` w części lokalnej e-maila (np. jan+kyc-pending@example.com) daje weryfikację
 * w toku albo odrzuconą.
 */
export function registrationStatus(email: string): SellerStatus {
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  if (local.includes('+kyc-rejected')) {
    return 'REJECTED';
  }
  if (local.includes('+kyc-pending')) {
    return 'PENDING';
  }
  return 'VERIFIED';
}

/**
 * Część zwrotu pobierana z salda sprzedawcy: zwroty schodzą najpierw z części sprzedawcy
 * (ceny), a dopiero potem z części platformy (POK, dostawa).
 *
 * @param sellerAmount część sprzedawcy w płatności
 * @param refundedBefore suma wcześniejszych zwrotów tej płatności
 * @param refund kwota bieżącego zwrotu
 */
export function sellerShareOfRefund(
  sellerAmount: number,
  refundedBefore: number,
  refund: number,
): number {
  return Math.min(refundedBefore + refund, sellerAmount) - Math.min(refundedBefore, sellerAmount);
}

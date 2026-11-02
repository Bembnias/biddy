// Port płatności (F-23, PROJECT.md §7.8): domena Biddy rozmawia z operatorem wyłącznie przez ten
// interfejs. Opisuje operacje biznesowe Biddy (zarejestruj sprzedawcę, utwórz płatność, zwolnij
// środki, zwróć, wypłać), a nie wywołania API konkretnego operatora. Typy i SDK operatora wolno
// importować tylko w adapters/<operator>/.
//
// Kwoty zawsze w groszach (Money). Identyfikatory operatora są nieprzezroczystymi tekstami.
// Każda operacja zmieniająca stan dostaje nasz klucz idempotencji: ponowienie z tym samym kluczem
// i tymi samymi danymi zwraca ten sam wynik, a z innymi danymi kończy się IDEMPOTENCY_CONFLICT.
import type { Money } from '@biddy/shared';

import type {
  PaymentFailureReason,
  PaymentProvider,
  PaymentStatus,
  SellerAccountType,
  SellerStatus,
} from '../domain/payment-values.js';

export type {
  PaymentFailureReason,
  PaymentProvider,
  PaymentStatus,
  SellerAccountType,
  SellerStatus,
} from '../domain/payment-values.js';

export interface PaymentGateway {
  readonly provider: PaymentProvider;
  readonly capabilities: GatewayCapabilities;

  /** Rejestracja sprzedawcy u operatora (minimalny zestaw danych; pełne KYC w F-32). */
  registerSeller(input: RegisterSellerInput): Promise<SellerAccountResult>;
  getSellerStatus(providerSellerId: string): Promise<SellerStatus>;

  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  getPayment(providerPaymentId: string): Promise<PaymentSnapshot>;

  releaseFunds(input: ReleaseFundsInput): Promise<ReleaseFundsResult>;
  refund(input: RefundInput): Promise<RefundResult>;
  createPayout(input: CreatePayoutInput): Promise<PayoutResult>;

  /** Weryfikuje podpis i tłumaczy webhook operatora na zdarzenia Biddy (INVALID_SIGNATURE). */
  parseWebhook(request: RawWebhookRequest): Promise<NormalizedPaymentEvent[]>;
}

/** Możliwości operatora, o które pyta domena (logika biznesowa jest wspólna). */
export interface GatewayCapabilities {
  /** Gdzie leżą środki w trakcie wstrzymania (tabela w §7.8). */
  readonly holdModel: 'PLATFORM_BALANCE' | 'BUYER_WALLET' | 'SELLER_BALANCE';
  /** Najdłuższe wstrzymanie wypłaty środków sprzedawcy u operatora (wymagamy ≥ 60 dni). */
  readonly maxHoldDays: number;
  readonly partialRefunds: boolean;
  /** Kod BLIK wpisywany w UI Biddy (bez przekierowania do operatora). */
  readonly blikCodeInOwnUi: boolean;
  /** KYC w naszym UI zamiast przekierowania. */
  readonly embeddedKyc: boolean;
  readonly savedCards: boolean;
  /** Przeniesienie środków platforma ↔ sprzedawca (potrącenia, rekompensaty, §7.9). */
  readonly internalTransfers: boolean;
  /** Split na sprzedawcę wymaga zakończonego KYC (§7.6, decyzja 5). */
  readonly paymentRequiresVerifiedSeller: boolean;
}

export interface RegisterSellerInput {
  /** ID użytkownika Biddy. */
  readonly sellerId: string;
  readonly idempotencyKey: string;
  readonly type: SellerAccountType;
  readonly email: string;
  readonly displayName: string;
}

export interface SellerAccountResult {
  readonly providerSellerId: string;
  readonly status: SellerStatus;
}

export type PaymentMethod =
  | { readonly type: 'BLIK'; readonly code?: string }
  | { readonly type: 'CARD' }
  | { readonly type: 'PAY_BY_LINK'; readonly bankId?: string }
  | { readonly type: 'APPLE_PAY' | 'GOOGLE_PAY' };

export interface CreatePaymentInput {
  readonly orderId: string;
  readonly idempotencyKey: string;
  readonly total: Money;
  /** Podział wpłaty: część sprzedawcy (cena) i platformy (POK + dostawa); suma = total. */
  readonly split: {
    readonly providerSellerId: string;
    readonly sellerAmount: Money;
    readonly platformAmount: Money;
  };
  readonly method: PaymentMethod;
  readonly buyer: { readonly id: string; readonly email: string; readonly ip: string };
  /** Dokąd operator odsyła kupującego po płatności z przekierowaniem. */
  readonly returnUrl: string;
}

export type CreatePaymentResult =
  | { readonly status: 'SUCCEEDED' | 'PENDING'; readonly providerPaymentId: string }
  | {
      readonly status: 'ACTION_REQUIRED';
      readonly providerPaymentId: string;
      readonly redirectUrl: string;
    }
  | {
      readonly status: 'FAILED';
      readonly providerPaymentId?: string;
      readonly reason: PaymentFailureReason;
    };

/** Stan płatności u operatora (polling zapasowy, uzgodnienia). */
export interface PaymentSnapshot {
  readonly providerPaymentId: string;
  readonly status: PaymentStatus;
  readonly amount: Money;
  readonly refundedAmount: Money;
  readonly failureReason?: PaymentFailureReason;
  /** Opłata operatora za płatność, gdy ją zna (`payment_fees_expense`). */
  readonly providerFee?: Money;
}

export interface ReleaseFundsInput {
  readonly providerPaymentId: string;
  readonly providerSellerId: string;
  /** Kwota dla sprzedawcy (cena). */
  readonly sellerAmount: Money;
  readonly idempotencyKey: string;
}

/**
 * NOT_REQUIRED: operator nie wymaga wywołania (model SELLER_BALANCE: środki już są na saldzie
 * sprzedawcy u operatora, zwolnienie jest tylko w ledgerze).
 */
export type ReleaseFundsResult =
  | { readonly status: 'SUCCEEDED'; readonly providerTransferId: string }
  | { readonly status: 'NOT_REQUIRED' };

export interface RefundInput {
  readonly providerPaymentId: string;
  readonly amount: Money;
  readonly idempotencyKey: string;
}

export interface RefundResult {
  readonly providerRefundId: string;
  /** Wynik końcowy przychodzi webhookiem REFUND_SUCCEEDED albo REFUND_FAILED. */
  readonly status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
}

export interface CreatePayoutInput {
  readonly providerSellerId: string;
  readonly amount: Money;
  readonly idempotencyKey: string;
}

export interface PayoutResult {
  readonly providerPayoutId: string;
  /** Wynik końcowy przychodzi webhookiem PAYOUT_PAID albo PAYOUT_FAILED. */
  readonly status: 'PENDING' | 'PAID' | 'FAILED';
}

/** Surowe żądanie webhooka: podpis liczy się z bajtów body, więc nie parsujemy go wcześniej. */
export interface RawWebhookRequest {
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly rawBody: Buffer;
}

export type ChargebackOutcome = 'WON' | 'LOST';

/** Zdarzenie operatora przetłumaczone na język Biddy. `eventId` jest kluczem idempotencji. */
export type NormalizedPaymentEvent = { readonly eventId: string; readonly occurredAt: Date } & (
  | {
      readonly type: 'PAYMENT_SUCCEEDED';
      readonly providerPaymentId: string;
      readonly amount: Money;
      readonly providerFee?: Money;
    }
  | {
      readonly type: 'PAYMENT_FAILED';
      readonly providerPaymentId: string;
      readonly reason: PaymentFailureReason;
    }
  | {
      readonly type: 'REFUND_SUCCEEDED' | 'REFUND_FAILED';
      readonly providerRefundId: string;
      readonly providerPaymentId: string;
      readonly amount: Money;
    }
  | {
      readonly type: 'PAYOUT_PAID' | 'PAYOUT_FAILED';
      readonly providerPayoutId: string;
      readonly amount: Money;
    }
  | {
      readonly type: 'SELLER_STATUS_CHANGED';
      readonly providerSellerId: string;
      readonly status: SellerStatus;
    }
  | {
      readonly type: 'CHARGEBACK_OPENED';
      readonly providerChargebackId: string;
      readonly providerPaymentId: string;
      readonly amount: Money;
    }
  | {
      readonly type: 'CHARGEBACK_CLOSED';
      readonly providerChargebackId: string;
      readonly providerPaymentId: string;
      readonly amount: Money;
      readonly outcome: ChargebackOutcome;
    }
);

export type NormalizedPaymentEventType = NormalizedPaymentEvent['type'];

export type PaymentGatewayErrorCode =
  /** Dane wejściowe, których operator nie przyjmie (kwoty, waluta, nieznany sprzedawca). */
  | 'INVALID_REQUEST'
  /** Ten sam klucz idempotencji z innymi danymi. */
  | 'IDEMPOTENCY_CONFLICT'
  /** Podpis webhooka niepoprawny albo za stary. */
  | 'INVALID_SIGNATURE'
  /** Nieznany obiekt operatora (płatność, sprzedawca). */
  | 'NOT_FOUND'
  /** Zwrot (łącznie z wcześniejszymi) większy niż płatność. */
  | 'REFUND_EXCEEDS_PAYMENT'
  /** Wypłata ponad saldo sprzedawcy u operatora. */
  | 'INSUFFICIENT_BALANCE'
  /** Operacja wymaga zweryfikowanego sprzedawcy (KYC). */
  | 'SELLER_NOT_VERIFIED'
  /** Operator niedostępny; ponowienie z tym samym kluczem jest bezpieczne. */
  | 'UNAVAILABLE';

/** Błąd operatora w języku Biddy; adapter tłumaczy na niego błędy API operatora. */
export class PaymentGatewayError extends Error {
  readonly code: PaymentGatewayErrorCode;

  constructor(code: PaymentGatewayErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PaymentGatewayError';
    this.code = code;
  }
}

export function isPaymentGatewayError(
  error: unknown,
  code?: PaymentGatewayErrorCode,
): error is PaymentGatewayError {
  return error instanceof PaymentGatewayError && (code === undefined || error.code === code);
}

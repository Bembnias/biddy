// Eventy domenowe modułu payments (F-23, F-25, F-27, PROJECT.md §14.3). Konsumenci: przejścia
// zamówienia po płatności (F-25: OrderPaid, zwrot spóźnionej płatności), wykonanie zwrotu
// i wypłaty u operatora (F-25, F-27), powiadomienia (F-26, F-27) i weryfikacja sprzedawcy (F-32).
import { CURRENCIES, type CurrencyCode, PAYOUT_TRIGGERS } from '@biddy/shared';
import { z } from 'zod';

import { defineDomainEvent } from '../../infra/outbox/index.js';
import {
  PAYMENT_FAILURE_REASONS,
  PAYMENT_METHODS,
  PAYOUT_FAILURE_REASONS,
  REFUND_REASONS,
  SELLER_STATUSES,
} from './domain/payment-values.js';

const money = z.object({
  amount: z.int().nonnegative(),
  currency: z.enum(Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]]),
});

/** Operator potwierdził wpłatę kupującego (webhook albo polling); ledger ma już PAYMENT_RECEIVED. */
export const PaymentSucceeded = defineDomainEvent({
  type: 'PaymentSucceeded',
  version: 1,
  aggregateType: 'payment',
  payload: z.object({
    orderId: z.uuid(),
    buyerId: z.uuid(),
    sellerId: z.uuid(),
    provider: z.string().min(1),
    method: z.enum(PAYMENT_METHODS),
    amount: money,
  }),
});

/** Płatność nieudana: odrzucona u operatora albo bez odpowiedzi operatora (PROVIDER_ERROR). */
export const PaymentFailed = defineDomainEvent({
  type: 'PaymentFailed',
  version: 1,
  aggregateType: 'payment',
  payload: z.object({
    orderId: z.uuid(),
    buyerId: z.uuid(),
    provider: z.string().min(1),
    reason: z.enum(PAYMENT_FAILURE_REASONS),
  }),
});

/** Zmiana statusu weryfikacji (KYC) sprzedawcy u operatora. */
export const SellerKycStatusChanged = defineDomainEvent({
  type: 'SellerKycStatusChanged',
  version: 1,
  aggregateType: 'seller-account',
  payload: z.object({
    userId: z.uuid(),
    provider: z.string().min(1),
    status: z.enum(SELLER_STATUSES),
    previousStatus: z.enum(SELLER_STATUSES),
  }),
});

/** Zlecony zwrot płatności (wiersz `refunds` w PENDING); konsument wywołuje operatora. */
export const RefundRequested = defineDomainEvent({
  type: 'RefundRequested',
  version: 1,
  aggregateType: 'refund',
  payload: z.object({
    paymentId: z.uuid(),
    orderId: z.uuid(),
    amount: money,
    reason: z.enum(REFUND_REASONS),
  }),
});

/** Operator potwierdził zwrot; ledger ma już ORDER_REFUNDED (albo NOT_PICKED_UP_REFUNDED). */
export const RefundSucceeded = defineDomainEvent({
  type: 'RefundSucceeded',
  version: 1,
  aggregateType: 'refund',
  payload: z.object({
    paymentId: z.uuid(),
    orderId: z.uuid(),
    buyerId: z.uuid(),
    amount: money,
    reason: z.enum(REFUND_REASONS),
  }),
});

/**
 * Zlecone zwolnienie środków sprzedającego u operatora (F-26, wiersz `fund_releases` w PENDING).
 * Ledger zwolnił je już w transakcji zakończenia zamówienia; konsument wywołuje operatora.
 */
export const FundsReleaseRequested = defineDomainEvent({
  type: 'FundsReleaseRequested',
  version: 1,
  aggregateType: 'fund-release',
  payload: z.object({
    orderId: z.uuid(),
    paymentId: z.uuid(),
    amount: money,
  }),
});

/** Zlecona wypłata (wiersz `payouts` w PENDING, ledger: PAYOUT_REQUESTED); konsument woła operatora. */
export const PayoutRequested = defineDomainEvent({
  type: 'PayoutRequested',
  version: 1,
  aggregateType: 'payout',
  payload: z.object({
    sellerId: z.uuid(),
    amount: money,
    trigger: z.enum(PAYOUT_TRIGGERS),
  }),
});

/** Operator wysłał wypłatę na rachunek sprzedającego (ledger: PAYOUT_COMPLETED). */
export const PayoutPaid = defineDomainEvent({
  type: 'PayoutPaid',
  version: 1,
  aggregateType: 'payout',
  payload: z.object({
    sellerId: z.uuid(),
    amount: money,
    trigger: z.enum(PAYOUT_TRIGGERS),
    bankAccountMasked: z.string().min(1),
  }),
});

/** Wypłata nieudana: środki wróciły na saldo (ledger: PAYOUT_FAILED). */
export const PayoutFailed = defineDomainEvent({
  type: 'PayoutFailed',
  version: 1,
  aggregateType: 'payout',
  payload: z.object({
    sellerId: z.uuid(),
    amount: money,
    trigger: z.enum(PAYOUT_TRIGGERS),
    reason: z.enum(PAYOUT_FAILURE_REASONS),
  }),
});

/**
 * Zapisany rachunek do wypłat (F-27, §16.1): pierwszy albo zmiana numeru. Przy zmianie wypłaty są
 * wstrzymane do `payoutsBlockedUntil`; powiadomienie idzie w obu przypadkach.
 */
export const PayoutAccountChanged = defineDomainEvent({
  type: 'PayoutAccountChanged',
  version: 1,
  aggregateType: 'seller-payout-profile',
  payload: z.object({
    userId: z.uuid(),
    bankAccountMasked: z.string().min(1),
    first: z.boolean(),
    payoutsBlockedUntil: z.iso.datetime().nullable(),
  }),
});

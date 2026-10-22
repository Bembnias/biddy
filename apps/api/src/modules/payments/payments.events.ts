// Eventy domenowe modułu payments (F-23, PROJECT.md §14.3). Konsumenci: przejścia zamówienia po
// płatności (F-25, F-26: OrderPaid, anulowanie, zwrot spóźnionej płatności), powiadomienia
// i blokada wypłat do weryfikacji sprzedawcy (F-27, F-32).
import { CURRENCIES, type CurrencyCode } from '@biddy/shared';
import { z } from 'zod';

import { defineDomainEvent } from '../../infra/outbox/index.js';
import {
  PAYMENT_FAILURE_REASONS,
  PAYMENT_METHODS,
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

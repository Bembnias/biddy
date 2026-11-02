// Eventy domenowe modułu orders (F-16, F-25, PROJECT.md §14.3). Konsumenci: powiadomienia
// o wygranej i sprzedaży (F-20), powiadomienie „nadaj paczkę” (F-24), strike i druga szansa po
// anulowaniu (F-26).
import { CURRENCIES, type CurrencyCode } from '@biddy/shared';
import { z } from 'zod';

import { defineDomainEvent } from '../../infra/outbox/index.js';

const money = z.object({
  amount: z.int().nonnegative(),
  currency: z.enum(Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]]),
});

/** Zamówienie czeka na płatność zwycięzcy (aukcja zakończona albo Kup teraz). */
export const OrderCreated = defineDomainEvent({
  type: 'OrderCreated',
  version: 1,
  aggregateType: 'order',
  payload: z.object({
    publicId: z.string().min(1),
    auctionId: z.uuid(),
    buyerId: z.uuid(),
    sellerId: z.uuid(),
    itemsTotal: money,
    pokFee: money,
    total: money,
    paymentDueAt: z.iso.datetime(),
  }),
});

/**
 * Zamówienie opłacone: sprzedający ma nadać paczkę do `shipBy` (5 dni roboczych, §7.4).
 * Kontrakt z F-24 (konsument: powiadomienie „nadaj paczkę”); publikuje go checkout (F-25) po
 * konsumpcji PaymentSucceeded, w transakcji przejścia AWAITING_PAYMENT → PAID.
 */
export const OrderPaid = defineDomainEvent({
  type: 'OrderPaid',
  version: 1,
  aggregateType: 'order',
  payload: z.object({
    publicId: z.string().min(1),
    auctionId: z.uuid(),
    buyerId: z.uuid(),
    sellerId: z.uuid(),
    total: money,
    paidAt: z.iso.datetime(),
    shipBy: z.iso.datetime(),
  }),
});

/**
 * Zamówienie anulowane (F-25: nieopłacone w terminie). `paymentPending`: płatność była jeszcze
 * w toku, więc może przyjść później (wtedy zwracamy ją automatycznie i bez strike'a, §6.8).
 */
export const OrderCancelled = defineDomainEvent({
  type: 'OrderCancelled',
  version: 1,
  aggregateType: 'order',
  payload: z.object({
    publicId: z.string().min(1),
    auctionId: z.uuid(),
    buyerId: z.uuid(),
    sellerId: z.uuid(),
    reason: z.enum(['UNPAID']),
    paymentPending: z.boolean(),
    cancelledAt: z.iso.datetime(),
  }),
});

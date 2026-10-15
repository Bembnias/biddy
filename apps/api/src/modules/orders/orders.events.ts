// Eventy domenowe modułu orders (F-16, PROJECT.md §14.3). Konsumenci: powiadomienia o wygranej
// i sprzedaży (F-28), terminy płatności (F-26).
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

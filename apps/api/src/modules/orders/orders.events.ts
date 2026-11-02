// Eventy domenowe modułu orders (F-16, F-25, F-26, PROJECT.md §14.3). Konsumenci: powiadomienia
// na każdym etapie (F-20, F-24, F-26), historia zamówień i strike'i (F-61, F-26). Każdy event
// zamówienia niesie numer, aukcję i strony, żeby konsumenci nie czytali tabel zamówień.
import { CURRENCIES, type CurrencyCode } from '@biddy/shared';
import { z } from 'zod';

import { defineDomainEvent } from '../../infra/outbox/index.js';
import { SECOND_CHANCE_STATUSES } from './db/orders.schema.js';

const money = z.object({
  amount: z.int().nonnegative(),
  currency: z.enum(Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]]),
});

const parties = {
  publicId: z.string().min(1),
  auctionId: z.uuid(),
  buyerId: z.uuid(),
  sellerId: z.uuid(),
};

/**
 * Zamówienie czeka na płatność zwycięzcy (aukcja zakończona albo Kup teraz) albo licytującego,
 * który przyjął ofertę drugiej szansy (`secondChanceOfferId`, F-26).
 */
export const OrderCreated = defineDomainEvent({
  type: 'OrderCreated',
  version: 1,
  aggregateType: 'order',
  payload: z.object({
    ...parties,
    itemsTotal: money,
    pokFee: money,
    total: money,
    paymentDueAt: z.iso.datetime(),
    secondChanceOfferId: z.uuid().optional(),
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
    ...parties,
    total: money,
    paidAt: z.iso.datetime(),
    shipBy: z.iso.datetime(),
  }),
});

/**
 * Zamówienie anulowane: nieopłacone w terminie (F-25) albo nienadane w terminie (F-26, zwrot
 * zlecony w tej samej transakcji). `paymentPending`: płatność była jeszcze w toku, więc może
 * przyjść później (wtedy zwracamy ją automatycznie i bez strike'a, §6.8).
 */
export const OrderCancelled = defineDomainEvent({
  type: 'OrderCancelled',
  version: 1,
  aggregateType: 'order',
  payload: z.object({
    ...parties,
    reason: z.enum(['UNPAID', 'NOT_SHIPPED']),
    paymentPending: z.boolean(),
    cancelledAt: z.iso.datetime(),
  }),
});

/** Paczka u przewoźnika (pierwszy status trackingu): PAID → SHIPPED. */
export const OrderShipped = defineDomainEvent({
  type: 'OrderShipped',
  version: 1,
  aggregateType: 'order',
  payload: z.object({
    ...parties,
    shippedAt: z.iso.datetime(),
    carrierName: z.string().min(1),
    trackingNumber: z.string().min(1).nullable(),
  }),
});

/** Paczka odebrana: kupujący ma czas na sprawdzenie do `inspectionEndsAt` (36 h, §7.4). */
export const OrderDelivered = defineDomainEvent({
  type: 'OrderDelivered',
  version: 1,
  aggregateType: 'order',
  payload: z.object({
    ...parties,
    deliveredAt: z.iso.datetime(),
    inspectionEndsAt: z.iso.datetime(),
  }),
});

/** Zamówienie zakończone („Wszystko OK” albo upływ 36 h); ledger zwolnił już środki. */
export const OrderCompleted = defineDomainEvent({
  type: 'OrderCompleted',
  version: 1,
  aggregateType: 'order',
  payload: z.object({
    ...parties,
    completedAt: z.iso.datetime(),
    confirmedByBuyer: z.boolean(),
    itemsTotal: money,
  }),
});

/** Paczka nieodebrana wraca do sprzedającego; zwrot dla kupującego dopiero po RETURNED (§7.4). */
export const OrderNotPickedUp = defineDomainEvent({
  type: 'OrderNotPickedUp',
  version: 1,
  aggregateType: 'order',
  payload: z.object({
    ...parties,
    notPickedUpAt: z.iso.datetime(),
  }),
});

/** Kupujący zgłosił zaginięcie paczki: pełny zwrot, reklamacja i rekompensata (§7.9). */
export const OrderLost = defineDomainEvent({
  type: 'OrderLost',
  version: 1,
  aggregateType: 'order',
  payload: z.object({
    ...parties,
    lostAt: z.iso.datetime(),
    compensation: money,
    compensationDueAt: z.iso.datetime(),
  }),
});

/** Zwrot potwierdzony przez operatora: zamówienie zakończone bez sprzedaży (REFUNDED). */
export const OrderRefunded = defineDomainEvent({
  type: 'OrderRefunded',
  version: 1,
  aggregateType: 'order',
  payload: z.object({
    ...parties,
    refundedAt: z.iso.datetime(),
    amount: money,
    reason: z.enum(['NOT_SHIPPED', 'NOT_PICKED_UP', 'LOST']),
  }),
});

const offer = {
  auctionId: z.uuid(),
  sourceOrderId: z.uuid(),
  sellerId: z.uuid(),
  bidderId: z.uuid(),
  amount: money,
};

/** Oferta drugiej szansy wysłana licytującemu (ważna do `expiresAt`, §6.8). */
export const SecondChanceOffered = defineDomainEvent({
  type: 'SecondChanceOffered',
  version: 1,
  aggregateType: 'second-chance-offer',
  payload: z.object({ ...offer, expiresAt: z.iso.datetime() }),
});

/** Oferta przyjęta (z nowym zamówieniem), odrzucona albo wygasła. */
export const SecondChanceOfferResolved = defineDomainEvent({
  type: 'SecondChanceOfferResolved',
  version: 1,
  aggregateType: 'second-chance-offer',
  payload: z.object({
    ...offer,
    status: z.enum(SECOND_CHANCE_STATUSES).exclude(['PENDING']),
    orderPublicId: z.string().min(1).nullable(),
  }),
});

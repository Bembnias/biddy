// Eventy domenowe modułu shipping (F-24, PROJECT.md §14.3). Konsumenci: cykl zamówienia (F-26:
// nadanie, okno 36 h po odbiorze, NOT_PICKED_UP po zwrocie, zwrot środków po RETURNED),
// spory (F-28: przesyłka zwrotna) i księgowanie reklamacji (F-26, F-34). `orderId` jest null
// tylko dla przesyłki testowej FakeShipping (panel deweloperski).
import { CURRENCIES, type CurrencyCode } from '@biddy/shared';
import { z } from 'zod';

import { SHIPPING_PROVIDER_NAMES } from '../../infra/config/index.js';
import { defineDomainEvent } from '../../infra/outbox/index.js';
import {
  CARRIER_CLAIM_STATUSES,
  CARRIER_CLAIM_TYPES,
  RETURN_REASONS,
  SHIPMENT_DIRECTIONS,
  SHIPMENT_STATUSES,
} from './domain/shipping-values.js';

const money = z.object({
  amount: z.int().nonnegative(),
  currency: z.enum(Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]]),
});

/** Przesyłka utworzona u dostawcy po „Nadaj”: jest numer i kod nadania albo etykieta. */
export const ShipmentCreated = defineDomainEvent({
  type: 'ShipmentCreated',
  version: 1,
  aggregateType: 'shipment',
  payload: z.object({
    orderId: z.uuid().nullable(),
    direction: z.enum(SHIPMENT_DIRECTIONS),
    provider: z.enum(SHIPPING_PROVIDER_NAMES),
    carrierId: z.string().min(1),
    trackingNumber: z.string().min(1),
  }),
});

/**
 * Zmiana statusu z trackingu, jedna na każde przejście, w kolejności chronologicznej.
 * `occurredAt` to czas u przewoźnika, `detectedAt` to chwila, w której się o nim dowiedzieliśmy
 * (opóźniony webhook przesuwa start okna 36 h na korzyść kupującego, §7.4).
 */
export const ShipmentStatusChanged = defineDomainEvent({
  type: 'ShipmentStatusChanged',
  version: 1,
  aggregateType: 'shipment',
  payload: z.object({
    orderId: z.uuid().nullable(),
    direction: z.enum(SHIPMENT_DIRECTIONS),
    status: z.enum(SHIPMENT_STATUSES),
    previousStatus: z.enum(SHIPMENT_STATUSES),
    occurredAt: z.iso.datetime(),
    detectedAt: z.iso.datetime(),
    /** Tylko przy RETURNING: NOT_COLLECTED to paczka nieodebrana (§7.4). */
    returnReason: z.enum(RETURN_REASONS).nullable(),
  }),
});

/** Reklamacja u przewoźnika rozstrzygnięta (przyjęta z kwotą odzyskaną albo odrzucona, §8.4). */
export const CarrierClaimResolved = defineDomainEvent({
  type: 'CarrierClaimResolved',
  version: 1,
  aggregateType: 'carrier-claim',
  payload: z.object({
    shipmentId: z.uuid(),
    orderId: z.uuid().nullable(),
    type: z.enum(CARRIER_CLAIM_TYPES),
    status: z.enum(CARRIER_CLAIM_STATUSES),
    claimed: money,
    recovered: money,
  }),
});

// DTO przesyłek (F-24): widok przesyłki dla kupującego, sprzedającego i panelu deweloperskiego,
// opcje dostawy, punkty odbioru i body „Nadaj”. Kupujący nie widzi danych nadawcy, kodu nadania
// ani błędów utworzenia (to sprawy sprzedającego); dane nadawcy są i tak na etykiecie.
import { CURRENCIES, type CurrencyCode, PACKAGE_SIZES } from '@biddy/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { senderSchema } from '../application/shipment-party.js';
import type { ShipmentDetails } from '../application/shipment.service.js';
import { CARRIER_KINDS } from '../db/shipping.schema.js';
import { POINT_MAP_ENVS, type PointMap } from '../domain/point-map.js';
import type { ShippingOption } from '../domain/shipping-options.js';
import {
  DISPATCH_METHODS,
  SHIPMENT_DIRECTIONS,
  SHIPMENT_STATUSES,
} from '../domain/shipping-values.js';
import type { PickupPoint } from '../ports/shipping-provider.port.js';

const currency = z.enum(Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]]);
const grosze = z.int().nonnegative();
const timestamp = z.iso.datetime();

/** Mapa punktów (F-64): widżet Furgonetki z usługą i środowiskiem; null = wyszukiwarka. */
export const pointMapSchema = z
  .object({
    provider: z.literal('furgonetka'),
    service: z.string().min(1).describe('Kod usługi w mapie Furgonetki, np. inpost'),
    env: z.enum(POINT_MAP_ENVS),
  })
  .nullable()
  .describe('Mapa punktów odbioru; null: kurier albo dostawca punktów bez mapy');

export function pointMapDto(pointMap: PointMap | null | undefined): z.infer<typeof pointMapSchema> {
  return pointMap ?? null;
}

export class PickupPointDto extends createZodDto(
  z.object({
    id: z.string().min(1).describe('Identyfikator punktu u dostawcy (kod paczkomatu)'),
    name: z.string().min(1),
    address: z.string().describe('Adres jednym tekstem'),
    location: z.object({ lat: z.number(), lng: z.number() }).nullable(),
    distanceMeters: z.int().nonnegative().nullable(),
    openingHours: z.string().min(1).nullable().describe('Np. „24/7” albo „pn–pt 8:00–20:00”'),
  }),
) {}

export class ShippingOptionDto extends createZodDto(
  z.object({
    carrierId: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(CARRIER_KINDS),
    price: grosze.describe('Cena dostawy dla kupującego w groszach (cennik Biddy)'),
    currency,
    requiresPickupPoint: z.boolean().describe('Paczkomat i punkt: wybór punktu; kurier: adres'),
    pointMap: pointMapSchema,
  }),
) {}

const shipmentEvent = z.object({
  status: z.enum(SHIPMENT_STATUSES),
  description: z.string().min(1).nullable().describe('Opis przewoźnika'),
  occurredAt: timestamp,
});

export class ShipmentDto extends createZodDto(
  z.object({
    id: z.uuid(),
    direction: z.enum(SHIPMENT_DIRECTIONS),
    status: z.enum(SHIPMENT_STATUSES),
    carrier: z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      kind: z.enum(CARRIER_KINDS),
    }),
    packageSize: z.enum(PACKAGE_SIZES),
    pickupPoint: z
      .object({ id: z.string().min(1), name: z.string().min(1), address: z.string() })
      .nullable(),
    recipient: z.object({
      name: z.string().min(1),
      city: z.string().min(1).nullable().describe('Miejscowość (kurier); null dla punktu odbioru'),
    }),
    sender: senderSchema
      .nullable()
      .describe('Dane nadawcy (tylko sprzedający); null przed „Nadaj”'),
    dispatchMethod: z.enum(DISPATCH_METHODS).nullable(),
    dispatchMethods: z
      .array(z.enum(DISPATCH_METHODS))
      .describe('Sposoby nadania dostępne dla tej przesyłki'),
    currency,
    price: grosze.describe('Cena dostawy zapłacona przez kupującego'),
    trackingNumber: z.string().min(1).nullable(),
    dropoffCode: z
      .string()
      .min(1)
      .nullable()
      .describe('Kod nadania w paczkomacie lub punkcie (tylko sprzedający)'),
    labelAvailable: z.boolean().describe('Etykieta PDF gotowa do pobrania'),
    lastError: z
      .string()
      .min(1)
      .nullable()
      .describe('Ostatni błąd utworzenia u przewoźnika (tylko sprzedający)'),
    events: z.array(shipmentEvent),
    requestedAt: timestamp.nullable(),
    deliveredAt: timestamp.nullable(),
    createdAt: timestamp,
  }),
) {}

export class DispatchShipmentBody extends createZodDto(
  z.object({
    sender: senderSchema.describe('Nadawca: imię i nazwisko, telefon, adres (dane na etykiecie)'),
    dispatchMethod: z
      .enum(DISPATCH_METHODS)
      .describe('Nadanie w punkcie albo odbiór przez kuriera'),
  }),
) {}

/** Kto ogląda przesyłkę: sprzedający (i panel) widzi wszystko, kupujący bez danych nadawcy. */
export type ShipmentViewer = 'SELLER' | 'BUYER';

export function shipmentDto(details: ShipmentDetails, viewer: ShipmentViewer): ShipmentDto {
  const { shipment } = details;
  const seller = viewer === 'SELLER';
  const sender = shipment.sender;
  return {
    id: shipment.id,
    direction: shipment.direction,
    status: shipment.status,
    carrier: details.carrier,
    packageSize: shipment.packageSize,
    pickupPoint: shipment.pickupPoint,
    recipient: {
      name: shipment.recipient.name,
      city: shipment.recipient.address?.city ?? null,
    },
    sender:
      seller && sender?.address !== null && sender?.address !== undefined
        ? {
            name: sender.name,
            phone: sender.phone,
            email: sender.email,
            address: {
              street: sender.address.street,
              postalCode: sender.address.postalCode,
              city: sender.address.city,
            },
          }
        : null,
    dispatchMethod: shipment.dispatchMethod,
    dispatchMethods: [...details.dispatchMethods],
    currency: shipment.currency,
    price: shipment.price,
    trackingNumber: shipment.trackingNumber,
    dropoffCode: seller ? shipment.dropoffCode : null,
    labelAvailable: seller && shipment.labelKey !== null,
    lastError: seller ? shipment.lastError : null,
    events: details.events.map((event) => ({
      status: event.status,
      description: event.description === '' ? null : event.description,
      occurredAt: event.occurredAt.toISOString(),
    })),
    requestedAt: shipment.requestedAt?.toISOString() ?? null,
    deliveredAt: shipment.deliveredAt?.toISOString() ?? null,
    createdAt: shipment.createdAt.toISOString(),
  };
}

export function shippingOptionDto(
  option: ShippingOption,
  currencyCode: CurrencyCode,
): ShippingOptionDto {
  return {
    carrierId: option.carrierId,
    name: option.name,
    kind: option.kind,
    price: option.price,
    currency: currencyCode,
    requiresPickupPoint: option.requiresPickupPoint,
    pointMap: pointMapDto(option.pointMap),
  };
}

export function pickupPointDto(point: PickupPoint): PickupPointDto {
  return {
    id: point.id,
    name: point.name,
    address: point.address,
    location: point.location,
    distanceMeters: point.distanceMeters,
    openingHours: point.openingHours,
  };
}

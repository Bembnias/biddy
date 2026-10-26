// Tabele FakeShipping (F-24, PROJECT.md §8): stan symulowanego dostawcy przesyłek. Należą do
// adaptera testowego (adapters/fake), nie do domeny: domena widzi go wyłącznie przez port
// ShippingProvider. Są w Postgresie, bo przesyłkę tworzy worker, statusy dodaje automat
// w workerze albo panel w API, a webhooki wysyła worker. Na produkcji tabele zostają puste.
//
// Plik nie zależy od NestJS: czyta go też drizzle-kit (drizzle.config.ts).
import type { CurrencyCode } from '@biddy/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { idColumn } from '../../../infra/db/ids.js';
import type { CarrierKind } from './shipping.schema.js';
import { sqlList } from '../domain/shipping-values.js';

/**
 * Statusy FakeShipping w „notacji dostawcy”: celowo inne niż nasze, żeby testy kontraktowe
 * sprawdzały mapowanie. `return_expired` to zwrot po terminie odbioru.
 */
export const FAKE_PARCEL_STATUSES = [
  'confirmed',
  'posted',
  'in_transit',
  'out_for_delivery',
  'awaiting_pickup',
  'delivered',
  'exception',
  'return_expired',
  'returning',
  'returned',
  'cancelled',
] as const;
export type FakeParcelStatus = (typeof FAKE_PARCEL_STATUSES)[number];

/** Jak automat FakeShipping prowadzi przesyłkę (panel albo magiczny punkt odbioru). */
export const FAKE_SHIPPING_SCENARIOS = [
  /** Doręczona: nadana, w drodze, w punkcie albo u kuriera, odebrana. */
  'DELIVERED',
  /** Nieodebrana: w punkcie, termin odbioru minął, zwrot do nadawcy, zwrócona. */
  'NOT_PICKED_UP',
  /** Zagubiona: utyka „w drodze”. */
  'LOST',
  /** Bez automatu: statusy tylko z panelu. */
  'MANUAL',
] as const;
export type FakeShippingScenario = (typeof FAKE_SHIPPING_SCENARIOS)[number];

/** Dane przesyłki w FakeShipping (do etykiety). */
export interface FakeParcelRequest {
  readonly carrier: string;
  /** Rodzaj usługi: automat prowadzi paczkomat i punkt przez odbiór, kuriera przez doręczenie. */
  readonly kind: CarrierKind;
  readonly reference: string | null;
  readonly sender: { readonly name: string; readonly phone: string; readonly address: string };
  readonly recipient: {
    readonly name: string;
    readonly phone: string;
    readonly destination: string;
  };
  readonly dispatchMethod: string;
}

export const fakeShippingParcels = pgTable(
  'fake_shipping_parcels',
  {
    /** ID u dostawcy, np. `fsp_0199…`. */
    id: text().primaryKey(),
    idempotencyKey: text().notNull(),
    /** Odcisk żądania: ten sam klucz z innymi danymi to błąd (jak u prawdziwego dostawcy). */
    requestHash: text().notNull(),
    carrierId: text().notNull(),
    trackingNumber: text().notNull(),
    dropoffCode: text(),
    pickupPointId: text(),
    scenario: text().$type<FakeShippingScenario>().notNull(),
    status: text().$type<FakeParcelStatus>().notNull(),
    request: jsonb().$type<FakeParcelRequest>().notNull(),
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    cost: bigint({ mode: 'number' }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('fake_shipping_parcels_idempotency_key').on(table.idempotencyKey),
    uniqueIndex('fake_shipping_parcels_tracking_number_key').on(table.trackingNumber),
    index().on(table.createdAt),
    check(
      'fake_shipping_parcels_status_check',
      sql.raw(`status in (${sqlList(FAKE_PARCEL_STATUSES)})`),
    ),
    check(
      'fake_shipping_parcels_scenario_check',
      sql.raw(`scenario in (${sqlList(FAKE_SHIPPING_SCENARIOS)})`),
    ),
  ],
);

export type FakeShippingParcelRow = typeof fakeShippingParcels.$inferSelect;

/** Historia statusów u dostawcy (tracking, który zwraca getTracking). */
export const fakeShippingTracking = pgTable(
  'fake_shipping_tracking',
  {
    id: idColumn(),
    parcelId: text()
      .notNull()
      .references(() => fakeShippingParcels.id),
    status: text().$type<FakeParcelStatus>().notNull(),
    description: text().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    index().on(table.parcelId, table.occurredAt),
    check(
      'fake_shipping_tracking_status_check',
      sql.raw(`status in (${sqlList(FAKE_PARCEL_STATUSES)})`),
    ),
  ],
);

export type FakeShippingTrackingRow = typeof fakeShippingTracking.$inferSelect;

/** Webhooki FakeShipping ze stanem dostarczenia (panel deweloperski). */
export const fakeShippingWebhooks = pgTable(
  'fake_shipping_webhooks',
  {
    /** ID zdarzenia w notacji dostawcy, np. `fsw_0199…`. */
    id: text().primaryKey(),
    parcelId: text()
      .notNull()
      .references(() => fakeShippingParcels.id),
    attempts: integer().notNull().default(0),
    lastError: text(),
    deliveredAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index().on(table.parcelId)],
);

export type FakeShippingWebhookRow = typeof fakeShippingWebhooks.$inferSelect;

// Tabele modułu shipping: przewoźnicy i ich usługi (F-14), cennik dostaw Biddy, przesyłki
// z historią trackingu, reklamacje u przewoźników i tokeny Furgonetki (F-24, PROJECT.md §8,
// §13.3). Mapowanie „gabaryt → przewoźnicy” to konfiguracja w bazie, nie stała w kodzie (§8.2).
// Tabele FakeShipping są w fake-shipping.schema.ts.
//
// Plik nie zależy od NestJS: czyta go też drizzle-kit (drizzle.config.ts). Ograniczenie
// wykluczające nakładanie się okresów cennika jest w migracji 0017_shipping (Drizzle go nie
// opisuje).
import type { CurrencyCode, PackageSize } from '@biddy/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { ShippingProviderName } from '../../../infra/config/config.js';
import { idColumn } from '../../../infra/db/ids.js';
import {
  CARRIER_CLAIM_STATUSES,
  CARRIER_CLAIM_TYPES,
  type CarrierClaimStatus,
  type CarrierClaimType,
  DISPATCH_METHODS,
  type DispatchMethod,
  SHIPMENT_DIRECTIONS,
  SHIPMENT_STATUSES,
  type ShipmentDirection,
  type ShipmentStatus,
  sqlList,
} from '../domain/shipping-values.js';

/** Sposób odbioru: paczkomat, punkt odbioru albo kurier pod adres. */
export const CARRIER_KINDS = ['LOCKER', 'PICKUP_POINT', 'COURIER'] as const;
export type CarrierKind = (typeof CARRIER_KINDS)[number];

const money = () => bigint({ mode: 'number' });

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const shippingCarriers = pgTable(
  'shipping_carriers',
  {
    /** Stały identyfikator usługi, np. `inpost-paczkomat` (zapisywany w przedmiocie). */
    id: text().primaryKey(),
    name: text().notNull(),
    kind: text().$type<CarrierKind>().notNull(),
    /** Obsługiwane gabaryty (S, M, L, XL). */
    packageSizes: text().array().$type<PackageSize[]>().notNull(),
    /** Sposoby nadania dostępne w tej usłudze (F-24). */
    dispatchMethods: text()
      .array()
      .$type<DispatchMethod[]>()
      .notNull()
      .default(sql`'{DROP_OFF}'::text[]`),
    /** Limity gabarytu XL (null: bez limitu). Obwód = najdłuższy bok + 2 × pozostałe. */
    maxWeightGrams: integer(),
    maxLengthCm: integer(),
    maxGirthCm: integer(),
    /** Kod usługi u dostawców, np. `{"furgonetka": "inpost"}`. */
    providerCodes: jsonb()
      .$type<Partial<Record<ShippingProviderName, string>>>()
      .notNull()
      .default({}),
    position: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
  },
  (table) => [
    check(
      'shipping_carriers_kind_check',
      sql`${table.kind} in ('LOCKER', 'PICKUP_POINT', 'COURIER')`,
    ),
    check(
      'shipping_carriers_package_sizes_check',
      sql`${table.packageSizes} <@ array['S', 'M', 'L', 'XL']::text[] and cardinality(${table.packageSizes}) > 0`,
    ),
    check(
      'shipping_carriers_dispatch_methods_check',
      sql.raw(
        `dispatch_methods <@ array[${sqlList(DISPATCH_METHODS)}]::text[] and cardinality(dispatch_methods) > 0`,
      ),
    ),
    check(
      'shipping_carriers_limits_check',
      sql`coalesce(${table.maxWeightGrams}, 1) > 0 and coalesce(${table.maxLengthCm}, 1) > 0 and coalesce(${table.maxGirthCm}, 1) > 0`,
    ),
  ],
);

export type ShippingCarrier = typeof shippingCarriers.$inferSelect;

/**
 * Cennik dostaw Biddy (F-24): cena brutto dla kupującego per usługa, gabaryt i waluta
 * w okresie `[valid_from, valid_to)`. W każdej chwili obowiązuje najwyżej jedna cena dla
 * usługi, gabarytu i waluty (ograniczenie wykluczające w migracji). Przesyłka pamięta cenę.
 */
export const shippingRates = pgTable(
  'shipping_rates',
  {
    id: idColumn(),
    carrierId: text()
      .notNull()
      .references(() => shippingCarriers.id),
    packageSize: text().$type<PackageSize>().notNull(),
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    price: money().notNull(),
    validFrom: timestamp({ withTimezone: true }).notNull(),
    validTo: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('shipping_rates_price_check', sql`${table.price} > 0`),
    check('shipping_rates_package_size_check', sql`${table.packageSize} in ('S', 'M', 'L', 'XL')`),
    check(
      'shipping_rates_valid_range_check',
      sql`${table.validTo} is null or ${table.validTo} > ${table.validFrom}`,
    ),
  ],
);

export type ShippingRate = typeof shippingRates.$inferSelect;

/** Paczka ze snapshotu przedmiotu: waga i wymiary (null, gdy sprzedający ich nie podał). */
export interface ParcelData {
  readonly weightGrams: number | null;
  readonly dimensionsCm: {
    readonly length: number;
    readonly width: number;
    readonly height: number;
  } | null;
}

/** Adres w Polsce (nadawcy albo odbiorcy kurierskiego). */
export interface PostalAddress {
  readonly street: string;
  readonly postalCode: string;
  readonly city: string;
  readonly countryCode: 'PL';
}

/** Strona przesyłki: osoba z kontaktem, adres tylko gdy potrzebny (kurier, nadawca). */
export interface ShipmentParty {
  readonly name: string;
  readonly phone: string;
  readonly email: string | null;
  readonly address: PostalAddress | null;
}

/** Punkt odbioru zapamiętany przy wyborze (do wyświetlania bez pytania dostawcy). */
export interface PickupPointSnapshot {
  readonly id: string;
  readonly name: string;
  readonly address: string;
}

/**
 * Przesyłka (F-24, §8.3): wybór kupującego (`PENDING`), „Nadaj” sprzedającego (`REQUESTED`),
 * utworzenie u dostawcy (`CREATED`) i statusy trackingu. Jedna aktywna przesyłka na zamówienie
 * i kierunek. `id` z numerem próby to klucz idempotencji u dostawcy.
 */
export const shipments = pgTable(
  'shipments',
  {
    id: idColumn(),
    /** Zamówienie (moduł orders; uuid bez FK). Null tylko dla przesyłki testowej FakeShipping. */
    orderId: uuid(),
    direction: text().$type<ShipmentDirection>().notNull(),
    provider: text().$type<ShippingProviderName>().notNull(),
    carrierId: text()
      .notNull()
      .references(() => shippingCarriers.id),
    packageSize: text().$type<PackageSize>().notNull(),
    parcel: jsonb().$type<ParcelData>().notNull(),
    pickupPoint: jsonb().$type<PickupPointSnapshot>(),
    recipient: jsonb().$type<ShipmentParty>().notNull(),
    /** Dane nadawcy z „Nadaj” (są na etykiecie). */
    sender: jsonb().$type<ShipmentParty>(),
    dispatchMethod: text().$type<DispatchMethod>(),
    /** Wartość zawartości dla przewoźnika (cena przedmiotu, w walucie przesyłki). */
    declaredValue: money(),
    /** Numer zamówienia na etykiecie (null dla przesyłki testowej). */
    reference: text(),
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    /** Cena dla kupującego z cennika Biddy. */
    price: money().notNull(),
    /** Koszt u dostawcy (null, gdy go nie podał). */
    cost: money(),
    status: text().$type<ShipmentStatus>().notNull().default('PENDING'),
    /** Czas zdarzenia, które ustawiło status (u dostawcy albo w Biddy). */
    statusChangedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    providerShipmentId: text(),
    trackingNumber: text(),
    /** Kod nadania w paczkomacie lub punkcie (bez drukowania etykiety). */
    dropoffCode: text(),
    /** Klucz etykiety PDF w prywatnym kubełku. */
    labelKey: text(),
    /** Numer próby utworzenia u dostawcy (nowa próba = nowy klucz idempotencji). */
    dispatchAttempts: smallint().notNull().default(0),
    /** Ostatni błąd utworzenia do pokazania sprzedającemu. */
    lastError: text(),
    requestedAt: timestamp({ withTimezone: true }),
    deliveredAt: timestamp({ withTimezone: true }),
    returnedAt: timestamp({ withTimezone: true }),
    cancelledAt: timestamp({ withTimezone: true }),
    polledAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('shipments_provider_shipment_id_key').on(table.provider, table.providerShipmentId),
    uniqueIndex('shipments_active_order_direction_key')
      .on(table.orderId, table.direction)
      .where(sql`${table.status} <> 'CANCELLED'`),
    index().on(table.status, table.polledAt),
    check('shipments_status_check', sql.raw(`status in (${sqlList(SHIPMENT_STATUSES)})`)),
    check('shipments_direction_check', sql.raw(`direction in (${sqlList(SHIPMENT_DIRECTIONS)})`)),
    check(
      'shipments_dispatch_method_check',
      sql.raw(`dispatch_method is null or dispatch_method in (${sqlList(DISPATCH_METHODS)})`),
    ),
    check('shipments_order_check', sql`${table.orderId} is not null or ${table.provider} = 'fake'`),
    check(
      'shipments_amounts_check',
      sql`${table.price} >= 0 and (${table.cost} is null or ${table.cost} >= 0)`,
    ),
  ],
);

export type ShipmentRow = typeof shipments.$inferSelect;

/**
 * Historia trackingu. Te same zdarzenia przychodzą z webhooka i pollingu, więc wpis jest
 * unikalny po (przesyłka, status dostawcy, czas zdarzenia).
 */
export const shipmentEvents = pgTable(
  'shipment_events',
  {
    id: idColumn(),
    shipmentId: uuid()
      .notNull()
      .references(() => shipments.id),
    /** Status w notacji dostawcy. */
    rawStatus: text().notNull(),
    status: text().$type<ShipmentStatus>().notNull(),
    /** Opis przewoźnika do pokazania (nie do logiki). */
    description: text(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    recordedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('shipment_events_dedupe_key').on(
      table.shipmentId,
      table.rawStatus,
      table.occurredAt,
    ),
    check('shipment_events_status_check', sql.raw(`status in (${sqlList(SHIPMENT_STATUSES)})`)),
  ],
);

export type ShipmentEventRow = typeof shipmentEvents.$inferSelect;

/** Reklamacja u przewoźnika (§8.4): najwyżej jedna na przesyłkę. */
export const carrierClaims = pgTable(
  'carrier_claims',
  {
    id: idColumn(),
    shipmentId: uuid()
      .notNull()
      .references(() => shipments.id),
    type: text().$type<CarrierClaimType>().notNull(),
    status: text().$type<CarrierClaimStatus>().notNull().default('OPEN'),
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    claimedAmount: money().notNull(),
    /** Kwota odzyskana od przewoźnika (przy rozstrzygnięciu). */
    recoveredAmount: money(),
    /** Numer reklamacji u przewoźnika. */
    providerClaimRef: text(),
    note: text(),
    submittedAt: timestamp({ withTimezone: true }),
    resolvedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('carrier_claims_shipment_id_key').on(table.shipmentId),
    check('carrier_claims_type_check', sql.raw(`type in (${sqlList(CARRIER_CLAIM_TYPES)})`)),
    check('carrier_claims_status_check', sql.raw(`status in (${sqlList(CARRIER_CLAIM_STATUSES)})`)),
    check(
      'carrier_claims_amounts_check',
      sql`${table.claimedAmount} > 0 and (${table.recoveredAmount} is null or ${table.recoveredAmount} between 0 and ${table.claimedAmount})`,
    ),
    check(
      'carrier_claims_resolution_check',
      sql`(${table.status} in ('ACCEPTED', 'REJECTED')) = (${table.resolvedAt} is not null and ${table.recoveredAmount} is not null)`,
    ),
  ],
);

export type CarrierClaimRow = typeof carrierClaims.$inferSelect;

/**
 * Tokeny OAuth Furgonetki (jeden wiersz). Refresh token jest jednorazowy, więc API i worker
 * odświeżają go pod blokadą tego wiersza. Wartości są zaszyfrowane (AES-256-GCM).
 */
export const furgonetkaTokens = pgTable(
  'furgonetka_tokens',
  {
    id: smallint().primaryKey().default(1),
    accessToken: bytea().notNull(),
    refreshToken: bytea(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('furgonetka_tokens_single_row_check', sql`${table.id} = 1`)],
);

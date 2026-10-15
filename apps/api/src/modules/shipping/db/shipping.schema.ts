// Tabele modułu shipping: przewoźnicy i ich usługi (F-14). Wyceny, przesyłki i tracking dojdą
// w F-24. Mapowanie „gabaryt → przewoźnicy” to konfiguracja w bazie, nie stała w kodzie (§8.2).
//
// Plik nie zależy od NestJS: czyta go też drizzle-kit (drizzle.config.ts).
import type { PackageSize } from '@biddy/shared';
import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, text } from 'drizzle-orm/pg-core';

/** Sposób odbioru: paczkomat, punkt odbioru albo kurier pod adres. */
export const CARRIER_KINDS = ['LOCKER', 'PICKUP_POINT', 'COURIER'] as const;
export type CarrierKind = (typeof CARRIER_KINDS)[number];

export const shippingCarriers = pgTable(
  'shipping_carriers',
  {
    /** Stały identyfikator usługi, np. `inpost-paczkomat` (zapisywany w przedmiocie). */
    id: text().primaryKey(),
    name: text().notNull(),
    kind: text().$type<CarrierKind>().notNull(),
    /** Obsługiwane gabaryty (S, M, L, XL). */
    packageSizes: text().array().$type<PackageSize[]>().notNull(),
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
  ],
);

export type ShippingCarrier = typeof shippingCarriers.$inferSelect;

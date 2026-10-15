// Tabele modułu catalog: drzewo kategorii z atrybutami (F-11) i przedmioty ze zdjęciami (F-14).
// ID to UUIDv7 nadawane przez aplikację (ADR-10).
//
// Plik nie zależy od NestJS: czyta go też drizzle-kit (drizzle.config.ts).
import type { AttributeDefinition, ItemCondition, PackageSize } from '@biddy/shared';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { idColumn } from '../../../infra/db/ids.js';

/** Ścieżka w drzewie (rozszerzenie ltree), np. `kolekcjonerstwo.karty-kolekcjonerskie`. */
const ltree = customType<{ data: string }>({ dataType: () => 'ltree' });

export const categories = pgTable(
  'categories',
  {
    id: idColumn(),
    parentId: uuid().references((): AnyPgColumn => categories.id),
    /** Slugi od korzenia rozdzielone kropkami (etykiety ltree; myślnik od PostgreSQL 16). */
    path: ltree().notNull(),
    /** Globalnie unikalny slug (adres strony kategorii, F-18). */
    slug: text().notNull(),
    name: text().notNull(),
    /** Kolejność wśród rodzeństwa. */
    position: integer().notNull().default(0),
    /** Własne atrybuty kategorii (definicje z @biddy/shared); obowiązują też dziedziczone. */
    attributes: jsonb().$type<AttributeDefinition[]>().notNull().default([]),
    /** Oferty przechodzą moderację przed publikacją (F-35); zasady w listingNotice. */
    isRestricted: boolean().notNull().default(false),
    /** Kategoria narażona na podróbki: więcej zdjęć, w tym metek i kodów (F-14). */
    isBrandSensitive: boolean().notNull().default(false),
    /** Zasady wystawiania pokazywane w kreatorze. */
    listingNotice: text(),
    isActive: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('categories_slug_key').on(table.slug),
    uniqueIndex('categories_path_key').on(table.path),
    index('categories_path_gist').using('gist', table.path),
    index().on(table.parentId, table.position),
  ],
);

export type Category = typeof categories.$inferSelect;

/** Format slugów i etykiet ścieżki. */
export const CATEGORY_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * Przedmiot na aukcji (F-14). W szkicu pola są puste; kompletność sprawdza publikacja
 * (`validateListing` z @biddy/shared). Aukcja (moduł auctions) wskazuje przedmiot przez `item_id`.
 */
export const items = pgTable(
  'items',
  {
    id: idColumn(),
    /** Sprzedający (konto z modułu identity; uuid bez FK między modułami). */
    sellerId: uuid().notNull(),
    /** Liść drzewa kategorii (null w szkicu). */
    categoryId: uuid().references(() => categories.id),
    title: text(),
    description: text(),
    condition: text().$type<ItemCondition>(),
    brand: text(),
    /** Wartości atrybutów kategorii (zapisane tak, jak je podano; F-11). */
    attributes: jsonb().$type<Record<string, string | number | boolean>>().notNull().default({}),
    packageSize: text().$type<PackageSize>(),
    weightGrams: integer(),
    lengthCm: integer(),
    widthCm: integer(),
    heightCm: integer(),
    /** Akceptowani przewoźnicy (identyfikatory z modułu shipping). */
    allowedCarriers: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index().on(table.sellerId),
    check(
      'items_condition_check',
      sql`${table.condition} is null or ${table.condition} in ('NEW', 'LIKE_NEW', 'VERY_GOOD', 'GOOD', 'FAIR', 'FOR_PARTS')`,
    ),
    check(
      'items_package_size_check',
      sql`${table.packageSize} is null or ${table.packageSize} in ('S', 'M', 'L', 'XL')`,
    ),
  ],
);

export type Item = typeof items.$inferSelect;

/** Zdjęcia przedmiotu w kolejności (pozycja 0 = zdjęcie główne). Plik i stan: moduł media. */
export const itemMedia = pgTable(
  'item_media',
  {
    itemId: uuid()
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    /** Zdjęcie z modułu media (uuid bez FK między modułami). */
    mediaId: uuid().notNull(),
    position: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.itemId, table.position] }),
    uniqueIndex().on(table.itemId, table.mediaId),
  ],
);

// Tabele modułu catalog: drzewo kategorii z atrybutami (F-11); przedmioty dojdą w F-14.
// ID to UUIDv7 nadawane przez aplikację (ADR-10).
//
// Plik nie zależy od NestJS: czyta go też drizzle-kit (drizzle.config.ts).
import type { AttributeDefinition } from '@biddy/shared';
import {
  type AnyPgColumn,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
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

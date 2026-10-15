// Tabele modułu payments: cenniki POK (F-13); płatności, zwroty i wypłaty dojdą w kolejnych
// feature'ach (PROJECT.md §7.8). ID to UUIDv7 nadawane przez aplikację (ADR-10).
//
// Plik nie zależy od NestJS: czyta go też drizzle-kit (drizzle.config.ts). Ograniczenie
// wykluczające nakładanie się okresów i trigger niezmienności są w migracji 0008_fee_schedules
// (Drizzle ich nie opisuje).
import type { CurrencyCode, FeeTier } from '@biddy/shared';
import { sql } from 'drizzle-orm';
import { bigint, char, check, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { idColumn } from '../../../infra/db/ids.js';

/**
 * Wersje cennika POK (§3.1). Wiersz jest niezmienny: wolno tylko zamknąć otwarty cennik
 * (`valid_to`), bo zamówienia pamiętają `fee_schedule_id` i muszą dać się przeliczyć tak samo.
 * W danej walucie w każdej chwili obowiązuje dokładnie jeden cennik: `[valid_from, valid_to)`.
 */
export const feeSchedules = pgTable(
  'fee_schedules',
  {
    id: idColumn(),
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    /** Opłata stała w groszach (raz na zamówienie). */
    fixedFee: bigint({ mode: 'number' }).notNull(),
    /** Progi krańcowe (`feeScheduleSchema` z @biddy/shared), np. `[{"upTo":100000,"bp":700},…]`. */
    tiers: jsonb().$type<FeeTier[]>().notNull(),
    /** Stawka VAT od POK w punktach bazowych (2300 = 23%). */
    vatRateBp: integer().notNull(),
    validFrom: timestamp({ withTimezone: true }).notNull(),
    /** Koniec obowiązywania (wyłącznie); null = cennik bieżący bez końca. */
    validTo: timestamp({ withTimezone: true }),
    /** Opis zmiany, np. „Startowy cennik (PROJECT.md §3.1)”. */
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('fee_schedules_fixed_fee_check', sql`${table.fixedFee} >= 0`),
    check('fee_schedules_vat_rate_bp_check', sql`${table.vatRateBp} between 0 and 10000`),
    check(
      'fee_schedules_valid_range_check',
      sql`${table.validTo} is null or ${table.validTo} > ${table.validFrom}`,
    ),
    check(
      'fee_schedules_tiers_check',
      sql`jsonb_typeof(${table.tiers}) = 'array' and jsonb_array_length(${table.tiers}) > 0`,
    ),
  ],
);

export type FeeScheduleRow = typeof feeSchedules.$inferSelect;

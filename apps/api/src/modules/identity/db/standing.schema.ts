// Tabele stanu konta (F-61, PROJECT.md §4.1, §13.3): historia zamówień do poziomów, strike'i,
// blokady i wersje polityki kont. Moduł identity nie czyta tabel `orders`; historię dopisują
// konsumenci w module orders przez publiczne API (TradeHistoryService).
//
// Plik nie zależy od NestJS: czyta go też drizzle-kit (drizzle.config.ts).
import {
  ACCOUNT_BLOCK_CAUSES,
  ACCOUNT_BLOCK_KINDS,
  type AccountBlockCause,
  type AccountBlockKind,
  type AccountPolicy,
  APPEAL_STATUSES,
  type AppealStatus,
  STRIKE_REASONS,
  STRIKE_ROLES,
  type StrikeReason,
  type StrikeRole,
} from '@biddy/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { idColumn } from '../../../infra/db/ids.js';
import { users } from './identity.schema.js';

/** Lista do ograniczeń CHECK: `'A', 'B'`. */
function sqlList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

const userRef = () =>
  uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

/**
 * Historia zamówień użytkownika do poziomów §4.1: jeden wiersz na zamówienie (moduł orders,
 * uuid bez FK). Zapisy są idempotentne (upsert po `order_id`).
 */
export const tradeRecords = pgTable(
  'trade_records',
  {
    orderId: uuid().primaryKey(),
    buyerId: userRef(),
    sellerId: userRef(),
    paidAt: timestamp({ withTimezone: true }),
    /** Zamówienie zakończone (F-26). */
    completedAt: timestamp({ withTimezone: true }),
    /** Spór przegrany przez sprzedającego (F-28). */
    sellerDisputeLostAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index().on(table.buyerId), index().on(table.sellerId)],
);

const appealColumns = () => ({
  appealStatus: text().$type<AppealStatus>().notNull().default('NONE'),
  appealMessage: text(),
  appealedAt: timestamp({ withTimezone: true }),
  appealResolvedAt: timestamp({ withTimezone: true }),
  /** Personel, który rozpatrzył odwołanie (uuid użytkownika). */
  appealResolvedBy: uuid(),
  /** Uzasadnienie decyzji w odwołaniu (widoczne dla użytkownika). */
  appealNote: text(),
});

/**
 * Strike'i (§4.1). Do progu blokady liczą się niecofnięte z ostatnich 90 dni (okno z polityki),
 * nie licznik. `source_key` (np. `UNPAID:{orderId}`) sprawia, że ponowione zdarzenie nie da
 * drugiego strike'a; ręczne strike'i personelu mają null.
 */
export const strikes = pgTable(
  'strikes',
  {
    id: idColumn(),
    userId: userRef(),
    role: text().$type<StrikeRole>().notNull(),
    reason: text().$type<StrikeReason>().notNull(),
    sourceKey: text(),
    /** Zamówienie (moduł orders) albo aukcja (moduł auctions); uuid bez FK. */
    orderId: uuid(),
    auctionId: uuid(),
    /** Personel, który nadał strike; null = system. */
    issuedBy: uuid(),
    /** Uzasadnienie dla użytkownika (statement of reasons, DSA). */
    statement: text().notNull(),
    /** Notatka wewnętrzna personelu (nie trafia do /me). */
    note: text(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    /** Personel, który cofnął strike; null przy cofnięciu przez system. */
    revokedBy: uuid(),
    /** Uzasadnienie cofnięcia (widoczne dla użytkownika). */
    revokeNote: text(),
    ...appealColumns(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('strikes_source_key').on(table.sourceKey),
    index().on(table.userId, table.role, table.createdAt),
    index('strikes_pending_appeals')
      .on(table.appealedAt)
      .where(sql`${table.appealStatus} = 'PENDING'`),
    check('strikes_role_check', sql.raw(`role in (${sqlList(STRIKE_ROLES)})`)),
    check('strikes_reason_check', sql.raw(`reason in (${sqlList(STRIKE_REASONS)})`)),
    check('strikes_appeal_status_check', sql.raw(`appeal_status in (${sqlList(APPEAL_STATUSES)})`)),
  ],
);

export type StrikeRow = typeof strikes.$inferSelect;

/**
 * Blokady kont (§4.1): licytowanie, wystawianie i wypłaty. `ends_at` null = bezterminowa;
 * zdjęta blokada (`lifted_at`) nie działa i nie liczy się do eskalacji.
 */
export const accountBlocks = pgTable(
  'account_blocks',
  {
    id: idColumn(),
    userId: userRef(),
    kind: text().$type<AccountBlockKind>().notNull(),
    cause: text().$type<AccountBlockCause>().notNull(),
    /** Strike'i, które wywołały blokadę; cofnięcie któregoś zdejmuje blokadę. */
    strikeIds: uuid().array().notNull(),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }),
    statement: text().notNull(),
    liftedAt: timestamp({ withTimezone: true }),
    /** Personel, który zdjął blokadę; null przy zdjęciu przez system (cofnięty strike). */
    liftedBy: uuid(),
    liftNote: text(),
    ...appealColumns(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index().on(table.userId, table.kind, table.startsAt),
    index('account_blocks_pending_appeals')
      .on(table.appealedAt)
      .where(sql`${table.appealStatus} = 'PENDING'`),
    check('account_blocks_kind_check', sql.raw(`kind in (${sqlList(ACCOUNT_BLOCK_KINDS)})`)),
    check('account_blocks_cause_check', sql.raw(`cause in (${sqlList(ACCOUNT_BLOCK_CAUSES)})`)),
    check(
      'account_blocks_appeal_status_check',
      sql.raw(`appeal_status in (${sqlList(APPEAL_STATUSES)})`),
    ),
    check(
      'account_blocks_period_check',
      sql`${table.endsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
  ],
);

export type AccountBlockRow = typeof accountBlocks.$inferSelect;

/** Wersje polityki kont (§4.1): obowiązuje najnowsza, pusta tabela = DEFAULT_ACCOUNT_POLICY. */
export const accountPolicies = pgTable(
  'account_policies',
  {
    id: idColumn(),
    policy: jsonb().$type<AccountPolicy>().notNull(),
    /** Admin, który zapisał wersję (uuid użytkownika). */
    createdBy: uuid().notNull(),
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index().on(table.createdAt)],
);

// Tabele modułu messaging (F-29, PROJECT.md §10.3): rozmowy o aukcji, wiadomości z flagami danych
// kontaktowych i blokady między użytkownikami. Aukcje, zamówienia i konta są w innych modułach;
// tu tylko ich ID (uuid bez FK między modułami).
//
// Plik nie zależy od NestJS: czyta go też drizzle-kit (drizzle.config.ts).
import { CONTACT_FLAGS, type ContactFlag, MESSAGE_LIMITS } from '@biddy/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { idColumn } from '../../../infra/db/ids.js';

const sqlList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(', ');

/**
 * Rozmowa sprzedającego aukcji z jedną osobą: pytającą przed końcem aukcji albo kupującą (para
 * aukcja i druga strona, decyzja nr 135). Zamówienie pary liczymy przy odczycie.
 */
export const conversations = pgTable(
  'conversations',
  {
    id: idColumn(),
    /** Aukcja (moduł auctions; uuid bez FK). */
    auctionId: uuid().notNull(),
    sellerId: uuid().notNull(),
    /** Druga strona: pytający przed końcem aukcji albo kupujący. */
    buyerId: uuid().notNull(),
    /** Czas ostatniej wiadomości: kolejność listy rozmów. */
    lastMessageAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('conversations_auction_id_buyer_id_key').on(table.auctionId, table.buyerId),
    index().on(table.sellerId, table.lastMessageAt),
    index().on(table.buyerId, table.lastMessageAt),
    check('conversations_parties_check', sql`${table.sellerId} <> ${table.buyerId}`),
  ],
);

export type ConversationRow = typeof conversations.$inferSelect;

/**
 * Wiadomość z odbiorcą (druga strona rozmowy), odczytem i flagami danych kontaktowych.
 * `notified_at`: job wysłał powiadomienie o nieprzeczytanej wiadomości (decyzja nr 138).
 */
export const messages = pgTable(
  'messages',
  {
    id: idColumn(),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id),
    senderId: uuid().notNull(),
    recipientId: uuid().notNull(),
    body: text().notNull().default(''),
    /** Zdjęcia MESSAGE_PHOTO (moduł media, bez FK), prywatne. */
    mediaIds: uuid()
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    contactFlags: text()
      .array()
      .$type<ContactFlag[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    readAt: timestamp({ withTimezone: true }),
    notifiedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index().on(table.conversationId, table.id),
    index().on(table.senderId, table.createdAt),
    index('messages_unread_idx')
      .on(table.recipientId, table.conversationId)
      .where(sql`${table.readAt} is null`),
    index('messages_unnotified_idx')
      .on(table.createdAt)
      .where(sql`${table.readAt} is null and ${table.notifiedAt} is null`),
    index('messages_flagged_sender_idx')
      .on(table.senderId)
      .where(sql`${table.contactFlags} <> '{}'::text[]`),
    check('messages_parties_check', sql`${table.senderId} <> ${table.recipientId}`),
    check(
      'messages_content_check',
      sql.raw(
        `char_length(body) <= ${String(MESSAGE_LIMITS.bodyMax)} and cardinality(media_ids) <= ${String(MESSAGE_LIMITS.photos)} and (char_length(body) > 0 or cardinality(media_ids) > 0)`,
      ),
    ),
    check(
      'messages_contact_flags_check',
      sql.raw(`contact_flags <@ array[${sqlList(CONTACT_FLAGS)}]::text[]`),
    ),
  ],
);

export type MessageRow = typeof messages.$inferSelect;

/**
 * Blokada: gdy jedna strona zablokowała drugą, żadna nie pisze w ich rozmowach (decyzja nr 137).
 * Konta z modułu identity (uuid bez FK).
 */
export const userBlocks = pgTable(
  'user_blocks',
  {
    blockerId: uuid().notNull(),
    blockedId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.blockerId, table.blockedId] }),
    index().on(table.blockedId),
    check('user_blocks_parties_check', sql`${table.blockerId} <> ${table.blockedId}`),
  ],
);

export type UserBlockRow = typeof userBlocks.$inferSelect;

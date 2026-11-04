// Tabela modułu reviews (F-30, PROJECT.md §13.3): oceny stron zamówienia z ujawnieniem
// (`visible_at`) i znacznikiem joba powiadomień (`published_at`). Zamówienia i konta są w innych
// modułach; tu tylko ich ID (uuid bez FK między modułami) i migawka tytułu przedmiotu.
//
// Plik nie zależy od NestJS: czyta go też drizzle-kit (drizzle.config.ts).
import { REVIEW_LIMITS, REVIEW_ROLES, type ReviewRole } from '@biddy/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { idColumn } from '../../../infra/db/ids.js';

const sqlList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(', ');

/**
 * Ocena jednej strony zamówienia o drugiej. `role` to rola autora: `BUYER` ocenia sprzedającego,
 * `SELLER` kupującego. Ocena jest publiczna od `visible_at` (decyzja nr 143).
 */
export const reviews = pgTable(
  'reviews',
  {
    id: idColumn(),
    /** Zamówienie (moduł orders; uuid bez FK) i jego numer do linku w powiadomieniu. */
    orderId: uuid().notNull(),
    orderPublicId: text().notNull(),
    /** Tytuł przedmiotu z zamówienia (migawka). */
    title: text().notNull(),
    authorId: uuid().notNull(),
    targetId: uuid().notNull(),
    role: text().$type<ReviewRole>().notNull(),
    rating: smallint().notNull(),
    comment: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    visibleAt: timestamp({ withTimezone: true }).notNull(),
    /** Job `reviews.publish` wyemitował ReviewPublished (powiadomienie dla ocenianego). */
    publishedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex('reviews_order_id_author_id_key').on(table.orderId, table.authorId),
    index('reviews_target_id_created_at_idx').on(
      table.targetId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('reviews_unpublished_idx')
      .on(table.visibleAt)
      .where(sql`${table.publishedAt} is null`),
    check('reviews_rating_check', sql`${table.rating} between 1 and 5`),
    check('reviews_role_check', sql.raw(`role in (${sqlList(REVIEW_ROLES)})`)),
    check('reviews_parties_check', sql`${table.authorId} <> ${table.targetId}`),
    check('reviews_visible_at_check', sql`${table.visibleAt} >= ${table.createdAt}`),
    check(
      'reviews_comment_check',
      sql.raw(
        `comment is null or char_length(comment) between 1 and ${String(REVIEW_LIMITS.commentMax)}`,
      ),
    ),
  ],
);

export type ReviewRow = typeof reviews.$inferSelect;

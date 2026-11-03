// Tabele modułu media: zdjęcia (F-12). Pliki leżą w magazynie S3, tu jest ich stan.
// ID to UUIDv7 nadawane przez aplikację (ADR-10).
//
// Plik nie zależy od NestJS: czyta go też drizzle-kit (drizzle.config.ts).
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { idColumn } from '../../../infra/db/ids.js';

/**
 * Do czego służy zdjęcie: warianty i minimalny rozmiar zależą od przeznaczenia. Zdjęcia ze sporu
 * (F-28) są prywatne: ich warianty leżą w kubełku uploads, a wydaje je API stronom sporu.
 */
export const MEDIA_PURPOSES = ['ITEM_PHOTO', 'AVATAR', 'DISPUTE_EVIDENCE'] as const;
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];

/** Przeznaczenia bez publicznych adresów (warianty w prywatnym kubełku). */
export const PRIVATE_MEDIA_PURPOSES: ReadonlySet<MediaPurpose> = new Set(['DISPUTE_EVIDENCE']);

/**
 * PENDING_UPLOAD → PROCESSING → READY (publiczne) | FLAGGED (moderacja, niepubliczne) |
 * REJECTED (nie obraz, za mały, za duży).
 */
export const MEDIA_STATUSES = [
  'PENDING_UPLOAD',
  'PROCESSING',
  'READY',
  'FLAGGED',
  'REJECTED',
] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const media = pgTable(
  'media',
  {
    id: idColumn(),
    /** Właściciel (konto z modułu identity; uuid bez FK między modułami). */
    ownerId: uuid().notNull(),
    purpose: text().$type<MediaPurpose>().notNull(),
    status: text().$type<MediaStatus>().notNull().default('PENDING_UPLOAD'),
    /** Typ zadeklarowany przy uploadzie (rzeczywisty format sprawdza worker). */
    contentType: text().notNull(),
    sizeBytes: integer().notNull(),
    /** Wymiary największego wariantu po przetworzeniu. */
    width: integer(),
    height: integer(),
    rejectionReason: text(),
    moderationLabels: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Zdjęcie użyte (przedmiot, zdjęcie profilowe); nieużyte znika po dobie. */
    attachedAt: timestamp({ withTimezone: true }),
    processedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index().on(table.ownerId, table.createdAt),
    index('media_unattached_created_at_index')
      .on(table.createdAt)
      .where(sql`${table.attachedAt} is null`),
    check(
      'media_purpose_check',
      sql`${table.purpose} in ('ITEM_PHOTO', 'AVATAR', 'DISPUTE_EVIDENCE')`,
    ),
    check(
      'media_status_check',
      sql`${table.status} in ('PENDING_UPLOAD', 'PROCESSING', 'READY', 'FLAGGED', 'REJECTED')`,
    ),
  ],
);

export type Media = typeof media.$inferSelect;

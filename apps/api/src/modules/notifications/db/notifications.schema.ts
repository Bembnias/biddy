// Tabele modułu notifications (F-20, PROJECT.md §13.1): powiadomienia (centrum w aplikacji,
// deduplikacja, limit e-maili) i preferencje per typ i kanał.
//
// Plik nie zależy od NestJS: czyta go też drizzle-kit (drizzle.config.ts).
import type { NotificationChannel, NotificationType } from '@biddy/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { idColumn } from '../../../infra/db/ids.js';

/**
 * Powiadomienie użytkownika. `payload` to migawka z chwili zdarzenia (tytuł aukcji, ceny),
 * a tekst buduje API przy odczycie. `dedupe_key` (unikalny z użytkownikiem) sprawia, że ponowne
 * dostarczenie eventu nie tworzy drugiego powiadomienia.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: idColumn(),
    /** Konto z modułu identity (uuid bez FK między modułami). */
    userId: uuid().notNull(),
    type: text().$type<NotificationType>().notNull(),
    /** Aukcja, której dotyczy (limit e-maili o przebiciu na aukcję). */
    auctionId: uuid(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    dedupeKey: text().notNull(),
    readAt: timestamp({ withTimezone: true }),
    /** Kiedy zlecono e-mail (null: bez e-maila). */
    emailedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex().on(table.userId, table.dedupeKey),
    index().on(table.userId, table.createdAt),
    index('notifications_unread_index')
      .on(table.userId)
      .where(sql`${table.readAt} is null`),
    index().on(table.userId, table.type, table.auctionId, table.emailedAt),
  ],
);

export type Notification = typeof notifications.$inferSelect;

/** Preferencje: brak wiersza oznacza wartość domyślną (NOTIFICATION_EMAIL w @biddy/shared). */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: uuid().notNull(),
    type: text().$type<NotificationType>().notNull(),
    channel: text().$type<NotificationChannel>().notNull(),
    enabled: boolean().notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.type, table.channel] }),
    check('notification_preferences_channel_check', sql`${table.channel} in ('IN_APP', 'EMAIL')`),
  ],
);

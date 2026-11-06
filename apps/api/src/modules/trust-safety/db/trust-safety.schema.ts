// Tabele modułu trust-safety: zgłoszenia DSA (notice & action, PROJECT.md §13.3, §17). F-29 zapisuje
// zgłoszenia wiadomości i użytkowników z rozmów; kolejkę, decyzje z uzasadnieniem, zgłoszenia
// aukcji i odwołania dodaje F-35.
//
// Plik nie zależy od NestJS: czyta go też drizzle-kit (drizzle.config.ts).
import { REPORT_REASONS, type ReportReason } from '@biddy/shared';
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

const sqlList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(', ');

/** Co zgłoszono: wiadomość albo użytkownika (F-35 doda aukcje). */
export const REPORT_TARGET_TYPES = ['MESSAGE', 'USER'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

/** Stan zgłoszenia; decyzje (np. `ACTIONED`, `DISMISSED`) dojdą w F-35. */
export const REPORT_STATUSES = ['OPEN'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** Wiadomość w migawce zgłoszenia (treść, którą zgłaszający przekazał do sprawdzenia). */
export interface ReportedMessage {
  readonly id: string;
  readonly senderId: string;
  readonly body: string;
  readonly mediaIds: readonly string[];
  readonly contactFlags: readonly string[];
  readonly createdAt: string;
}

/** Kontekst zgłoszenia: skąd pochodzi i migawka treści z chwili zgłoszenia. */
export interface ReportContext {
  readonly source: 'CONVERSATION';
  readonly conversationId: string;
  readonly auctionId: string;
  readonly reportedUserId: string;
  readonly messages: readonly ReportedMessage[];
}

export const reports = pgTable(
  'reports',
  {
    id: idColumn(),
    /** Zgłaszający (moduł identity; uuid bez FK). */
    reporterId: uuid().notNull(),
    targetType: text().$type<ReportTargetType>().notNull(),
    targetId: uuid().notNull(),
    reason: text().$type<ReportReason>().notNull(),
    details: text(),
    context: jsonb().$type<ReportContext>().notNull(),
    status: text().$type<ReportStatus>().notNull().default('OPEN'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('reports_reporter_target_key').on(
      table.reporterId,
      table.targetType,
      table.targetId,
    ),
    index().on(table.status, table.createdAt),
    check('reports_target_type_check', sql.raw(`target_type in (${sqlList(REPORT_TARGET_TYPES)})`)),
    check('reports_reason_check', sql.raw(`reason in (${sqlList(REPORT_REASONS)})`)),
    check('reports_status_check', sql.raw(`status in (${sqlList(REPORT_STATUSES)})`)),
  ],
);

export type ReportRow = typeof reports.$inferSelect;

// Tabele transactional outbox (ADR-4, PROJECT.md §10.1): event domenowy zapisujemy w tej samej
// transakcji co zmianę, którą opisuje, a relay (worker) przekazuje go do kolejki BullMQ.
// processed_events pamięta, które eventy konsument już obsłużył (idempotencja przy
// ponownym dostarczeniu: at-least-once na wejściu, efekt w bazie dokładnie raz).
//
// Plik nie zależy od NestJS: czyta go też drizzle-kit (drizzle.config.ts).
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { idColumn } from '../../db/ids.js';

/** Metadane eventu: skąd pochodzi (żądanie HTTP, event, który go wywołał). */
export interface StoredEventMetadata {
  readonly requestId?: string;
  readonly causationId?: string;
}

export const outbox = pgTable(
  'outbox',
  {
    /** Identyfikator eventu (UUIDv7), klucz idempotencji u konsumentów i w usługach zewnętrznych. */
    id: idColumn(),
    /** Typ eventu w PascalCase, w czasie przeszłym, np. AuctionEnded (PROJECT.md §14.3). */
    type: text().notNull(),
    /** Wersja schematu payloadu; rośnie przy niezgodnej wstecz zmianie. */
    version: integer().notNull(),
    /** Rodzaj i identyfikator encji, której dotyczy event, np. auction + id aukcji. */
    aggregateType: text().notNull(),
    aggregateId: text().notNull(),
    payload: jsonb().$type<unknown>().notNull(),
    metadata: jsonb().$type<StoredEventMetadata>().notNull(),
    /** Czas transakcji, w której powstał event (now() w Postgresie). */
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Kiedy relay przekazał event do kolejki; null = jeszcze nie przekazany. */
    publishedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    // Relay szuka nieprzekazanych eventów w kolejności ID; indeks częściowy zostaje mały, bo
    // przekazane wiersze z niego wypadają.
    index('outbox_unpublished_idx')
      .on(table.id)
      .where(sql`${table.publishedAt} is null`),
    // Sprzątanie przekazanych eventów starszych niż okres przechowywania.
    index('outbox_published_at_idx')
      .on(table.publishedAt)
      .where(sql`${table.publishedAt} is not null`),
  ],
);

export const processedEvents = pgTable(
  'processed_events',
  {
    /** Nazwa konsumenta, np. notifications.outbid-email. */
    consumer: text().notNull(),
    eventId: uuid().notNull(),
    processedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.consumer, table.eventId] }),
    index('processed_events_processed_at_idx').on(table.processedAt),
  ],
);

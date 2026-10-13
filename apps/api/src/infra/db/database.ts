// Połączenie z Postgresem: pula pg i instancja Drizzle (PROJECT.md §11.2).
import { Logger } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import type { AppConfig } from '../config/index.js';
import * as schema from './schema.js';

/** Token DI puli połączeń (`pg.Pool`). */
export const PG_POOL = Symbol('PG_POOL');

/** Token DI instancji Drizzle (w modułach typ {@link Database}). */
export const DRIZZLE = Symbol('DRIZZLE');

/**
 * Instancja Drizzle ze schematem wszystkich modułów (src/infra/db/schema.ts): `db.query.*` zna
 * w niej tabele każdego modułu. Tylko dla infra (tworzenie połączenia, narzędzia), nie dla
 * modułów domenowych.
 */
export type AppDatabase = NodePgDatabase<typeof schema>;

/**
 * Instancja Drizzle z punktu widzenia modułu domenowego (wstrzykiwana tokenem DRIZZLE). Typ zna
 * tylko tabele z `TSchema`, więc zapytanie relacyjne do tabeli innego modułu
 * (`db.query.<cudza tabela>`) się nie skompiluje (PROJECT.md §10.3). Moduł podaje własny
 * schemat, np. `Database<typeof ordersTables>` przy `import * as ordersTables from
 * './db/orders.schema.js'`. Bez parametru zostają budowniczy zapytań
 * (`db.select().from(tabela)`) i `db.execute(sql)`.
 */
export type Database<TSchema extends Record<string, unknown> = Record<string, never>> =
  NodePgDatabase<TSchema>;

/** Nazwa aplikacji widoczna w `pg_stat_activity` i w logach Postgresa. */
export const APPLICATION_NAME = 'biddy-api';

/** Po tym czasie oczekiwanie na wolne lub nowe połączenie kończy się błędem, zamiast wisieć. */
const CONNECTION_TIMEOUT_MS = 5_000;

/** Tworzy pulę połączeń. Pula łączy się leniwie: brak bazy nie blokuje startu, pokaże go /ready. */
export function createPool(
  config: AppConfig['database'],
  logger: Pick<Logger, 'error'> = new Logger('Database'),
): Pool {
  const pool = new Pool({
    connectionString: config.url,
    max: config.poolMax,
    application_name: APPLICATION_NAME,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  });
  // Błąd bezczynnego połączenia (np. restart Postgresa) bez nasłuchu zakończyłby cały proces.
  // Pula sama usuwa takie połączenie i przy następnym zapytaniu otwiera nowe.
  pool.on('error', (error) => {
    logger.error(`Błąd bezczynnego połączenia z bazą danych: ${error.message}`, error.stack);
  });
  return pool;
}

/** Tworzy instancję Drizzle na podanej puli (nazwy kolumn w bazie: snake_case). */
export function createDatabase(pool: Pool): AppDatabase {
  return drizzle(pool, { schema, casing: 'snake_case' });
}

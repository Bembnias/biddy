// Pomocnicze zapytania do Postgresa w kontenerze, z osobnym application_name, żeby połączenia
// testów nie myliły się z połączeniami aplikacji (biddy-api) w pg_stat_activity.
import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { inject } from 'vitest';

export const TEST_CLIENT_APPLICATION_NAME = 'biddy-integration-test';

/** Adres wspólnej bazy testowej (po migracjach) z globalSetup. */
export function databaseUrl(): string {
  return inject('databaseUrl');
}

/** Otwiera jedno połączenie, wykonuje `fn` i zawsze je zamyka. */
export async function withClient<T>(url: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    connectionString: url,
    application_name: TEST_CLIENT_APPLICATION_NAME,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Wynik zapytania jako tablica wierszy. */
export async function query<Row extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
  url: string = databaseUrl(),
): Promise<Row[]> {
  return withClient(url, async (client) => (await client.query<Row>(sql, params)).rows);
}

/** Liczba otwartych połączeń o danym application_name do wskazanej bazy. */
export async function countConnections(applicationName: string, database: string): Promise<number> {
  const [row] = await query<{ count: number }>(
    `select count(*)::int as count
       from pg_stat_activity
      where application_name = $1 and datname = $2 and pid <> pg_backend_pid()`,
    [applicationName, database],
  );
  return row?.count ?? 0;
}

export interface ScratchDatabase {
  readonly name: string;
  readonly url: string;
  /** Usuwa bazę, także gdy ktoś jest jeszcze połączony (WITH (FORCE)). */
  drop(): Promise<void>;
}

/**
 * Tworzy pustą bazę (bez migracji) w tym samym kontenerze. Przydaje się, gdy test liczy
 * połączenia aplikacji, a inne pliki testów działają równolegle na wspólnej bazie.
 */
export async function createScratchDatabase(): Promise<ScratchDatabase> {
  const name = `biddy_scratch_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  await query(`create database "${name}"`);
  const url = new URL(databaseUrl());
  url.pathname = `/${name}`;
  return {
    name,
    url: url.toString(),
    drop: async () => {
      await query(`drop database if exists "${name}" with (force)`);
    },
  };
}

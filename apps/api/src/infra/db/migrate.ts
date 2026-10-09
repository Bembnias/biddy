// `pnpm --filter @biddy/api db:migrate`: stosuje migracje Drizzle na bazie spod DATABASE_URL.
// Uruchamiają go też `pnpm db:reset` (turbo run db:migrate) i deploy przed startem nowej wersji
// (PROJECT.md §18.2). Kod wyjścia 1 przy błędnej konfiguracji albo nieudanej migracji.
import { z } from 'zod';

import { envSchema } from '../config/index.js';
import { MIGRATIONS_FOLDER, runMigrations } from './migrations.js';

const migrateEnvSchema = z.object({ DATABASE_URL: envSchema.shape.DATABASE_URL });

const PREFIX = '[db:migrate]';

/** Kody błędów połączenia (Node.js), przy których podpowiadamy uruchomienie Postgresa. */
const CONNECTION_ERROR_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT']);

/** Adres bazy bez loginu i hasła, do logów. */
function describeTarget(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
}

/** Łańcuch przyczyn błędu (Drizzle opakowuje błąd Postgresa w „Failed query”). */
function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  for (let current = error; current !== undefined && chain.length < 5;) {
    chain.push(current);
    current = current instanceof Error ? current.cause : undefined;
  }
  return chain;
}

function reportFailure(error: unknown): void {
  const chain = errorChain(error);
  const [first, ...causes] = chain.map((item) =>
    (item instanceof Error ? item.message : String(item)).trim(),
  );
  console.error(`${PREFIX} Migracje nie powiodły się: ${first}`);
  for (const cause of causes) {
    console.error(`${PREFIX}   przyczyna: ${cause}`);
  }
  const isConnectionError = chain.some(
    (item) =>
      item instanceof Error &&
      'code' in item &&
      typeof item.code === 'string' &&
      CONNECTION_ERROR_CODES.has(item.code),
  );
  if (isConnectionError) {
    console.error(
      `${PREFIX} Brak połączenia z bazą. Lokalnie uruchom Postgresa: pnpm infra:up (sprawdź też DATABASE_URL).`,
    );
  }
}

async function main(): Promise<number> {
  // Pustą wartość traktujemy jak brak zmiennej (tak jak konfiguracja API).
  const parsed = migrateEnvSchema.safeParse({
    DATABASE_URL: process.env['DATABASE_URL']?.trim() || undefined,
  });
  if (!parsed.success) {
    console.error(`${PREFIX} Błędna konfiguracja: brak lub niepoprawny DATABASE_URL.`);
    console.error(z.prettifyError(parsed.error));
    console.error(
      `${PREFIX} Ustaw DATABASE_URL (postgres://…), np. w pliku .env w katalogu głównym repozytorium (szablon: .env.example).`,
    );
    return 1;
  }

  const { DATABASE_URL: databaseUrl } = parsed.data;
  console.log(
    `${PREFIX} Stosuję migracje z ${MIGRATIONS_FOLDER} na ${describeTarget(databaseUrl)}…`,
  );
  const startedAt = performance.now();
  try {
    await runMigrations(databaseUrl);
  } catch (error) {
    reportFailure(error);
    return 1;
  }
  console.log(
    `${PREFIX} Migracje zastosowane (${Math.round(performance.now() - startedAt)} ms). Baza jest aktualna.`,
  );
  return 0;
}

process.exitCode = await main();

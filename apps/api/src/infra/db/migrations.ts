// Programowe uruchamianie migracji Drizzle: pliki SQL z apps/api/drizzle (generuje je drizzle-kit,
// patrz drizzle.config.ts). Zastosowane migracje Drizzle zapisuje w tabeli
// drizzle.__drizzle_migrations, więc ponowne uruchomienie jest bezpieczne.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';

/**
 * Katalog migracji liczony względem pliku modułu, a nie katalogu roboczego. Ten plik leży w
 * src/infra/db (źródła: @swc-node/register, Vitest) albo w dist/infra/db (build), więc w obu
 * przypadkach katalog apps/api/drizzle jest trzy poziomy wyżej.
 */
export function resolveMigrationsFolder(moduleUrl: string | URL = import.meta.url): string {
  return fileURLToPath(new URL('../../../drizzle', moduleUrl));
}

/** Bezwzględna ścieżka katalogu migracji (apps/api/drizzle). */
export const MIGRATIONS_FOLDER = resolveMigrationsFolder();

/**
 * Klucz sesyjnej blokady doradczej Postgresa (pg_advisory_lock) na czas migracji. Stała,
 * wspólna dla wszystkich procesów: równoległe uruchomienia czekają na siebie.
 */
export const MIGRATIONS_LOCK_KEY = 5_310_270_431;

/** Wpis dziennika drizzle-kit (drizzle/meta/_journal.json). */
export interface JournalEntry {
  readonly idx: number;
  /** Czas wygenerowania migracji (ms); Drizzle zapisuje go jako created_at. */
  readonly when: number;
  readonly tag: string;
}

/** Wpisy dziennika migracji z podanego katalogu. */
export function readJournal(migrationsFolder: string = MIGRATIONS_FOLDER): JournalEntry[] {
  const raw = readFileSync(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8');
  return (JSON.parse(raw) as { entries: JournalEntry[] }).entries;
}

const REGENERATE_HINT =
  'Wygeneruj ją ponownie na aktualnej gałęzi głównej: usuń jej plik SQL, snapshot i wpis w drizzle/meta/_journal.json, potem uruchom pnpm --filter @biddy/api db:generate.';

/**
 * Problemy z kolejnością dziennika. Drizzle stosuje tylko migracje nowsze („when”) od ostatnio
 * zastosowanej, więc migracja z wcześniejszym czasem niż poprzednia (np. wygenerowana na
 * gałęzi przed cudzą migracją, a scalona po niej) zostałaby po cichu pominięta.
 */
export function journalProblems(entries: readonly JournalEntry[]): string[] {
  const problems: string[] = [];
  entries.forEach((entry, position) => {
    if (entry.idx !== position) {
      problems.push(`${entry.tag}: idx ${entry.idx}, oczekiwano ${position} (kolejne numery od 0)`);
    }
    const previous = entries[position - 1];
    if (previous !== undefined && entry.when <= previous.when) {
      problems.push(
        `${entry.tag}: czas „when” (${entry.when}) nie jest późniejszy niż w ${previous.tag} (${previous.when}). ${REGENERATE_HINT}`,
      );
    }
  });
  return problems;
}

/** Błędny dziennik albo migracje z dziennika, których Drizzle nie zastosował. */
export class MigrationsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationsError';
  }
}

/** Wpisy dziennika bez wiersza w drizzle.__drizzle_migrations (porównanie po czasie „when”). */
async function unappliedMigrations(
  client: Client,
  entries: readonly JournalEntry[],
): Promise<string[]> {
  const { rows } = await client.query<{ created_at: string | null }>(
    'select created_at from drizzle.__drizzle_migrations',
  );
  const applied = new Set(rows.map((row) => String(row.created_at)));
  return entries.filter((entry) => !applied.has(String(entry.when))).map((entry) => entry.tag);
}

export interface RunMigrationsOptions {
  /** Katalog migracji; domyślnie apps/api/drizzle (testy podają własny). */
  readonly migrationsFolder?: string;
}

/**
 * Stosuje wszystkie niezastosowane migracje na bazie spod `databaseUrl`.
 *
 * - Najpierw sprawdza kolejność dziennika (patrz {@link journalProblems}).
 * - Działa pod sesyjną blokadą doradczą: równoległe uruchomienia (nakładające się deploye,
 *   ręczne db:migrate w trakcie deployu) czekają na siebie, zamiast ścigać się o
 *   CREATE SCHEMA / CREATE EXTENSION, które Drizzle wykonuje poza transakcją.
 * - Na koniec sprawdza, że każda migracja z dziennika ma wpis w bazie; inaczej rzuca
 *   {@link MigrationsError} (Drizzle pominąłby ją bez błędu).
 */
export async function runMigrations(
  databaseUrl: string,
  options: RunMigrationsOptions = {},
): Promise<void> {
  const migrationsFolder = options.migrationsFolder ?? MIGRATIONS_FOLDER;
  const entries = readJournal(migrationsFolder);
  const problems = journalProblems(entries);
  if (problems.length > 0) {
    throw new MigrationsError(
      ['Dziennik migracji jest niespójny:', ...problems.map((problem) => `  • ${problem}`)].join(
        '\n',
      ),
    );
  }

  const client = new Client({
    connectionString: databaseUrl,
    application_name: 'biddy-migrate',
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATIONS_LOCK_KEY]);
    try {
      await migrate(drizzle(client), { migrationsFolder });
      const skipped = await unappliedMigrations(client, entries);
      if (skipped.length > 0) {
        throw new MigrationsError(
          `Drizzle pominął migracje z dziennika: ${skipped.join(', ')}. Baza ma już migrację o późniejszym czasie „when” (np. z innej gałęzi). ${REGENERATE_HINT}`,
        );
      }
    } finally {
      // Po zerwanym połączeniu Postgres i tak zwalnia blokadę sesji; błąd odblokowania nie może
      // przesłonić właściwego błędu migracji.
      await client
        .query('select pg_advisory_unlock($1)', [MIGRATIONS_LOCK_KEY])
        .catch(() => undefined);
    }
  } finally {
    await client.end();
  }
}

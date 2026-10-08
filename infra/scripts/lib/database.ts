// Reset lokalnej bazy: usunięcie i utworzenie od nowa, potem migracje i seed przez Turborepo.
import { Client, escapeIdentifier } from 'pg';

import type { InfraEnv } from '../env.js';
import { CliError, log } from './cli.js';
import { type ResetTarget, checkResetSafety, databaseUrlFor } from './db-safety.js';
import { ROOT_DIR } from './paths.js';
import { run } from './process.js';

/** Sprawdza bezpiecznik i zwraca cel resetu albo rzuca CliError z powodem odmowy. */
export function assertResetAllowed(env: InfraEnv): ResetTarget {
  const safety = checkResetSafety(env.DATABASE_URL, env.NODE_ENV);
  if (!safety.ok) {
    throw new CliError(`Odmowa resetu bazy. ${safety.reason}`, [
      '`pnpm db:reset` działa wyłącznie na lokalnym Postgresie z docker compose.',
    ]);
  }
  return safety.target;
}

/** DROP DATABASE … WITH (FORCE) i CREATE DATABASE przez bazę serwisową `postgres`. */
async function recreateDatabase(target: ResetTarget): Promise<void> {
  const client = new Client({
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    database: 'postgres',
    connectionTimeoutMillis: 5000,
    application_name: 'biddy-db-reset',
  });

  try {
    await client.connect();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CliError(
      `Nie można połączyć się z Postgresem na ${target.host}:${target.port} (${reason}).`,
      [
        'Czy infrastruktura działa? Uruchom: pnpm infra:up',
        'Sprawdź DATABASE_URL, POSTGRES_USER, POSTGRES_PASSWORD i POSTGRES_PORT w .env (`pnpm env:check`).',
      ],
      { cause: error },
    );
  }

  try {
    const name = escapeIdentifier(target.database);
    // WITH (FORCE) rozłącza otwarte sesje (np. działające API), zamiast kończyć się błędem.
    await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${name}`);
  } finally {
    await client.end();
  }
}

interface DryRunTask {
  taskId: string;
  command: string;
}

/**
 * Argumenty `pnpm exec turbo run <task>`. `--env-mode=loose`: Turborepo 2 domyślnie działa
 * w trybie strict i przekazuje zadaniom tylko zmienne zadeklarowane w turbo.json, więc migracje
 * i seed nie dostałyby DATABASE_URL. Te zadania nie są cache'owane, więc pełne środowisko nie
 * wpływa na hashe. Test: database.test.ts sprawdza tryb w `turbo run --dry=json`.
 */
export function turboRunArgs(task: string, extra: readonly string[] = []): string[] {
  return ['exec', 'turbo', 'run', task, '--env-mode=loose', ...extra];
}

/**
 * Środowisko dla migracji i seeda: zmienne procesu i .env, ale DATABASE_URL zbudowany z celu
 * sprawdzonego przez bezpiecznik, a nie surowy adres z .env.
 */
export function workspaceTaskEnv(
  target: ResetTarget,
  baseEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return { ...baseEnv, DATABASE_URL: databaseUrlFor(target) };
}

/** Zadania Turborepo, które naprawdę mają skrypt w którymś pakiecie. */
async function definedTasks(task: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  const result = await run('pnpm', turboRunArgs(task, ['--dry=json']), {
    cwd: ROOT_DIR,
    env,
    output: 'capture',
  });
  if (result.exitCode !== 0) {
    throw new CliError(`Nie udało się sprawdzić zadania ${task} w Turborepo.`, [
      result.stderr.trim() || result.stdout.trim(),
    ]);
  }
  const dryRun = JSON.parse(result.stdout) as { tasks?: DryRunTask[] };
  // Pakiety bez skryptu dostają w trybie --dry komendę "<NONEXISTENT>".
  return (dryRun.tasks ?? [])
    .filter((entry) => entry.command !== '<NONEXISTENT>')
    .map((entry) => entry.taskId);
}

/**
 * `pnpm exec turbo run <task>` z katalogu głównego. Gdy żaden pakiet nie definiuje zadania,
 * turbo i tak kończy się kodem 0; wtedy wypisujemy notkę, że zadanie dopiero powstanie.
 */
async function runWorkspaceTask(
  task: string,
  env: NodeJS.ProcessEnv,
  notDefinedNote: string,
): Promise<void> {
  const defined = await definedTasks(task, env);
  const result = await run('pnpm', turboRunArgs(task), { cwd: ROOT_DIR, env });
  if (result.exitCode !== 0) {
    throw new CliError(`Zadanie ${task} zakończyło się błędem (kod ${result.exitCode}).`, [
      'Szczegóły są w wyjściu powyżej.',
    ]);
  }
  if (defined.length === 0) {
    log.note(notDefinedNote);
  } else {
    log.success(`${task}: ${defined.join(', ')}`);
  }
}

/**
 * Pełny reset: bezpiecznik → nowa pusta baza → migracje → seed.
 * `baseEnv` (zmienne procesu i .env) trafia do procesów turbo, z DATABASE_URL podmienionym
 * na adres sprawdzony przez bezpiecznik (workspaceTaskEnv).
 */
export async function resetDatabase(env: InfraEnv, baseEnv: NodeJS.ProcessEnv): Promise<void> {
  const target = assertResetAllowed(env);
  const childEnv = workspaceTaskEnv(target, baseEnv);

  log.info(`Usuwam i tworzę od nowa bazę ${target.database} na ${target.host}:${target.port}…`);
  await recreateDatabase(target);
  log.success(`Baza ${target.database} jest pusta i gotowa na migracje`);

  await runWorkspaceTask(
    'db:migrate',
    childEnv,
    'Migracje (db:migrate) nie są jeszcze zdefiniowane w żadnym pakiecie. Pojawią się razem z backendem (F-03, Drizzle).',
  );
  await runWorkspaceTask(
    'db:seed',
    childEnv,
    'Seed (db:seed) nie jest jeszcze zdefiniowany w żadnym pakiecie. Użytkownicy testowi pojawią się razem z kontami (F-03, F-07).',
  );
}

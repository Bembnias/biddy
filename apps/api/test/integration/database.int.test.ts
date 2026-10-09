// Warstwa bazy na prawdziwym Postgresie (Testcontainers): migracje Drizzle z globalSetup,
// ich idempotentność, /ready przy niedostępnej bazie i zwalnianie połączeń przy zamykaniu.
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { APPLICATION_NAME } from '../../src/infra/db/database.js';
import { MIGRATIONS_FOLDER, MigrationsError, runMigrations } from '../../src/infra/db/index.js';
import { integrationConfig, problemOf, startTestApp, type TestApp } from './support/app.js';
import {
  countConnections,
  createScratchDatabase,
  databaseUrl,
  query,
  type ScratchDatabase,
} from './support/database.js';

interface JournalEntry {
  readonly idx: number;
  readonly when: number;
  readonly tag: string;
}

async function readJournal(): Promise<JournalEntry[]> {
  const raw = await readFile(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8');
  return (JSON.parse(raw) as { entries: JournalEntry[] }).entries;
}

async function migrationHash(tag: string): Promise<string> {
  const sql = await readFile(join(MIGRATIONS_FOLDER, `${tag}.sql`), 'utf8');
  return createHash('sha256').update(sql).digest('hex');
}

interface MigrationRow extends Record<string, unknown> {
  readonly id: number;
  readonly hash: string;
  readonly created_at: string;
}

function appliedMigrations(): Promise<MigrationRow[]> {
  return query<MigrationRow>(
    'select id, hash, created_at from drizzle.__drizzle_migrations order by id',
  );
}

describe('migracje Drizzle (globalSetup → runMigrations)', () => {
  it('rozszerzenie ltree jest zainstalowane i działa', async () => {
    const extensions = await query<{ extname: string }>(
      "select extname from pg_extension where extname = 'ltree'",
    );
    expect(extensions).toEqual([{ extname: 'ltree' }]);

    const [row] = await query<{ inside: boolean }>(
      "select 'moda.obuwie.sneakersy'::ltree <@ 'moda'::ltree as inside",
    );
    expect(row?.inside).toBe(true);
  });

  it('drizzle.__drizzle_migrations ma wpis migracji init (hash pliku SQL, czas z dziennika)', async () => {
    const journal = await readJournal();
    const init = journal.find((entry) => entry.tag === '0000_init');
    expect(init).toBeDefined();

    const rows = await appliedMigrations();
    // Każda migracja z dziennika ma dokładnie jeden wpis (także po dodaniu kolejnych migracji).
    expect(rows).toHaveLength(journal.length);
    expect(rows[0]).toMatchObject({
      hash: await migrationHash('0000_init'),
      created_at: String(init?.when),
    });
  });

  it('runMigrations jest idempotentne: drugie uruchomienie niczego nie zmienia', async () => {
    const before = await appliedMigrations();

    await runMigrations(databaseUrl());

    expect(await appliedMigrations()).toEqual(before);
    const extensions = await query("select 1 from pg_extension where extname = 'ltree'");
    expect(extensions).toHaveLength(1);
  });
});

describe('runMigrations: równoległe uruchomienia i pominięte migracje', () => {
  let scratch: ScratchDatabase | undefined;
  let folder: string | undefined;

  afterEach(async () => {
    await scratch?.drop();
    if (folder !== undefined) {
      rmSync(folder, { recursive: true, force: true });
    }
    scratch = undefined;
    folder = undefined;
  });

  it('trzy równoległe uruchomienia na pustej bazie kończą się sukcesem (blokada doradcza)', async () => {
    // Bez blokady Drizzle ściga się o CREATE SCHEMA / CREATE EXTENSION poza transakcją
    // (duplicate key w pg_namespace albo pg_extension), np. przy nakładających się deployach.
    scratch = await createScratchDatabase();
    const url = scratch.url;

    const runs = await Promise.allSettled([
      runMigrations(url),
      runMigrations(url),
      runMigrations(url),
    ]);

    expect(runs.map((run) => (run.status === 'rejected' ? String(run.reason) : 'ok'))).toEqual([
      'ok',
      'ok',
      'ok',
    ]);
    const rows = await query('select id from drizzle.__drizzle_migrations', [], url);
    expect(rows).toHaveLength((await readJournal()).length);
  });

  it('migracja z dziennika pominięta przez Drizzle (starszy czas niż w bazie) kończy się błędem', async () => {
    scratch = await createScratchDatabase();
    const url = scratch.url;
    await runMigrations(url);

    // Baza ma już migrację z innej gałęzi, późniejszą niż nowa migracja z dziennika: Drizzle
    // porównuje tylko czasy, więc nowej migracji by nie zastosował.
    const journal = await readJournal();
    const last = journal.at(-1);
    if (last === undefined) {
      throw new Error('Pusty dziennik migracji');
    }
    await query(
      'insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)',
      ['migracja-z-innej-galezi', last.when + 2_000],
      url,
    );
    folder = mkdtempSync(join(tmpdir(), 'biddy-migrations-'));
    cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
    const tag = `${String(journal.length).padStart(4, '0')}_late`;
    writeFileSync(join(folder, `${tag}.sql`), 'CREATE TABLE "late_table" ("id" integer);\n');
    const journalPath = join(folder, 'meta', '_journal.json');
    const journalFile = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
    journalFile.entries.push({
      idx: journal.length,
      version: '7',
      when: last.when + 1_000,
      tag,
      breakpoints: true,
    });
    writeFileSync(journalPath, JSON.stringify(journalFile));

    const result = runMigrations(url, { migrationsFolder: folder });

    await expect(result).rejects.toBeInstanceOf(MigrationsError);
    await expect(result).rejects.toThrow(`Drizzle pominął migracje z dziennika: ${tag}.`);
    const [table] = await query<{ name: string | null }>(
      "select to_regclass('public.late_table')::text as name",
      [],
      url,
    );
    expect(table?.name).toBeNull();
    // Blokada doradcza została zwolniona także po błędzie: kolejne uruchomienie nie czeka.
    await runMigrations(url);
  });
});

describe('/ready przy niedostępnej bazie', () => {
  function withCredentials(user: string, password: string): string {
    const url = new URL(databaseUrl());
    url.username = user;
    url.password = password;
    return url.toString();
  }

  it.each([
    ['nikt nie nasłuchuje na porcie', () => 'postgres://biddy:biddy@127.0.0.1:1/biddy'],
    ['baza odrzuca logowanie', () => withCredentials('biddy', 'zle-haslo')],
  ])('%s → 503 Problem Details SERVICE_UNAVAILABLE', async (_case, url) => {
    const api = await startTestApp(integrationConfig({ DATABASE_URL: url() }));
    try {
      const response = await api.http.inject({ method: 'GET', url: '/ready' });

      expect(response.statusCode).toBe(503);
      expect(problemOf(response)).toMatchObject({
        type: 'https://biddy.pl/problems/service-unavailable',
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        instance: '/ready',
        checks: { database: 'error' },
      });
      // Liveness nie zależy od bazy: platforma nie restartuje instancji przy awarii Postgresa.
      expect((await api.http.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    } finally {
      await api.close();
    }
  });
});

describe('zamykanie aplikacji', () => {
  let scratch: ScratchDatabase | undefined;
  let api: TestApp | undefined;

  afterEach(async () => {
    await api?.close().catch(() => undefined);
    await scratch?.drop();
    api = undefined;
    scratch = undefined;
  });

  it('app.close() zamyka pulę: w pg_stat_activity nie zostaje żadne połączenie biddy-api', async () => {
    // Osobna baza: inne pliki testów działają równolegle i też łączą się jako biddy-api.
    scratch = await createScratchDatabase();
    api = await startTestApp(integrationConfig({ DATABASE_URL: scratch.url }));
    const connections = () => countConnections(APPLICATION_NAME, scratch?.name ?? '');

    const ready = await api.http.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(200);
    // Pula trzyma bezczynne połączenie po zapytaniu z /ready.
    expect(await connections()).toBeGreaterThanOrEqual(1);

    await api.close();
    api = undefined;

    // Backend Postgresa znika z pg_stat_activity chwilę po rozłączeniu klienta.
    await vi.waitFor(async () => expect(await connections()).toBe(0), {
      timeout: 5_000,
      interval: 100,
    });
  });
});

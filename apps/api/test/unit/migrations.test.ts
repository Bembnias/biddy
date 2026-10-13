import {
  existsSync,
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readMigrationFiles } from 'drizzle-orm/migrator';
import { describe, expect, it } from 'vitest';

import {
  type JournalEntry,
  journalProblems,
  MIGRATIONS_FOLDER,
  MigrationsError,
  readJournal,
  resolveMigrationsFolder,
  runMigrations,
} from '../../src/infra/db/migrations.js';

const API_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DRIZZLE_DIR = path.join(API_ROOT, 'drizzle');

interface Journal {
  entries: { idx: number; tag: string }[];
}

describe('katalog migracji', () => {
  it('ze źródeł (src/infra/db) wskazuje apps/api/drizzle', () => {
    expect(MIGRATIONS_FOLDER).toBe(DRIZZLE_DIR);
  });

  it('z builda (dist/infra/db) też wskazuje apps/api/drizzle', () => {
    const builtModule = pathToFileURL(path.join(API_ROOT, 'dist/infra/db/migrations.js'));

    expect(resolveMigrationsFolder(builtModule)).toBe(DRIZZLE_DIR);
    expect(resolveMigrationsFolder(builtModule.href)).toBe(DRIZZLE_DIR);
  });

  it('każdy wpis dziennika drizzle-kit ma plik SQL i snapshot schematu', () => {
    const journal = JSON.parse(
      readFileSync(path.join(DRIZZLE_DIR, 'meta/_journal.json'), 'utf8'),
    ) as Journal;

    expect(journal.entries.length).toBeGreaterThan(0);
    for (const { idx, tag } of journal.entries) {
      expect(existsSync(path.join(DRIZZLE_DIR, `${tag}.sql`)), tag).toBe(true);
      const snapshot = `meta/${String(idx).padStart(4, '0')}_snapshot.json`;
      expect(existsSync(path.join(DRIZZLE_DIR, snapshot)), snapshot).toBe(true);
    }
  });

  it('pierwsza migracja włącza rozszerzenie ltree (drzewo kategorii)', () => {
    const [init] = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });

    expect(init?.sql.join('\n')).toContain('CREATE EXTENSION IF NOT EXISTS ltree;');
  });
});

describe('kolejność dziennika migracji', () => {
  // Drizzle stosuje tylko migracje z czasem „when” późniejszym niż ostatnio zastosowana. Migracja
  // wygenerowana na gałęzi wcześniej, a scalona po cudzej, zostałaby na stagingu i produkcji
  // po cichu pominięta, dlatego CI pilnuje rosnących czasów.
  it('dziennik w repozytorium: kolejne idx od 0 i ściśle rosnące czasy „when”', () => {
    expect(journalProblems(readJournal())).toEqual([]);
  });

  it('wykrywa migrację starszą niż poprzednia, ten sam czas i dziurę w numeracji', () => {
    const entries: JournalEntry[] = [
      { idx: 0, when: 2000, tag: '0000_init' },
      { idx: 1, when: 1000, tag: '0001_late' },
      { idx: 2, when: 1000, tag: '0002_same_time' },
      { idx: 4, when: 5000, tag: '0004_gap' },
    ];

    const problems = journalProblems(entries);

    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(
      /^0001_late: czas „when” \(1000\) nie jest późniejszy niż w 0000_init/,
    );
    expect(problems[0]).toContain('db:generate');
    expect(problems[1]).toMatch(/^0002_same_time: czas „when”/);
    expect(problems[2]).toBe('0004_gap: idx 4, oczekiwano 3 (kolejne numery od 0)');
  });

  it('runMigrations odrzuca niespójny dziennik, zanim połączy się z bazą', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'biddy-journal-'));
    try {
      mkdirSync(path.join(folder, 'meta'));
      const entries = [
        { idx: 0, version: '7', when: 2000, tag: '0000_init', breakpoints: true },
        { idx: 1, version: '7', when: 1000, tag: '0001_late', breakpoints: true },
      ];
      writeFileSync(
        path.join(folder, 'meta', '_journal.json'),
        JSON.stringify({ version: '7', dialect: 'postgresql', entries }),
      );

      // Port 1: nikt nie nasłuchuje. Błąd połączenia oznaczałby, że sprawdzenie nie zadziałało.
      const result = runMigrations('postgres://biddy:biddy@127.0.0.1:1/biddy', {
        migrationsFolder: folder,
      });

      await expect(result).rejects.toBeInstanceOf(MigrationsError);
      await expect(result).rejects.toThrow(/Dziennik migracji jest niespójny:\n {2}• 0001_late/);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe('agregat schematu Drizzle (src/infra/db/schema.ts)', () => {
  it('re-eksportuje wszystkie pliki tabel modułów (src/modules/<moduł>/db/*.schema.ts)', () => {
    const aggregate = readFileSync(path.join(API_ROOT, 'src/infra/db/schema.ts'), 'utf8');
    const tableFiles = globSync('src/modules/*/db/*.schema.ts', { cwd: API_ROOT });

    // drizzle-kit czyta pliki tabel bezpośrednio, a aplikacja przez agregat: brak wpisu oznacza
    // tabelę z migracją, ale niewidoczną dla zapytań relacyjnych (db.query.*).
    for (const file of tableFiles) {
      const specifier = `../../${file.slice('src/'.length).replace(/\.ts$/, '.js')}`;
      expect(aggregate, file).toContain(`export * from '${specifier}';`);
    }
  });
});

// Skrypt `fees:publish` (F-13) jako osobny proces na prawdziwym Postgresie: podgląd bez zapisu,
// publikacja z --confirm i czytelne błędy (zły cennik, data w przeszłości).
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ScratchDatabase } from './support/database.js';
import { startScript, waitForExit } from './support/process.js';
import { createMigratedDatabase } from './support/worker.js';

let database: ScratchDatabase;
let pool: Pool;
let dir: string;

beforeAll(async () => {
  database = await createMigratedDatabase();
  pool = new Pool({ connectionString: database.url, max: 1 });
  dir = await mkdtemp(join(tmpdir(), 'biddy-fees-'));
});

afterAll(async () => {
  await pool.end();
  await database.drop();
  await rm(dir, { recursive: true, force: true });
});

async function run(
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const script = startScript('src/fees-publish.ts', { DATABASE_URL: database.url }, args);
  const { code } = await waitForExit(script.child, 30_000);
  return { code, ...script.output() };
}

async function scheduleFile(content: unknown): Promise<string> {
  const file = join(dir, `${String(Math.random()).slice(2)}.json`);
  await writeFile(file, JSON.stringify(content));
  return file;
}

const NEXT = {
  currency: 'PLN',
  fixedFee: 349,
  tiers: [
    { upTo: 100_000, bp: 750 },
    { upTo: null, bp: 400 },
  ],
  vatRateBp: 2300,
};

async function schedules(): Promise<{ fixed_fee: string; valid_to: Date | null }[]> {
  const { rows } = await pool.query<{ fixed_fee: string; valid_to: Date | null }>(
    'select fixed_fee, valid_to from fee_schedules order by valid_from',
  );
  return rows;
}

describe('fees:publish', () => {
  it('bez --confirm: porównanie POK dla przykładowych kwot, nic nie zapisuje', async () => {
    const from = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
    const result = await run(['--file', await scheduleFile(NEXT), '--from', from]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout.replaceAll('\u00a0', ' ')).toMatch(/ 100,00 zł: +9,99 zł → 10,99 zł\n/);
    expect(result.stdout).toContain('Podgląd: nic nie zapisano');
    expect(await schedules()).toHaveLength(1);
  });

  it('z --confirm: zamyka bieżący cennik i zapisuje nowy', async () => {
    const from = new Date(Date.now() + 24 * 60 * 60 * 1_000);
    const result = await run([
      '--file',
      await scheduleFile(NEXT),
      '--from',
      from.toISOString(),
      '--note',
      'Test',
      '--confirm',
    ]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('Opublikowano cennik');
    expect(await schedules()).toEqual([
      { fixed_fee: '299', valid_to: from },
      { fixed_fee: '349', valid_to: null },
    ]);
  });

  it('błędy: zły cennik, data w przeszłości, brak argumentów (kod 1, opis po polsku)', async () => {
    const invalid = await run([
      '--file',
      await scheduleFile({ ...NEXT, tiers: [{ upTo: 100, bp: 700 }] }),
      '--from',
      '2030-01-01T00:00:00Z',
    ]);
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain('tiers.0.upTo: ostatni próg musi być bez limitu');

    const past = await run([
      '--file',
      await scheduleFile(NEXT),
      '--from',
      '2026-02-01T00:00:00+01:00',
      '--confirm',
    ]);
    expect(past.code).toBe(1);
    expect(past.stderr).toContain(
      'validFrom: Nowy cennik może zacząć obowiązywać najwcześniej teraz.',
    );

    const usage = await run([]);
    expect(usage.code).toBe(1);
    expect(usage.stderr).toContain('Użycie: fees:publish');
    expect(await schedules()).toHaveLength(2);
  });
});

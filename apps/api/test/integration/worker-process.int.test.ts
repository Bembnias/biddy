// Worker jako osobny proces (jak `pnpm dev:worker` i wdrożenie): zła konfiguracja i Redis bez
// noeviction kończą start kodem 1, poprawny worker przekazuje eventy z outboxa i kończy się po
// SIGTERM, a job przerwany zabiciem procesu (SIGKILL) wraca do kolejki i jego efekt powstaje
// dokładnie raz.
import { Pool } from 'pg';
import type { StartedTestContainer } from 'testcontainers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../src/infra/db/database.js';
import { Outbox } from '../../src/infra/outbox/index.js';
import { redisUrlOf, startRedis } from './global-setup.js';
import type { ScratchDatabase } from './support/database.js';
import {
  OutboxTestModule,
  TEST_TABLES_SQL,
  TestCalls,
  TestItemCreated,
} from './support/outbox-test.module.js';
import {
  type StartedProcess,
  jsonLines,
  killIfRunning,
  startScript,
  waitForExit,
  waitForOutput,
} from './support/process.js';
import {
  type TestWorker,
  createMigratedDatabase,
  redisUrl,
  startTestWorker,
  uniqueQueuePrefix,
  waitFor,
  workerConfig,
} from './support/worker.js';

/** Limit na odmowę startu: walidacja dzieje się przed importem NestJS. */
const EXIT_TIMEOUT_MS = 30_000;

let database: ScratchDatabase;
let pool: Pool;
let db: ReturnType<typeof createDatabase>;
const outbox = new Outbox({ logger: undefined } as never);
const processes: StartedProcess[] = [];
let worker: TestWorker | undefined;

function start(script: string, env: Record<string, string>): StartedProcess {
  const started = startScript(script, env);
  processes.push(started);
  return started;
}

async function commit(title: string, extra: Record<string, unknown> = {}): Promise<string> {
  const [id] = await db.transaction((tx) =>
    outbox.add(
      tx,
      TestItemCreated.create({ aggregateId: `item-${title}`, payload: { title, ...extra } }),
    ),
  );
  return id ?? '';
}

beforeAll(async () => {
  database = await createMigratedDatabase();
  pool = new Pool({ connectionString: database.url, max: 4 });
  db = createDatabase(pool);
  await pool.query(TEST_TABLES_SQL);
});

afterAll(async () => {
  await pool.end();
  await database.drop();
});

beforeEach(async () => {
  await pool.query('truncate outbox, processed_events, test_effects, test_markers');
});

afterEach(async () => {
  for (const started of processes.splice(0)) {
    killIfRunning(started.child);
  }
  await worker?.close();
  worker = undefined;
});

describe('src/worker.ts: start', () => {
  it.each([
    ['brak DATABASE_URL', {}, 'DATABASE_URL: brak zmiennej'],
    [
      'produkcja bez REDIS_QUEUE_URL (CORS_ORIGINS workerowi niepotrzebny)',
      { NODE_ENV: 'production', DATABASE_URL: 'postgres://biddy:biddy@127.0.0.1:5432/biddy' },
      'REDIS_QUEUE_URL: brak zmiennej',
    ],
  ])(
    '%s → kod wyjścia 1, nazwa zmiennej na stderr',
    async (_case, env, expected) => {
      const started = start('src/worker.ts', env);
      const exit = await waitForExit(started.child, EXIT_TIMEOUT_MS);
      const { stdout, stderr } = started.output();

      expect(exit, stderr).toEqual({ code: 1, signal: null });
      expect(stderr).toContain(`• ${expected}`);
      expect(stderr).not.toContain('CORS_ORIGINS');
      expect(stdout).toBe('');
    },
    EXIT_TIMEOUT_MS + 10_000,
  );

  describe('Redis kolejek z maxmemory-policy allkeys-lru', () => {
    let lruRedis: StartedTestContainer;

    beforeAll(async () => {
      lruRedis = await startRedis('allkeys-lru');
    });

    afterAll(async () => {
      await lruRedis.stop();
    });

    it('worker kończy start kodem 1 z wyjaśnieniem w logu', async () => {
      const started = start('src/worker.ts', {
        DATABASE_URL: database.url,
        REDIS_QUEUE_URL: redisUrlOf(lruRedis),
      });
      const exit = await waitForExit(started.child, 60_000);
      const { stdout, stderr } = started.output();

      expect(exit, stderr).toEqual({ code: 1, signal: null });
      const fatal = jsonLines(stdout).find((line) => line['level'] === 'fatal');
      expect(fatal?.['msg']).toBe('Nie udało się uruchomić workera');
      expect(JSON.stringify(fatal)).toContain('maxmemory-policy allkeys-lru');
      expect(stdout).not.toContain('Worker działa');
    }, 90_000);
  });

  it('poprawna konfiguracja: przekazuje eventy z outboxa, SIGTERM kończy proces bez błędów', async () => {
    const started = start('src/worker.ts', {
      DATABASE_URL: database.url,
      REDIS_QUEUE_URL: redisUrl(),
      QUEUE_PREFIX: uniqueQueuePrefix(),
      OUTBOX_POLL_INTERVAL_MS: '50',
    });
    await waitForOutput(started, 'Worker działa', 60_000);

    // Moduły domenowe nie mają jeszcze konsumentów: relay tylko oznacza event jako przekazany.
    const eventId = await commit('bez-konsumentow');
    await waitFor(async () => {
      const { rows } = await pool.query<{ published_at: Date | null }>(
        'select published_at from outbox where id = $1',
        [eventId],
      );
      return rows[0]?.published_at ?? undefined;
    }, 'oznaczenie eventu jako przekazanego');

    started.child.kill('SIGTERM');
    const exit = await waitForExit(started.child, 15_000);
    expect(exit.code === 0 || exit.signal === 'SIGTERM', JSON.stringify(exit)).toBe(true);

    const { stdout, stderr } = started.output();
    const logs = jsonLines(stdout);
    expect(logs.find((line) => String(line['msg']).startsWith('Worker działa'))).toMatchObject({
      service: 'biddy-worker',
      context: 'Worker',
    });
    expect(stdout).toContain('outbox.cleanup');
    expect(stdout).not.toMatch(/"level":"(error|fatal)"/);
    expect(stderr).toBe('');
  }, 90_000);
});

describe('awaria workera w trakcie joba (SIGKILL)', () => {
  it('przerwany job wraca do kolejki, a efekt konsumenta powstaje dokładnie raz', async () => {
    const config = workerConfig(database.url);
    const eventId = await commit('awaria', { hang: true });
    const fixture = start('test/integration/support/worker-fixture.ts', {
      DATABASE_URL: database.url,
      REDIS_QUEUE_URL: config.queues.redisUrl,
      QUEUE_PREFIX: config.queues.prefix,
      OUTBOX_POLL_INTERVAL_MS: '50',
    });

    // Pierwsza próba zapisała znacznik i zawisła z otwartą transakcją konsumenta.
    await waitFor(
      async () => {
        const { rowCount } = await pool.query('select 1 from test_markers where event_id = $1', [
          eventId,
        ]);
        return rowCount === 1;
      },
      'start pierwszej próby w procesie workera',
      60_000,
    );
    fixture.child.kill('SIGKILL');
    await waitForExit(fixture.child, 15_000);

    // Logi joba w procesie workera mają kontekst joba i eventu.
    const handled = jsonLines(fixture.output().stdout).find(
      (line) => line['msg'] === 'Obsługuję awaria',
    );
    expect(handled).toMatchObject({
      service: 'biddy-worker',
      context: 'TestItemConsumer',
      queue: 'domain-events',
      jobName: 'test.record-item',
      jobId: `test.record-item-${eventId}`,
      attempt: 1,
      consumer: 'test.record-item',
      eventId,
      eventType: 'TestItemCreated',
    });

    // Nowy worker (np. po restarcie instancji) przejmuje job po wygaśnięciu blokady.
    worker = await startTestWorker(config, { extraModules: [OutboxTestModule] });
    const effects = await waitFor(
      async () => {
        const { rows } = await pool.query<{ consumer: string }>(
          'select consumer from test_effects where event_id = $1 order by consumer',
          [eventId],
        );
        return rows.some((row) => row.consumer === 'test.record-item') ? rows : undefined;
      },
      'efekt konsumenta po przejęciu joba',
      30_000,
    );

    expect(effects.map((row) => row.consumer)).toEqual([
      'test.record-item',
      'test.second-consumer',
    ]);
    expect(worker.app.get(TestCalls).events.map((event) => event.id)).toEqual([eventId]);
  }, 120_000);
});

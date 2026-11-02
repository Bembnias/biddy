// Kryteria akceptacji F-04 dla outboxa na prawdziwym Postgresie i Redisie (Testcontainers):
// event z wycofanej transakcji nie jest publikowany, zatwierdzony trafia do konsumenta co
// najmniej raz (także gdy worker startuje później), konsument jest idempotentny, a nieudany
// konsument po wyczerpaniu prób trafia do dead-letter queue i do Sentry.
import { setTimeout as delay } from 'node:timers/promises';

import type * as SentryModule from '@sentry/nestjs';
import { PinoLogger } from 'nestjs-pino';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDatabase } from '../../src/infra/db/database.js';
import {
  DOMAIN_EVENTS_QUEUE,
  DeadLetterQueue,
  JobQueues,
  eventJobId,
} from '../../src/infra/queues/index.js';
import { Outbox } from '../../src/infra/outbox/index.js';
import { integrationConfig, startTestApp } from './support/app.js';
import type { ScratchDatabase } from './support/database.js';
import {
  OutboxHttpTestModule,
  OutboxTestModule,
  TEST_TABLES_SQL,
  TestCalls,
  TestItemCreated,
} from './support/outbox-test.module.js';
import {
  type TestWorker,
  createMigratedDatabase,
  startTestWorker,
  waitFor,
  workerConfig,
} from './support/worker.js';

const sentry = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock('@sentry/nestjs', async (importOriginal) => ({
  ...(await importOriginal<typeof SentryModule>()),
  captureException: sentry.captureException,
}));

let database: ScratchDatabase;
let pool: Pool;
let db: ReturnType<typeof createDatabase>;
/** Outbox poza aplikacją (np. gdy worker nie działa); bez kontekstu logów metadane są puste. */
const outbox = new Outbox({ logger: undefined } as unknown as PinoLogger);
let worker: TestWorker | undefined;

async function start(): Promise<TestWorker> {
  worker = await startTestWorker(workerConfig(database.url), {
    extraModules: [OutboxTestModule],
  });
  return worker;
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

async function effects(eventId?: string): Promise<{ event_id: string; consumer: string }[]> {
  const { rows } = await pool.query<{ event_id: string; consumer: string }>(
    eventId === undefined
      ? 'select event_id, consumer from test_effects order by created_at'
      : 'select event_id, consumer from test_effects where event_id = $1 order by created_at',
    eventId === undefined ? [] : [eventId],
  );
  return rows;
}

async function outboxRow(
  id: string,
): Promise<{ published_at: Date | null; metadata: unknown } | undefined> {
  const { rows } = await pool.query<{ published_at: Date | null; metadata: unknown }>(
    'select published_at, metadata from outbox where id = $1',
    [id],
  );
  return rows[0];
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
  sentry.captureException.mockClear();
  await pool.query('truncate outbox, processed_events, test_effects, test_markers');
});

afterEach(async () => {
  await worker?.close();
  worker = undefined;
});

describe('outbox → relay → konsumenci', () => {
  it('zatwierdzony event trafia do każdego konsumenta osobnym jobem, a relay oznacza go jako przekazany', async () => {
    const { app } = await start();
    const eventId = await commit('rower');

    const rows = await waitFor(async () => {
      const found = await effects(eventId);
      return found.length === 2 ? found : undefined;
    }, 'efekty obu konsumentów');
    expect(rows.map((row) => row.consumer).sort()).toEqual([
      'test.record-item',
      'test.second-consumer',
    ]);

    const row = await outboxRow(eventId);
    expect(row?.published_at).toBeInstanceOf(Date);

    // Każdy konsument ma własny job o ID {konsument}-{eventId}.
    const queue = app.get(JobQueues).queue(DOMAIN_EVENTS_QUEUE);
    const job = await queue.getJob(eventJobId('test.record-item', eventId));
    expect(job?.name).toBe('test.record-item');
    expect(job?.data).toMatchObject({
      id: eventId,
      type: 'TestItemCreated',
      version: 1,
      aggregateType: 'test-item',
      aggregateId: 'item-rower',
      payload: { title: 'rower', fail: 'never', hang: false },
    });
    expect(job?.returnvalue).toBe('processed');
  });

  it('event z wycofanej transakcji nie zostaje opublikowany', async () => {
    const { app } = await start();
    const calls = app.get(TestCalls);

    await expect(
      db.transaction(async (tx) => {
        await outbox.add(
          tx,
          TestItemCreated.create({ aggregateId: 'item-wycofany', payload: { title: 'wycofany' } }),
        );
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    // Zatwierdzony event po wycofanym: gdy dotrze, relay przeszedł już przez ten moment.
    const committed = await commit('zatwierdzony');

    await waitFor(async () => (await effects(committed)).length === 2, 'efekt zatwierdzonego');
    await delay(300);

    expect(calls.events.map((event) => event.payload.title)).toEqual(['zatwierdzony']);
    const { rows } = await pool.query<{ aggregate_id: string }>('select aggregate_id from outbox');
    expect(rows).toEqual([{ aggregate_id: 'item-zatwierdzony' }]);
  });

  it('event zatwierdzony, gdy worker nie działa, trafia do konsumenta po jego starcie', async () => {
    // Pierwszy worker działa i się zamyka (np. deploy); w tym czasie powstaje event.
    await start();
    await worker?.close();
    const eventId = await commit('w-trakcie-restartu');
    await delay(200);
    expect(await effects(eventId)).toEqual([]);
    expect((await outboxRow(eventId))?.published_at).toBeNull();

    await start();
    await waitFor(async () => (await effects(eventId)).length === 2, 'efekty po restarcie');
  });

  it('ponowne dostarczenie nie dubluje efektu: relay deduplikuje joby, a konsument pomija obsłużony event', async () => {
    const { app } = await start();
    const calls = app.get(TestCalls);
    const eventId = await commit('dwa-razy');
    await waitFor(async () => (await effects(eventId)).length === 2, 'pierwsze dostarczenie');

    // 1. Relay przekazuje event jeszcze raz (np. restart po addBulk, przed COMMIT): to samo ID joba.
    await pool.query('update outbox set published_at = null where id = $1', [eventId]);
    await waitFor(
      async () => ((await outboxRow(eventId))?.published_at ?? null) !== null,
      'ponowne przekazanie przez relay',
    );

    // 2. Ten sam event w nowym jobie (np. po wygaśnięciu starego joba): konsument go pomija.
    const queue = app.get(JobQueues).queue(DOMAIN_EVENTS_QUEUE);
    const original = await queue.getJob(eventJobId('test.record-item', eventId));
    const duplicate = await queue.add('test.record-item', original?.data, {
      jobId: `test.record-item-duplikat-${eventId}`,
    });
    const outcome = await waitFor(async () => {
      const job = await queue.getJob(duplicate.id ?? '');
      return (job?.returnvalue as string | null | undefined) ?? undefined;
    }, 'wynik duplikatu');

    expect(outcome).toBe('duplicate');
    expect(calls.events).toHaveLength(1);
    expect(await effects(eventId)).toHaveLength(2);
    const { rows } = await pool.query<{ consumer: string }>(
      'select consumer from processed_events where event_id = $1 order by consumer',
      [eventId],
    );
    expect(rows.map((row) => row.consumer)).toEqual(['test.record-item', 'test.second-consumer']);
  });
});

describe('nieudani konsumenci: ponowienia, dead-letter queue, Sentry', () => {
  it('po wyczerpaniu prób job trafia do DLQ i do Sentry; drugi konsument działa niezależnie', async () => {
    const { app } = await start();
    const calls = app.get(TestCalls);
    const eventId = await commit('psuje-sie', { fail: 'always' });

    const [deadLetter] = await waitFor(async () => {
      const list = await app.get(DeadLetterQueue).list();
      return list.length > 0 ? list : undefined;
    }, 'wpis w DLQ');

    // FAST_TUNING: 3 próby.
    expect(calls.attempts).toEqual([1, 2, 3]);
    expect(deadLetter?.entry).toMatchObject({
      queue: DOMAIN_EVENTS_QUEUE,
      jobId: eventJobId('test.record-item', eventId),
      jobName: 'test.record-item',
      attemptsMade: 3,
      failedReason: 'Celowy błąd konsumenta (próba 3)',
      data: { id: eventId, type: 'TestItemCreated' },
    });

    await waitFor(() => sentry.captureException.mock.calls.length > 0, 'zdarzenie Sentry');
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Celowy błąd konsumenta (próba 3)' }),
      expect.objectContaining({
        tags: { queue: DOMAIN_EVENTS_QUEUE, job_name: 'test.record-item' },
        contexts: {
          job: expect.objectContaining({
            jobId: eventJobId('test.record-item', eventId),
            consumer: 'test.record-item',
            eventId,
            eventType: 'TestItemCreated',
            deadLetterId: deadLetter?.id,
          }) as unknown,
        },
      }),
    );

    // Efekt w bazie tylko od drugiego konsumenta; nieudane próby pierwszego zostały wycofane.
    expect((await effects(eventId)).map((row) => row.consumer)).toEqual(['test.second-consumer']);
    const { rows } = await pool.query(
      `select 1 from processed_events where event_id = $1 and consumer = 'test.record-item'`,
      [eventId],
    );
    expect(rows).toEqual([]);
  });

  it('UnrecoverableError: bez ponowień, od razu DLQ', async () => {
    const { app } = await start();
    const calls = app.get(TestCalls);
    await commit('bez-sensu-ponawiac', { fail: 'unrecoverable' });

    await waitFor(async () => (await app.get(DeadLetterQueue).list()).length === 1, 'wpis w DLQ');
    expect(calls.attempts).toEqual([1]);
  });

  it('replay wpisu DLQ ponawia oryginalny job (po naprawie przyczyny), a wpis znika', async () => {
    const { app } = await start();
    const deadLetters = app.get(DeadLetterQueue);
    const eventId = await commit('naprawiony', { fail: 'always' });
    const [deadLetter] = await waitFor(async () => {
      const list = await deadLetters.list();
      return list.length > 0 ? list : undefined;
    }, 'wpis w DLQ');

    // „Naprawa”: event z tym samym ID, ale już bez błędu (np. poprawiony kod konsumenta).
    const queue = app.get(JobQueues).queue(DOMAIN_EVENTS_QUEUE);
    const failed = await queue.getJob(eventJobId('test.record-item', eventId));
    await failed?.updateData({
      ...(failed.data as Record<string, unknown>),
      payload: { title: 'naprawiony', fail: 'never', hang: false },
    });

    expect(await deadLetters.replay(deadLetter?.id ?? '')).toBe('retried');
    await waitFor(
      async () => (await effects(eventId)).some((row) => row.consumer === 'test.record-item'),
      'efekt po replay',
    );
    expect(await deadLetters.list()).toEqual([]);
  });
});

describe('metadane eventu', () => {
  it('Outbox.add w żądaniu HTTP zapisuje requestId żądania', async () => {
    const api = await startTestApp(integrationConfig({ DATABASE_URL: database.url }), [
      OutboxHttpTestModule,
    ]);
    try {
      const response = await api.http.inject({
        method: 'POST',
        url: '/v1/integration-test/items',
        headers: { 'x-request-id': 'req-outbox-1' },
        payload: { title: 'z-http' },
      });
      expect(response.statusCode, response.body).toBe(201);
      const { eventId } = response.json<{ eventId: string }>();

      expect((await outboxRow(eventId))?.metadata).toEqual({ requestId: 'req-outbox-1' });
    } finally {
      await api.close();
    }
  });

  it('Outbox.add w kontekście joba zapisuje requestId i causationId (event wywołany eventem)', async () => {
    const { app } = await start();
    const appOutbox = app.get(Outbox);
    const pino = await app.resolve(PinoLogger);

    const [id] = await pino.runInContext(
      () =>
        db.transaction((tx) =>
          appOutbox.add(
            tx,
            TestItemCreated.create({ aggregateId: 'item-meta', payload: { title: 'meta' } }),
          ),
        ),
      { bindings: { requestId: 'req-123', eventId: '0199d0a0-0000-7000-8000-000000000001' } },
    );

    expect((await outboxRow(id ?? ''))?.metadata).toEqual({
      requestId: 'req-123',
      causationId: '0199d0a0-0000-7000-8000-000000000001',
    });
  });
});

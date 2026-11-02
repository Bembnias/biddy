// Kryteria akceptacji F-04 dla kolejek na prawdziwym Redisie (Testcontainers): ponowne
// zaplanowanie joba na nowy termin z wnętrza wykonującego się joba, DLQ i Sentry po N nieudanych
// próbach, joby cykliczne (harmonogramy BullMQ) i odmowa startu workera, gdy Redis kolejek nie
// ma maxmemory-policy noeviction.
import { setTimeout as delay } from 'node:timers/promises';

import type * as SentryModule from '@sentry/nestjs';
import type { StartedTestContainer } from 'testcontainers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorker } from '../../src/create-worker.js';
import type { AppConfig } from '../../src/infra/config/index.js';
import {
  DeadLetterQueue,
  EvictionPolicyError,
  JobQueues,
  createQueueRedis,
  closeQueueRedis,
  deadlineJobId,
} from '../../src/infra/queues/index.js';
import { redisUrlOf, startRedis } from './global-setup.js';
import type { ScratchDatabase } from './support/database.js';
import { OutboxTestModule, TestCalls, TestJobs } from './support/outbox-test.module.js';
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
let worker: TestWorker | undefined;

async function start(config: AppConfig = workerConfig(database.url)): Promise<TestWorker> {
  worker = await startTestWorker(config, { extraModules: [OutboxTestModule] });
  return worker;
}

beforeAll(async () => {
  database = await createMigratedDatabase();
});

afterAll(async () => {
  await database.drop();
});

beforeEach(() => {
  sentry.captureException.mockClear();
});

afterEach(async () => {
  await worker?.close();
  worker = undefined;
});

describe('joby z terminem (PROJECT.md §15.2)', () => {
  it('job przesuwa termin z własnego wnętrza: nowy job z ID nowego terminu wykonuje się po nim', async () => {
    const { app } = await start();
    const queues = app.get(JobQueues);
    const calls = app.get(TestCalls);
    const entityId = 'aukcja-1';
    const first = Date.now() + 300;
    const extended = first + 700;
    // Oferta w ostatniej chwili: gdy job pierwszego terminu ruszy, termin jest już późniejszy.
    app.get(TestJobs).extendOnFirstRun.set(entityId, extended);

    const firstId = deadlineJobId('test-deadline', entityId, first);
    const added = await queues.add(
      'maintenance',
      'test.deadline',
      { entityId, deadline: first },
      { jobId: firstId, runAt: new Date(first) },
    );
    // Ten sam termin dodany drugi raz (np. ponowiony event) to ten sam job.
    const again = await queues.add(
      'maintenance',
      'test.deadline',
      { entityId, deadline: first },
      { jobId: firstId, runAt: new Date(first) },
    );
    expect([added, again]).toEqual([firstId, firstId]);

    const runs = () => calls.jobs.filter((job) => job.name === 'test.deadline');
    await waitFor(() => runs().length === 2, 'drugie wykonanie (nowy termin)');
    await delay(300);

    const extendedId = deadlineJobId('test-deadline', entityId, extended);
    expect(runs().map((job) => job.id)).toEqual([firstId, extendedId]);
    const queue = queues.queue('maintenance');
    const [firstJob, extendedJob] = await Promise.all([
      queue.getJob(firstId),
      queue.getJob(extendedId),
    ]);
    expect(firstJob?.returnvalue).toBe('rescheduled');
    expect(extendedJob?.returnvalue).toBe('done');
    // Nowy job nie ruszył przed nowym terminem.
    expect(extendedJob?.processedOn).toBeGreaterThanOrEqual(extended);
  });

  it('stałe ID (antywzorzec): dodanie joba o ID wykonującego się joba jest pomijane', async () => {
    const { app } = await start();
    const calls = app.get(TestCalls);
    const queue = app.get(JobQueues).queue('maintenance');
    await app
      .get(JobQueues)
      .add('maintenance', 'test.same-id', { entityId: 'e-1' }, { jobId: 'same-e-1' });

    await waitFor(
      async () =>
        ((await queue.getJob('same-e-1'))?.returnvalue as string | null | undefined) ?? undefined,
      'pierwsze wykonanie',
    );
    await delay(600);

    expect(calls.jobs.filter((job) => job.name === 'test.same-id')).toHaveLength(1);
    expect((await queue.getJob('same-e-1'))?.returnvalue).toBe('added:same-e-1');
  });
});

describe('nieudane joby: dead-letter queue i Sentry', () => {
  it('job, który zawiódł N razy, trafia do DLQ, zostaje w zbiorze failed i generuje zdarzenie w Sentry', async () => {
    const { app } = await start();
    const calls = app.get(TestCalls);
    const jobId = await app
      .get(JobQueues)
      .add('maintenance', 'test.always-fails', { powód: 'test' }, { jobId: 'zawsze-zle-1' });

    const [deadLetter] = await waitFor(async () => {
      const list = await app.get(DeadLetterQueue).list();
      return list.length > 0 ? list : undefined;
    }, 'wpis w DLQ');

    expect(calls.jobs.map((job) => [job.attempt, job.maxAttempts])).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect(deadLetter?.entry).toMatchObject({
      queue: 'maintenance',
      jobId,
      jobName: 'test.always-fails',
      data: { powód: 'test' },
      attemptsMade: 3,
      failedReason: 'Celowy błąd joba (próba 3 z 3)',
    });
    expect(deadLetter?.entry.stacktrace.length).toBeGreaterThan(0);
    expect(await app.get(JobQueues).queue('maintenance').getJob(jobId)).toMatchObject({
      failedReason: 'Celowy błąd joba (próba 3 z 3)',
    });
    expect(await (await app.get(JobQueues).queue('maintenance').getJob(jobId))?.getState()).toBe(
      'failed',
    );

    await waitFor(() => sentry.captureException.mock.calls.length === 1, 'zdarzenie Sentry');
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Celowy błąd joba (próba 3 z 3)' }),
      expect.objectContaining({
        tags: { queue: 'maintenance', job_name: 'test.always-fails' },
      }),
    );
  });

  it('job bez handlera (np. z nowszej wersji aplikacji) trafia od razu do DLQ', async () => {
    const { app } = await start();
    await app.get(JobQueues).add('maintenance', 'test.no-handler', {});

    const [deadLetter] = await waitFor(async () => {
      const list = await app.get(DeadLetterQueue).list();
      return list.length > 0 ? list : undefined;
    }, 'wpis w DLQ');
    expect(deadLetter?.entry).toMatchObject({
      jobName: 'test.no-handler',
      attemptsMade: 1,
      failedReason: 'Worker nie ma handlera dla joba „test.no-handler” w kolejce maintenance',
    });
  });
});

describe('joby cykliczne (@ScheduledJob)', () => {
  it('worker rejestruje harmonogramy z kodu, usuwa nieaktualne, a job wykonuje się co `every`', async () => {
    const config = workerConfig(database.url);
    // Harmonogram z poprzedniej wersji aplikacji (np. usunięty sweeper).
    const previous = await start(config);
    await previous.app
      .get(JobQueues)
      .queue('maintenance')
      .upsertJobScheduler('old.sweeper', { every: 60_000 }, { name: 'old.sweeper' });
    await previous.close();

    const { app } = await start(config);
    const schedulers = await app.get(JobQueues).queue('maintenance').getJobSchedulers();
    expect(schedulers.map((scheduler) => scheduler.key).sort()).toEqual([
      'identity.login-failures-cleanup',
      'identity.phone-verifications-cleanup',
      'ledger.verify-integrity',
      'media.orphans-cleanup',
      'outbox.cleanup',
      'test.tick',
    ]);
    expect(schedulers.find((scheduler) => scheduler.key === 'test.tick')?.every).toBe(1_000);

    const calls = app.get(TestCalls);
    await waitFor(() => calls.ticks.length >= 2, 'dwa wykonania joba cyklicznego', 5_000);
    expect(calls.ticks.every((tick) => tick.maxAttempts === 1)).toBe(true);
  });
});

describe('start workera', () => {
  let lruRedis: StartedTestContainer;

  beforeAll(async () => {
    lruRedis = await startRedis('allkeys-lru');
  });

  afterAll(async () => {
    await lruRedis.stop();
  });

  it('nie startuje, gdy Redis kolejek ma politykę inną niż noeviction (i niczego w nim nie zapisuje)', async () => {
    const url = redisUrlOf(lruRedis);
    const start = createWorker(workerConfig(database.url, { REDIS_QUEUE_URL: url }), {
      extraModules: [OutboxTestModule],
    });

    await expect(start).rejects.toThrow(EvictionPolicyError);
    await expect(start).rejects.toThrow(/maxmemory-policy allkeys-lru/);

    const redis = createQueueRedis(url, 'producer');
    try {
      expect(await redis.keys('*')).toEqual([]);
    } finally {
      await closeQueueRedis(redis);
    }
  });

  it('nie zawiesza się, gdy Redis kolejek nie odpowiada', async () => {
    const startedAt = Date.now();
    await expect(
      createWorker(workerConfig(database.url, { REDIS_QUEUE_URL: 'redis://127.0.0.1:1' })),
    ).rejects.toThrow();
    expect(Date.now() - startedAt).toBeLessThan(15_000);
  });
});

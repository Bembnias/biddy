// Worker w procesie testu: createWorker z konfiguracją wskazującą na kontenery z globalSetup.
// Każdy plik testów dostaje własną bazę (po migracjach), a każdy worker własny prefiks kluczy
// BullMQ, więc relay jednego testu nie zabiera eventów innego, a workery nie przejmują
// cudzych jobów.
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Writable } from 'node:stream';

import type { DynamicModule, INestApplicationContext, Type } from '@nestjs/common';
import { inject } from 'vitest';

import { createWorker } from '../../../src/create-worker.js';
import { type AppConfig, loadConfig } from '../../../src/infra/config/index.js';
import { runMigrations } from '../../../src/infra/db/index.js';
import type { QueueTuning } from '../../../src/infra/queues/index.js';
import { createScratchDatabase, type ScratchDatabase } from './database.js';

/** Adres Redisa kolejek z globalSetup (noeviction). */
export function redisUrl(): string {
  return inject('redisUrl');
}

/** Unikalny prefiks kluczy BullMQ dla jednego workera albo testu. */
export function uniqueQueuePrefix(): string {
  return `test-${randomUUID().slice(0, 8)}`;
}

/** Osobna baza z migracjami (outbox, processed_events) dla jednego pliku testów. */
export async function createMigratedDatabase(): Promise<ScratchDatabase> {
  const database = await createScratchDatabase();
  try {
    await runMigrations(database.url);
  } catch (error) {
    await database.drop();
    throw error;
  }
  return database;
}

/** Konfiguracja workera (ta sama walidacja co przy starcie) z szybkim relayem outboxa. */
export function workerConfig(databaseUrl: string, env: Record<string, string> = {}): AppConfig {
  return loadConfig(
    {
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      REDIS_QUEUE_URL: redisUrl(),
      QUEUE_PREFIX: uniqueQueuePrefix(),
      OUTBOX_POLL_INTERVAL_MS: '50',
      LOG_LEVEL: 'debug',
      ...env,
    },
    'worker',
  );
}

/**
 * Szybkie ponowienia w testach: 3 próby co 50 ms zamiast 10 prób z backoffem wykładniczym.
 * Krótsza blokada joba, żeby job po „zabiciu” workera wracał do kolejki w sekundy.
 */
export const FAST_TUNING: QueueTuning = {
  jobOptions: { attempts: 3, backoff: { type: 'fixed', delay: 50 } },
  lockDurationMs: 2_000,
  stalledIntervalMs: 500,
};

export interface TestWorker {
  readonly app: INestApplicationContext;
  readonly config: AppConfig;
  /** Linie logów (JSON) zapisane dotąd przez worker. */
  logLines(): Record<string, unknown>[];
  close(): Promise<void>;
}

export async function startTestWorker(
  config: AppConfig,
  options: {
    readonly extraModules?: readonly (Type | DynamicModule)[];
    readonly tuning?: QueueTuning;
  } = {},
): Promise<TestWorker> {
  const chunks: string[] = [];
  const logDestination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const app = await createWorker(config, {
    logDestination,
    tuning: options.tuning ?? FAST_TUNING,
    ...(options.extraModules === undefined ? {} : { extraModules: options.extraModules }),
  });
  let closed = false;
  return {
    app,
    config,
    logLines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    close: async () => {
      if (!closed) {
        closed = true;
        await app.close();
      }
    },
  };
}

/** Czeka, aż `check` zwróci wartość różną od undefined/false; po `timeoutMs` rzuca błąd. */
export async function waitFor<T>(
  check: () => Promise<T | undefined | false> | T | undefined | false,
  description: string,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result !== undefined && result !== false) {
      return result;
    }
    if (Date.now() > deadline) {
      throw new Error(`Nie doczekano się w ${timeoutMs} ms: ${description}`);
    }
    await delay(50);
  }
}

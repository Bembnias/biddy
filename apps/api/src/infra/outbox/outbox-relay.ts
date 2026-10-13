// Relay outboxa (ADR-4): w procesie workera przekazuje zatwierdzone eventy z tabeli `outbox` do
// kolejki `domain-events`, po jednym jobie na konsumenta. Porcja to jedna transakcja:
// SELECT … FOR UPDATE SKIP LOCKED, dodanie jobów, oznaczenie wierszy jako przekazanych. Kilka
// instancji workera nie bierze tych samych wierszy, a awaria w trakcie porcji (np. restart
// po dodaniu jobów, przed COMMIT) kończy się ponownym przekazaniem: ID jobów (eventJobId)
// zapobiega dublom, a konsumenci i tak są idempotentni.
import { setTimeout as sleep } from 'node:timers/promises';

import { Logger } from '@nestjs/common';
import { captureException } from '@sentry/nestjs';
import { asc, inArray, isNull, sql } from 'drizzle-orm';

import type { Database } from '../db/index.js';
import { DOMAIN_EVENTS_QUEUE, type JobQueues, eventJobId } from '../queues/index.js';
import { outbox } from './db/outbox.schema.js';
import type { DomainEvent } from './domain-event.js';
import type { EventSubscriptions } from './event-consumers.js';

export interface OutboxRelayOptions {
  /** Co ile sprawdzać nowe eventy, gdy ostatnia porcja nie była pełna. */
  readonly pollIntervalMs: number;
  /** Ile eventów w jednej porcji (transakcji). */
  readonly batchSize?: number;
  /** Górny limit odstępu między próbami po błędach (backoff wykładniczy). */
  readonly maxBackoffMs?: number;
}

export const DEFAULT_RELAY_BATCH_SIZE = 100;
export const DEFAULT_RELAY_MAX_BACKOFF_MS = 30_000;

type OutboxRow = typeof outbox.$inferSelect;

export function toDomainEvent(row: OutboxRow): DomainEvent {
  return {
    id: row.id,
    type: row.type,
    version: row.version,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    occurredAt: row.occurredAt.toISOString(),
    payload: row.payload,
    metadata: row.metadata,
  };
}

/** Odstęp przed kolejną porcją po `failures` nieudanych z rzędu. */
export function relayBackoff(failures: number, pollIntervalMs: number, maxBackoffMs: number) {
  return Math.min(pollIntervalMs * 2 ** failures, maxBackoffMs);
}

export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);
  private readonly batchSize: number;
  private readonly maxBackoffMs: number;
  private abort: AbortController | undefined;
  private loop: Promise<void> | undefined;

  constructor(
    private readonly db: Database,
    private readonly queues: JobQueues,
    private readonly subscriptions: EventSubscriptions,
    private readonly options: OutboxRelayOptions,
  ) {
    this.batchSize = options.batchSize ?? DEFAULT_RELAY_BATCH_SIZE;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_RELAY_MAX_BACKOFF_MS;
  }

  /** Uruchamia pętlę relaya w tle. */
  start(): void {
    if (this.loop !== undefined) {
      return;
    }
    this.abort = new AbortController();
    this.loop = this.run(this.abort.signal);
  }

  /** Zatrzymuje pętlę i czeka na koniec trwającej porcji. */
  async stop(): Promise<void> {
    this.abort?.abort();
    await this.loop;
    this.loop = undefined;
    this.abort = undefined;
  }

  /**
   * Przekazuje jedną porcję nieprzekazanych eventów do kolejki. Zwraca liczbę eventów
   * oznaczonych jako przekazane (także tych bez konsumentów).
   */
  async relayBatch(): Promise<number> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(outbox)
        .where(isNull(outbox.publishedAt))
        .orderBy(asc(outbox.id))
        .limit(this.batchSize)
        .for('update', { skipLocked: true });
      if (rows.length === 0) {
        return 0;
      }
      const jobs = rows.flatMap((row) =>
        (this.subscriptions.get(row.type) ?? []).map((consumer) => ({
          name: consumer,
          data: toDomainEvent(row),
          opts: { jobId: eventJobId(consumer, row.id) },
        })),
      );
      if (jobs.length > 0) {
        await this.queues.queue(DOMAIN_EVENTS_QUEUE).addBulk(jobs);
      }
      await tx
        .update(outbox)
        .set({ publishedAt: sql`now()` })
        .where(
          inArray(
            outbox.id,
            rows.map((row) => row.id),
          ),
        );
      this.logger.debug(
        `Przekazano ${rows.length} eventów do kolejki (${jobs.length} jobów konsumentów)`,
      );
      return rows.length;
    });
  }

  private async run(signal: AbortSignal): Promise<void> {
    let failures = 0;
    while (!signal.aborted) {
      let delay = this.options.pollIntervalMs;
      try {
        const relayed = await this.relayBatch();
        if (failures > 0) {
          this.logger.log(`Relay outboxa działa ponownie po ${failures} nieudanych próbach`);
        }
        failures = 0;
        // Pełna porcja: w outboxie mogą czekać kolejne eventy, więc bez przerwy.
        if (relayed === this.batchSize) {
          delay = 0;
        }
      } catch (error) {
        failures += 1;
        delay = relayBackoff(failures, this.options.pollIntervalMs, this.maxBackoffMs);
        this.logger.error(
          { err: error, failures },
          `Relay outboxa: porcja nie powiodła się (${failures} z rzędu), ponowienie za ${delay} ms`,
        );
        // Do Sentry tylko początek serii błędów, nie każda próba (np. przy awarii Redisa).
        if (failures === 1) {
          captureException(error, { tags: { component: 'outbox-relay' } });
        }
      }
      if (delay > 0 && !signal.aborted) {
        await sleep(delay, undefined, { signal }).catch(() => undefined);
      }
    }
  }
}

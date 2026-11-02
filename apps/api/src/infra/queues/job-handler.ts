// Dekoratory handlerów jobów. Moduł domenowy oznacza metodę providera, a worker (src/worker.ts)
// znajduje ją przy starcie (JobHandlerExplorer) i uruchamia przetwarzanie kolejki. API ich nie
// wykonuje: w procesie HTTP dekoratory są tylko metadanymi.
import { SetMetadata } from '@nestjs/common';

import type { QueueName } from './queue-catalog.js';

/** Nazwa joba: segmenty z małych liter, cyfr i `-` rozdzielone kropką, np. `auction.close`. */
export const JOB_NAME_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

/** Uruchomienie joba widziane przez handler (bez zależności od typów BullMQ). */
export interface JobRun<TData = unknown> {
  readonly id: string;
  readonly name: string;
  readonly queue: QueueName;
  readonly data: TData;
  /** Numer bieżącej próby, od 1. */
  readonly attempt: number;
  /** Ile prób job ma łącznie; po ostatniej nieudanej trafia do dead-letter queue. */
  readonly maxAttempts: number;
}

/**
 * Harmonogram joba cyklicznego: co `every` milisekund albo według wyrażenia cron (`pattern`,
 * strefa Europe/Warsaw), np. `0 3 * * *` (codziennie o 3:00).
 */
export type JobSchedule = { readonly every: number } | { readonly pattern: string };

export interface JobHandlerMetadata {
  readonly queue: QueueName;
  readonly name: string;
  readonly schedule?: JobSchedule;
}

export const JOB_HANDLER_METADATA = 'biddy:job-handler';

export class InvalidJobHandlerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidJobHandlerError';
  }
}

function assertJobName(name: string): void {
  if (!JOB_NAME_PATTERN.test(name)) {
    throw new InvalidJobHandlerError(
      `Niepoprawna nazwa joba „${name}”: oczekiwano segmentów rozdzielonych kropką, np. auction.close`,
    );
  }
}

/**
 * Handler jobów `name` w kolejce `queue`. Metoda dostaje {@link JobRun}; wyjątek oznacza nieudaną
 * próbę (ponowienie z backoffem, po ostatniej próbie dead-letter queue). Błąd, którego
 * ponawianie nie ma sensu (np. niepoprawne dane), zgłoś jako UnrecoverableError z bullmq.
 *
 * Handler musi być idempotentny: job może się wykonać ponownie (po restarcie workera albo gdy
 * zakończenie próby nie dotarło do Redisa). Joby z terminem sprawdzają aktualny stan encji
 * (PROJECT.md §15.2–15.3), więc nieaktualny job jest no-op.
 *
 * @example
 * @JobHandler('auctions', 'auction.close')
 * async close(job: JobRun<{ auctionId: string }>): Promise<void> { … }
 */
export function JobHandler(queue: QueueName, name: string): MethodDecorator {
  assertJobName(name);
  return SetMetadata<string, JobHandlerMetadata>(JOB_HANDLER_METADATA, { queue, name });
}

export type ScheduledJobOptions = {
  readonly queue: QueueName;
  readonly name: string;
} & JobSchedule;

/**
 * Job cykliczny (np. sweeper aukcji co 10 s, PROJECT.md §15.2): worker rejestruje harmonogram
 * w BullMQ (job scheduler o ID równym nazwie joba) i usuwa harmonogramy, których nie ma już
 * w kodzie. Kolejne wykonania tworzy BullMQ, więc przy kilku instancjach workera każde
 * wykonanie trafia do jednej z nich.
 *
 * Nieudane wykonanie nie trafia do dead-letter queue (następne i tak przyjdzie za chwilę), ale
 * zgłaszamy je do Sentry.
 */
export function ScheduledJob(options: ScheduledJobOptions): MethodDecorator {
  assertJobName(options.name);
  const schedule: JobSchedule =
    'every' in options ? { every: options.every } : { pattern: options.pattern };
  if ('every' in schedule && (!Number.isSafeInteger(schedule.every) || schedule.every < 1_000)) {
    throw new InvalidJobHandlerError(
      `Job cykliczny „${options.name}”: every musi być liczbą całkowitą milisekund ≥ 1000`,
    );
  }
  return SetMetadata<string, JobHandlerMetadata>(JOB_HANDLER_METADATA, {
    queue: options.queue,
    name: options.name,
    schedule,
  });
}

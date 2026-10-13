// Przetwarzanie kolejek w procesie workera: jeden Worker BullMQ na kolejkę, która ma handlery.
// Każdy job wykonuje się w kontekście logów z polami joba (queue, jobId, jobName, attempt), więc
// logi z kodu modułu da się powiązać z jobem. Po ostatniej nieudanej próbie job trafia do
// dead-letter queue, a błąd do Sentry.
import { Logger } from '@nestjs/common';
import { captureException } from '@sentry/nestjs';
import { type Job, UnrecoverableError, Worker } from 'bullmq';
import type { Redis } from 'ioredis';

import type { DeadLetterQueue } from './dead-letter.js';
import type { JobRun, JobSchedule } from './job-handler.js';
import { QUEUE_DEFINITIONS, type QueueName } from './queue-catalog.js';

/** Handler joba gotowy do uruchomienia przez worker. */
export interface RegisteredJobHandler {
  readonly queue: QueueName;
  readonly name: string;
  readonly schedule?: JobSchedule;
  /** Skąd pochodzi handler (Klasa.metoda), do komunikatów o błędach. */
  readonly source: string;
  readonly handle: (job: Job) => Promise<unknown>;
  /** Dodatkowe pola logów i kontekstu Sentry dla joba, np. eventId i eventType. */
  readonly bindings?: (job: Job) => Readonly<Record<string, unknown>>;
}

/** Parametry workerów BullMQ, które testy skracają (np. wykrywanie zawieszonych jobów). */
export interface WorkerTuning {
  /** Czas blokady joba; po jej wygaśnięciu (np. proces zginął) job wraca do kolejki. */
  readonly lockDurationMs?: number;
  /** Co ile worker szuka zawieszonych jobów (blokada wygasła, job nadal aktywny). */
  readonly stalledIntervalMs?: number;
}

/** Uruchamia `fn` w kontekście logów z podanymi polami (PinoLogger.runInContext). */
export type RunInLogContext = <T>(bindings: Record<string, unknown>, fn: () => T) => T;

export interface QueueWorkersOptions {
  readonly connection: Redis;
  readonly prefix: string;
  readonly deadLetters: DeadLetterQueue;
  readonly runInLogContext: RunInLogContext;
  readonly tuning?: WorkerTuning;
}

export class DuplicateJobHandlerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateJobHandlerError';
  }
}

/** Widok joba dla handlera modułu (bez typów BullMQ). */
export function toJobRun<TData>(queue: QueueName, job: Job): JobRun<TData> {
  return {
    id: job.id ?? '',
    name: job.name,
    queue,
    data: job.data as TData,
    // W trakcie wykonywania attemptsMade to liczba zakończonych wcześniej prób.
    attempt: job.attemptsMade + 1,
    maxAttempts: job.opts.attempts ?? 1,
  };
}

export function isUnrecoverable(error: Error): boolean {
  return error instanceof UnrecoverableError || error.name === 'UnrecoverableError';
}

/**
 * Czy to była ostatnia próba (w zdarzeniu `failed`, po zapisaniu porażki). BullMQ nie ponawia
 * UnrecoverableError, a po każdej próbie zwiększa attemptsMade.
 */
export function isFinalFailure(job: Pick<Job, 'attemptsMade' | 'opts'>, error: Error): boolean {
  return isUnrecoverable(error) || job.attemptsMade >= (job.opts.attempts ?? 1);
}

/** Handlery pogrupowane według kolejki; ta sama para kolejka + nazwa joba dwa razy to błąd. */
export function groupHandlers(
  handlers: readonly RegisteredJobHandler[],
): Map<QueueName, Map<string, RegisteredJobHandler>> {
  const byQueue = new Map<QueueName, Map<string, RegisteredJobHandler>>();
  for (const handler of handlers) {
    const byName = byQueue.get(handler.queue) ?? new Map<string, RegisteredJobHandler>();
    const existing = byName.get(handler.name);
    if (existing !== undefined) {
      throw new DuplicateJobHandlerError(
        `Job „${handler.name}” w kolejce ${handler.queue} ma dwa handlery: ${existing.source} i ${handler.source}`,
      );
    }
    byName.set(handler.name, handler);
    byQueue.set(handler.queue, byName);
  }
  return byQueue;
}

export class QueueWorkers {
  private readonly logger = new Logger(QueueWorkers.name);
  private readonly workers: Worker[] = [];
  /** Trwające zapisy do DLQ: zamknięcie czeka, aż się skończą. */
  private readonly pendingFailures = new Set<Promise<void>>();

  constructor(private readonly options: QueueWorkersOptions) {}

  /** Nazwy kolejek, które ten proces przetwarza. */
  get queues(): QueueName[] {
    return this.workers.map((worker) => worker.name as QueueName);
  }

  /** Tworzy i uruchamia workery BullMQ (po jednym na kolejkę z handlerami). */
  async start(handlers: readonly RegisteredJobHandler[]): Promise<void> {
    const { connection, prefix, tuning = {} } = this.options;
    for (const [queue, byName] of groupHandlers(handlers)) {
      const worker = new Worker(queue, (job) => this.process(queue, byName, job), {
        connection,
        prefix,
        concurrency: QUEUE_DEFINITIONS[queue].concurrency,
        ...(tuning.lockDurationMs === undefined ? {} : { lockDuration: tuning.lockDurationMs }),
        ...(tuning.stalledIntervalMs === undefined
          ? {}
          : { stalledInterval: tuning.stalledIntervalMs }),
      });
      worker.on('failed', (job, error) => {
        if (job === undefined) {
          this.logger.error({ err: error, queue }, 'Job nie powiódł się (BullMQ nie podał joba)');
          return;
        }
        const pending = this.handleFailure(queue, byName.get(job.name), job, error).catch(
          (handlingError: unknown) => {
            this.logger.error(
              { err: handlingError, queue, jobId: job.id },
              'Nie udało się obsłużyć nieudanego joba (dead-letter queue, Sentry)',
            );
          },
        );
        this.pendingFailures.add(pending);
        void pending.finally(() => this.pendingFailures.delete(pending));
      });
      worker.on('stalled', (jobId) => {
        this.logger.warn(
          { queue, jobId },
          'Job zawieszony (worker przestał przedłużać blokadę, np. proces zginął): wraca do kolejki',
        );
      });
      worker.on('error', (error) => {
        this.logger.error({ err: error, queue }, `Błąd workera kolejki ${queue}`);
      });
      this.workers.push(worker);
    }
    await Promise.all(this.workers.map((worker) => worker.waitUntilReady()));
  }

  /**
   * Zatrzymuje workery: nie pobierają nowych jobów, trwające joby kończą się, a zapisy do DLQ
   * zostają dokończone. Job przerwany przez SIGKILL wróci do kolejki po wygaśnięciu blokady.
   */
  async stop(): Promise<void> {
    const workers = this.workers.splice(0);
    await Promise.all(workers.map((worker) => worker.close()));
    await Promise.all([...this.pendingFailures]);
  }

  private async process(
    queue: QueueName,
    handlers: ReadonlyMap<string, RegisteredJobHandler>,
    job: Job,
  ): Promise<unknown> {
    const handler = handlers.get(job.name);
    if (handler === undefined) {
      // Np. job dodany przez nowszą wersję aplikacji w trakcie wdrożenia: trafi do DLQ i da się
      // go ponowić, gdy wszystkie instancje będą miały handler.
      throw new UnrecoverableError(
        `Worker nie ma handlera dla joba „${job.name}” w kolejce ${queue}`,
      );
    }
    const bindings = {
      queue,
      jobId: job.id,
      jobName: job.name,
      attempt: job.attemptsMade + 1,
      ...handler.bindings?.(job),
    };
    return this.options.runInLogContext(bindings, () => handler.handle(job));
  }

  private async handleFailure(
    queue: QueueName,
    handler: RegisteredJobHandler | undefined,
    job: Job,
    error: Error,
  ): Promise<void> {
    const maxAttempts = job.opts.attempts ?? 1;
    const fields = {
      queue,
      jobId: job.id,
      jobName: job.name,
      attempt: job.attemptsMade,
      maxAttempts,
      ...handler?.bindings?.(job),
    };
    if (!isFinalFailure(job, error)) {
      this.logger.warn(
        { ...fields, err: error },
        `Job ${job.name} nie powiódł się (próba ${job.attemptsMade} z ${maxAttempts}), ponowienie z backoffem`,
      );
      return;
    }
    const sentryContext = { tags: { queue, job_name: job.name }, contexts: { job: fields } };
    if (job.repeatJobKey !== undefined) {
      // Wykonanie joba cyklicznego: nie do DLQ, następne przyjdzie zgodnie z harmonogramem.
      this.logger.error({ ...fields, err: error }, `Job cykliczny ${job.name} nie powiódł się`);
      captureException(error, sentryContext);
      return;
    }
    const deadLetterId = await this.options.deadLetters.add(job, error);
    this.logger.error(
      { ...fields, deadLetterId, err: error },
      `Job ${job.name} wyczerpał próby (${job.attemptsMade} z ${maxAttempts}): przeniesiony do dead-letter queue`,
    );
    captureException(error, {
      ...sentryContext,
      contexts: { job: { ...fields, deadLetterId } },
    });
  }
}

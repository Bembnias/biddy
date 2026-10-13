import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { type Database, DRIZZLE } from '../db/index.js';
import {
  DOMAIN_EVENT_HANDLER_METADATA,
  type DomainEventHandlerMetadata,
  OutboxRelay,
  eventConsumerHandler,
  eventSubscriptions,
} from '../outbox/index.js';
import {
  DeadLetterQueue,
  JobHandlerExplorer,
  JobQueues,
  QUEUE_REDIS,
  QUEUE_TUNING,
  type QueueName,
  QueueWorkers,
  type QueueTuning,
  assertNoEviction,
  closeQueueRedis,
  syncJobSchedules,
} from '../queues/index.js';

/** Token DI połączenia z Redisem kolejek dla workerów BullMQ (maxRetriesPerRequest = null). */
export const WORKER_REDIS = Symbol('WORKER_REDIS');

/** Limit czasu sprawdzenia Redisa przy starcie: worker ma się zatrzymać, a nie wisieć. */
export const STARTUP_CHECK_TIMEOUT_MS = 10_000;

/** Co uruchomił worker (log startowy i testy). */
export interface WorkerSummary {
  readonly queues: readonly QueueName[];
  readonly consumers: readonly string[];
  readonly scheduledJobs: readonly string[];
}

export class WorkerStartupError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WorkerStartupError';
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new WorkerStartupError(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Przetwarzanie w procesie workera (PROJECT.md §10.4). {@link start} kolejno:
 * 1. sprawdza, że Redis kolejek ma maxmemory-policy noeviction (inaczej worker nie startuje),
 * 2. zbiera handlery jobów (@JobHandler, @ScheduledJob) i konsumentów eventów (@OnDomainEvent),
 * 3. uruchamia workery BullMQ dla kolejek, które mają handlery,
 * 4. synchronizuje harmonogramy jobów cyklicznych,
 * 5. uruchamia relay outboxa.
 * Przy zamykaniu aplikacji zatrzymuje relay, potem workery (trwające joby się kończą).
 */
@Injectable()
export class WorkerRuntime implements BeforeApplicationShutdown, OnApplicationShutdown {
  private readonly logger = new Logger('Worker');
  private workers: QueueWorkers | undefined;
  private relay: OutboxRelay | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(QUEUE_REDIS) private readonly producerRedis: Redis,
    @Inject(WORKER_REDIS) private readonly workerRedis: Redis,
    @Inject(QUEUE_TUNING) private readonly tuning: QueueTuning,
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly queues: JobQueues,
    private readonly deadLetters: DeadLetterQueue,
    private readonly explorer: JobHandlerExplorer,
    private readonly pino: PinoLogger,
  ) {}

  async start(): Promise<WorkerSummary> {
    // Połączenie producenta kończy komendę błędem po kilku nieudanych próbach połączenia,
    // więc niedostępny Redis zatrzymuje start zamiast go zawieszać.
    await withTimeout(
      assertNoEviction(this.producerRedis),
      STARTUP_CHECK_TIMEOUT_MS,
      `Redis kolejek (REDIS_QUEUE_URL) nie odpowiedział w ciągu ${STARTUP_CHECK_TIMEOUT_MS} ms`,
    );

    const consumers = this.explorer.methods<DomainEventHandlerMetadata>(
      DOMAIN_EVENT_HANDLER_METADATA,
    );
    const handlers = [
      ...this.explorer.jobHandlers(),
      ...consumers.map((consumer) => eventConsumerHandler(this.db, consumer)),
    ];

    this.workers = new QueueWorkers({
      connection: this.workerRedis,
      prefix: this.config.queues.prefix,
      deadLetters: this.deadLetters,
      runInLogContext: (bindings, fn) => this.pino.runInContext(fn, { bindings }),
      tuning: this.tuning,
    });
    await this.workers.start(handlers);
    await syncJobSchedules(this.queues, handlers, this.logger);

    this.relay = new OutboxRelay(this.db, this.queues, eventSubscriptions(consumers), {
      pollIntervalMs: this.config.queues.outboxPollIntervalMs,
    });
    this.relay.start();

    const summary: WorkerSummary = {
      queues: this.workers.queues,
      consumers: consumers.map((consumer) => consumer.metadata.consumer),
      scheduledJobs: handlers
        .filter((handler) => handler.schedule !== undefined)
        .map((handler) => handler.name),
    };
    this.logger.log(
      `Worker działa: kolejki ${summary.queues.join(', ') || '(brak)'}; ` +
        `konsumenci eventów: ${summary.consumers.length}; joby cykliczne: ${summary.scheduledJobs.join(', ') || '(brak)'}; ` +
        `relay outboxa co ${this.config.queues.outboxPollIntervalMs} ms`,
    );
    return summary;
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.relay?.stop();
    await this.workers?.stop();
  }

  async onApplicationShutdown(): Promise<void> {
    await closeQueueRedis(this.workerRedis);
  }
}

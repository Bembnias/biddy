import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type DefaultJobOptions, Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { DEAD_LETTER_QUEUE, type QueueName, isQueueName, jobOptionsFor } from './queue-catalog.js';
import type { WorkerTuning } from './queue-workers.js';

/** Token DI połączenia z Redisem kolejek dla producentów (dodawanie jobów). */
export const QUEUE_REDIS = Symbol('QUEUE_REDIS');

/** Token DI {@link QueueTuning}. */
export const QUEUE_TUNING = Symbol('QUEUE_TUNING');

/**
 * Nadpisania parametrów kolejek. Na produkcji puste; testy skracają ponowienia i wykrywanie
 * zawieszonych jobów, żeby nie czekać minut.
 */
export interface QueueTuning extends WorkerTuning {
  /** Nadpisania opcji jobów wszystkich kolejek katalogu (np. attempts, backoff). */
  readonly jobOptions?: DefaultJobOptions;
}

export interface AddJobOptions {
  /**
   * ID joba. Job o istniejącym ID nie zostanie dodany drugi raz (deduplikacja), dlatego joby
   * z terminem dostają ID z deadlineJobId, a joby eventów z eventJobId.
   */
  readonly jobId?: string;
  /** Najwcześniejszy moment wykonania. Termin w przeszłości oznacza „od razu”. */
  readonly runAt?: Date;
}

/** Kolejka z katalogu albo dead-letter queue. */
export type AnyQueueName = QueueName | typeof DEAD_LETTER_QUEUE;

/**
 * Dostęp do kolejek BullMQ po stronie producenta (API i worker). Kolejki tworzy leniwie, przy
 * pierwszym użyciu, więc proces, który niczego nie kolejkuje, nie łączy się z Redisem.
 * Zamyka je QueuesModule przy zamykaniu aplikacji.
 */
@Injectable()
export class JobQueues {
  private readonly logger = new Logger(JobQueues.name);
  private readonly queues = new Map<AnyQueueName, Queue>();

  constructor(
    @Inject(QUEUE_REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(QUEUE_TUNING) private readonly tuning: QueueTuning = {},
  ) {}

  /** Kolejka BullMQ o danej nazwie (ta sama instancja przy kolejnych wywołaniach). */
  queue(name: AnyQueueName): Queue {
    const existing = this.queues.get(name);
    if (existing !== undefined) {
      return existing;
    }
    const queue = new Queue(name, {
      connection: this.redis,
      prefix: this.config.queues.prefix,
      defaultJobOptions: isQueueName(name)
        ? { ...jobOptionsFor(name), ...this.tuning.jobOptions }
        : // Wpis DLQ nie jest przetwarzany: czeka, aż ktoś go ponowi albo usunie.
          { attempts: 1, removeOnComplete: false, removeOnFail: false },
    });
    // Bez nasłuchu zdarzenie `error` (np. utrata połączenia) zakończyłoby proces.
    queue.on('error', (error) => {
      this.logger.warn(`Błąd kolejki ${name}: ${error.message}`);
    });
    this.queues.set(name, queue);
    return queue;
  }

  /**
   * Dodaje job i zwraca jego ID. Gdy job o podanym ID już istnieje, niczego nie dodaje i zwraca
   * to samo ID.
   *
   * @example
   * await jobs.add('auctions', 'auction.close', { auctionId }, {
   *   jobId: deadlineJobId('close', auctionId, endsAt),
   *   runAt: endsAt,
   * });
   */
  async add(
    queue: QueueName,
    name: string,
    data: unknown,
    options: AddJobOptions = {},
  ): Promise<string> {
    const delay =
      options.runAt === undefined ? undefined : Math.max(0, options.runAt.getTime() - Date.now());
    const job = await this.queue(queue).add(name, data, {
      ...(options.jobId === undefined ? {} : { jobId: options.jobId }),
      ...(delay === undefined ? {} : { delay }),
    });
    // BullMQ zwraca job z ID zawsze, gdy add się powiedzie.
    return job.id ?? options.jobId ?? '';
  }

  /** Zamyka wszystkie otwarte kolejki (połączenie z Redisem zamyka QueuesModule). */
  async close(): Promise<void> {
    const queues = [...this.queues.values()];
    this.queues.clear();
    await Promise.all(queues.map((queue) => queue.close()));
  }
}

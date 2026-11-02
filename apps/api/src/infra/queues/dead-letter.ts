import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';

import { JobQueues } from './job-queues.js';
import { DEAD_LETTER_QUEUE, isQueueName } from './queue-catalog.js';

/** Wpis dead-letter queue: kopia joba, który wyczerpał wszystkie próby. */
export interface DeadLetterEntry {
  readonly queue: string;
  readonly jobId: string;
  readonly jobName: string;
  readonly data: unknown;
  readonly attemptsMade: number;
  readonly failedReason: string;
  /** Stosy błędów z kolejnych prób (BullMQ trzyma ostatnie). */
  readonly stacktrace: readonly string[];
  /** Czas przeniesienia do DLQ (ISO 8601). */
  readonly failedAt: string;
}

export interface DeadLetter {
  /** ID wpisu w kolejce dead-letter (nie mylić z ID oryginalnego joba). */
  readonly id: string;
  readonly entry: DeadLetterEntry;
}

/** Jak ponowiono job z DLQ. */
export type ReplayResult = 'retried' | 'requeued';

export class DeadLetterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeadLetterError';
  }
}

/** ID nadane przez BullMQ (liczba); takiego ID nie można podać przy ponownym dodaniu joba. */
const GENERATED_JOB_ID = /^\d+$/;

/**
 * Dead-letter queue (kolejka `dead-letter` w Redisie kolejek). Worker dodaje tu kopię joba po
 * ostatniej nieudanej próbie; oryginał zostaje w zbiorze „failed” swojej kolejki (14 dni).
 * Wpisów nikt nie przetwarza automatycznie: widać je w Bull Board, a panel administracyjny
 * (F-34) skorzysta z {@link list} i {@link replay}.
 */
@Injectable()
export class DeadLetterQueue {
  constructor(private readonly queues: JobQueues) {}

  /** Zapisuje kopię nieudanego joba; zwraca ID wpisu. */
  async add(job: Job, error: Error): Promise<string> {
    const entry: DeadLetterEntry = {
      queue: job.queueName,
      jobId: job.id ?? '',
      jobName: job.name,
      data: job.data,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason || error.message,
      stacktrace: job.stacktrace?.length ? job.stacktrace : [error.stack ?? error.message],
      failedAt: new Date().toISOString(),
    };
    const added = await this.queues
      .queue(DEAD_LETTER_QUEUE)
      .add(`${entry.queue}/${entry.jobName}`, entry);
    return added.id ?? '';
  }

  /** Najstarsze wpisy DLQ (domyślnie do 50). */
  async list(limit = 50): Promise<DeadLetter[]> {
    const jobs = await this.queues.queue(DEAD_LETTER_QUEUE).getWaiting(0, limit - 1);
    return jobs
      .filter((job) => job.id !== undefined)
      .map((job) => ({ id: job.id ?? '', entry: job.data as DeadLetterEntry }));
  }

  /**
   * Ponawia job z wpisu DLQ i usuwa wpis. Gdy oryginał jest jeszcze w zbiorze „failed”, BullMQ
   * przenosi go do kolejki z wyzerowanym licznikiem prób (`retried`); gdy wygasł, job jest
   * dodawany od nowa z tym samym ID i danymi (`requeued`).
   */
  async replay(deadLetterId: string): Promise<ReplayResult> {
    const deadLetter = await this.queues.queue(DEAD_LETTER_QUEUE).getJob(deadLetterId);
    if (deadLetter === undefined) {
      throw new DeadLetterError(`Brak wpisu ${deadLetterId} w dead-letter queue`);
    }
    const entry = deadLetter.data as DeadLetterEntry;
    if (!isQueueName(entry.queue)) {
      throw new DeadLetterError(
        `Wpis ${deadLetterId}: kolejka „${entry.queue}” nie istnieje w katalogu kolejek`,
      );
    }
    const source = this.queues.queue(entry.queue);
    const original = await source.getJob(entry.jobId);
    let result: ReplayResult;
    if (original === undefined) {
      await source.add(
        entry.jobName,
        entry.data,
        GENERATED_JOB_ID.test(entry.jobId) ? {} : { jobId: entry.jobId },
      );
      result = 'requeued';
    } else {
      const state = await original.getState();
      if (state !== 'failed') {
        throw new DeadLetterError(
          `Job ${entry.jobId} w kolejce ${entry.queue} jest w stanie „${state}”, a nie „failed”; nie ponawiam`,
        );
      }
      await original.retry('failed', { resetAttemptsMade: true, resetAttemptsStarted: true });
      result = 'retried';
    }
    await deadLetter.remove();
    return result;
  }
}

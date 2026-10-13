// Synchronizacja jobów cyklicznych (@ScheduledJob) z harmonogramami BullMQ (job schedulers).
// Worker przy starcie dodaje albo aktualizuje harmonogram każdego joba cyklicznego z kodu
// i usuwa harmonogramy, których w kodzie już nie ma (np. po usunięciu sweepera).
import type { Logger } from '@nestjs/common';

import type { JobSchedule } from './job-handler.js';
import type { JobQueues } from './job-queues.js';
import { QUEUE_NAMES } from './queue-catalog.js';
import type { RegisteredJobHandler } from './queue-workers.js';

/** Strefa czasowa harmonogramów cron (np. „codziennie o 3:00” czasu polskiego). */
export const SCHEDULE_TIMEZONE = 'Europe/Warsaw';

/**
 * Opcje jobów tworzonych przez harmonogram: jedna próba (następne wykonanie i tak przyjdzie za
 * chwilę, a ponowienia nakładałyby się na kolejne wykonania) i krótka historia, żeby joby co
 * 10 s nie zalewały Redisa ani Bull Board.
 */
export const SCHEDULED_JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
} as const;

function repeatOptions(schedule: JobSchedule): { every: number } | { pattern: string; tz: string } {
  return 'every' in schedule
    ? { every: schedule.every }
    : { pattern: schedule.pattern, tz: SCHEDULE_TIMEZONE };
}

export async function syncJobSchedules(
  queues: JobQueues,
  handlers: readonly RegisteredJobHandler[],
  logger: Pick<Logger, 'log'>,
): Promise<void> {
  for (const queueName of QUEUE_NAMES) {
    const queue = queues.queue(queueName);
    const wanted = handlers.filter((handler) => handler.queue === queueName);
    const names = new Set<string>();
    for (const handler of wanted) {
      if (handler.schedule === undefined) {
        continue;
      }
      names.add(handler.name);
      // ID harmonogramu = nazwa joba (unikalna w kolejce).
      await queue.upsertJobScheduler(handler.name, repeatOptions(handler.schedule), {
        name: handler.name,
        data: {},
        opts: SCHEDULED_JOB_OPTIONS,
      });
    }
    for (const scheduler of await queue.getJobSchedulers()) {
      if (!names.has(scheduler.key)) {
        await queue.removeJobScheduler(scheduler.key);
        logger.log(
          `Usunięto harmonogram ${scheduler.key} z kolejki ${queueName} (brak joba cyklicznego w kodzie)`,
        );
      }
    }
  }
}

// Publiczne API kolejek BullMQ (PROJECT.md §10.4, §11.2, ADR-4).
// - QueuesModule: moduł globalny (API i worker) z JobQueues i DeadLetterQueue.
// - JobQueues: dodawanie jobów (`add`), także z terminem (`runAt`) i ID do deduplikacji.
// - @JobHandler / @ScheduledJob: handlery jobów i joby cykliczne w modułach; wykonuje je worker.
// - deadlineJobId / eventJobId: konwencje ID jobów (termin w ID, PROJECT.md §15.2).
// - QUEUE_DEFINITIONS: katalog kolejek z współbieżnością; nowa kolejka = nowy wpis.
export {
  DeadLetterError,
  DeadLetterQueue,
  type DeadLetter,
  type DeadLetterEntry,
} from './dead-letter.js';
export {
  InvalidJobHandlerError,
  JOB_HANDLER_METADATA,
  JOB_NAME_PATTERN,
  JobHandler,
  ScheduledJob,
  type JobHandlerMetadata,
  type JobRun,
  type JobSchedule,
  type ScheduledJobOptions,
} from './job-handler.js';
export { JobHandlerExplorer, type DiscoveredMethod } from './job-handler-explorer.js';
export { InvalidJobIdError, deadlineJobId, eventJobId } from './job-ids.js';
export {
  JobQueues,
  QUEUE_REDIS,
  QUEUE_TUNING,
  type AddJobOptions,
  type AnyQueueName,
  type QueueTuning,
} from './job-queues.js';
export { SCHEDULED_JOB_OPTIONS, SCHEDULE_TIMEZONE, syncJobSchedules } from './job-schedules.js';
export {
  DEAD_LETTER_QUEUE,
  DEFAULT_JOB_OPTIONS,
  DOMAIN_EVENTS_QUEUE,
  QUEUE_DEFINITIONS,
  QUEUE_NAMES,
  isQueueName,
  jobOptionsFor,
  type QueueDefinition,
  type QueueName,
} from './queue-catalog.js';
export {
  DuplicateJobHandlerError,
  QueueWorkers,
  isFinalFailure,
  isUnrecoverable,
  toJobRun,
  type QueueWorkersOptions,
  type RegisteredJobHandler,
  type RunInLogContext,
  type WorkerTuning,
} from './queue-workers.js';
export {
  EvictionPolicyError,
  assertNoEviction,
  closeQueueRedis,
  createQueueRedis,
  infoField,
  reconnectDelay,
  type QueueConnectionRole,
} from './redis.js';
export { QueuesModule } from './queues.module.js';

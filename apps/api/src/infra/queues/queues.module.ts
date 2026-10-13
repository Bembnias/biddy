import {
  type DynamicModule,
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Redis } from 'ioredis';

import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { DeadLetterQueue } from './dead-letter.js';
import { JobQueues, QUEUE_REDIS, QUEUE_TUNING, type QueueTuning } from './job-queues.js';
import { closeQueueRedis, createQueueRedis } from './redis.js';

/**
 * Kolejki BullMQ po stronie producenta, w API i w workerze: połączenie z Redisem kolejek
 * (QUEUE_REDIS, leniwe), JobQueues (dodawanie jobów) i DeadLetterQueue. Moduł globalny, wymaga
 * APP_CONFIG. Przetwarzanie jobów uruchamia tylko worker (src/infra/worker).
 */
@Global()
@Module({})
export class QueuesModule implements OnApplicationShutdown {
  constructor(
    private readonly queues: JobQueues,
    @Inject(QUEUE_REDIS) private readonly redis: Redis,
  ) {}

  /** @param tuning tylko testy: krótsze ponowienia i wykrywanie zawieszonych jobów */
  static forRoot(tuning: QueueTuning = {}): DynamicModule {
    return {
      module: QueuesModule,
      global: true,
      providers: [
        {
          provide: QUEUE_REDIS,
          inject: [APP_CONFIG],
          useFactory: (config: AppConfig) => createQueueRedis(config.queues.redisUrl, 'producer'),
        },
        { provide: QUEUE_TUNING, useValue: tuning },
        JobQueues,
        DeadLetterQueue,
      ],
      exports: [QUEUE_REDIS, QUEUE_TUNING, JobQueues, DeadLetterQueue],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    // Worker zatrzymuje przetwarzanie wcześniej (beforeApplicationShutdown), więc tu nikt już
    // nie dodaje jobów.
    await this.queues.close();
    await closeQueueRedis(this.redis);
  }
}

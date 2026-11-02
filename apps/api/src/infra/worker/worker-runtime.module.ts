import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { JobHandlerExplorer, createQueueRedis } from '../queues/index.js';
import { WORKER_REDIS, WorkerRuntime } from './worker-runtime.js';

/**
 * Część aplikacji, która istnieje tylko w procesie workera: osobne połączenie z Redisem dla
 * workerów BullMQ, wyszukiwanie handlerów (DiscoveryModule) i WorkerRuntime. Wymaga modułów
 * globalnych: ConfigModule, DbModule, QueuesModule, OutboxModule i loggera (nestjs-pino).
 */
@Module({
  imports: [DiscoveryModule],
  providers: [
    {
      provide: WORKER_REDIS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createQueueRedis(config.queues.redisUrl, 'worker'),
    },
    JobHandlerExplorer,
    WorkerRuntime,
  ],
  exports: [WorkerRuntime],
})
export class WorkerRuntimeModule {}

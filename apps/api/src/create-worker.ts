// Budowa procesu workera (NestJS bez HTTP): używa jej worker.ts oraz testy integracyjne.
import type { DynamicModule, INestApplicationContext, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoNestLogger } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { z } from 'zod';

import type { AppConfig } from './infra/config/index.js';
import { WORKER_SERVICE_NAME, createRootLogger } from './infra/logger/index.js';
import type { QueueTuning } from './infra/queues/index.js';
import { WorkerRuntime } from './infra/worker/index.js';
import { WorkerModule } from './worker.module.js';

export interface CreateWorkerOptions {
  /** Dodatkowe moduły (np. handlery testowe). */
  readonly extraModules?: readonly (Type | DynamicModule)[];
  /** Tylko testy: dokąd pisać logi (JSON). Domyślnie stdout albo pino-pretty. */
  readonly logDestination?: DestinationStream;
  /** Tylko testy: krótsze ponowienia i wykrywanie zawieszonych jobów. */
  readonly tuning?: QueueTuning;
}

/**
 * Tworzy kontekst aplikacji workera i uruchamia przetwarzanie (WorkerRuntime.start). Gdy start
 * się nie uda (np. Redis kolejek bez noeviction), zamyka to, co zdążyło się otworzyć, i rzuca
 * błąd. Obsługa sygnałów zamknięcia jest włączona: SIGTERM kończy relay i trwające joby.
 */
export async function createWorker(
  config: AppConfig,
  options: CreateWorkerOptions = {},
): Promise<INestApplicationContext> {
  // Komunikaty walidacji Zod (np. payload eventu) po polsku, jak w API.
  z.config(z.locales.pl());

  const logger = createRootLogger(config, options.logDestination, WORKER_SERVICE_NAME);
  const app = await NestFactory.createApplicationContext(
    WorkerModule.forRoot(config, {
      logger,
      ...(options.extraModules === undefined ? {} : { extraModules: options.extraModules }),
      ...(options.tuning === undefined ? {} : { tuning: options.tuning }),
    }),
    { bufferLogs: true, abortOnError: false },
  );
  try {
    app.useLogger(app.get(PinoNestLogger));
    app.enableShutdownHooks();
    await app.get(WorkerRuntime).start();
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
  return app;
}

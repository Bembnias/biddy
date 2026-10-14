import { type DynamicModule, Module, type Type } from '@nestjs/common';
import type { Logger } from 'pino';

import { type AppConfig, ConfigModule } from './infra/config/index.js';
import { DbModule } from './infra/db/index.js';
import { createLoggerModule } from './infra/logger/index.js';
import { MailModule } from './infra/mail/index.js';
import { OutboxModule } from './infra/outbox/index.js';
import { QueuesModule, type QueueTuning } from './infra/queues/index.js';
import { SmsModule } from './infra/sms/index.js';
import { WorkerRuntimeModule } from './infra/worker/index.js';
import { DOMAIN_MODULES } from './modules/index.js';

export interface WorkerModuleOptions {
  readonly logger: Logger;
  /** Dodatkowe moduły, np. handlery testowe. */
  readonly extraModules?: readonly (Type | DynamicModule)[];
  /** Tylko testy: krótsze ponowienia i wykrywanie zawieszonych jobów. */
  readonly tuning?: QueueTuning;
}

/**
 * Moduł główny workera (PROJECT.md §10.4): te same moduły domenowe co API (ich handlery jobów
 * i konsumenci eventów), bez HTTP. Przetwarzanie uruchamia WorkerRuntime.
 */
@Module({})
export class WorkerModule {
  static forRoot(config: AppConfig, options: WorkerModuleOptions): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        ConfigModule.forRoot(config),
        createLoggerModule(options.logger),
        DbModule,
        QueuesModule.forRoot(options.tuning),
        OutboxModule,
        MailModule,
        SmsModule,
        ...DOMAIN_MODULES,
        ...(options.extraModules ?? []),
        WorkerRuntimeModule,
      ],
    };
  }
}

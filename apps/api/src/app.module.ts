import { type DynamicModule, Module, type Type } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SentryModule } from '@sentry/nestjs/setup';
import { ZodSerializerInterceptor } from 'nestjs-zod';
import type { Logger } from 'pino';

import { type AppConfig, ConfigModule } from './infra/config/index.js';
import { DbModule } from './infra/db/index.js';
import { HealthModule } from './infra/health/index.js';
import { createLoggerModule, createRootLogger } from './infra/logger/index.js';
import { MailModule } from './infra/mail/index.js';
import { OutboxModule } from './infra/outbox/index.js';
import { QueuesModule } from './infra/queues/index.js';
import { SmsModule } from './infra/sms/index.js';
import { RealtimeModule } from './infra/realtime/index.js';
import { WebModule } from './infra/web/index.js';
import { StorageModule } from './infra/storage/index.js';
import { TimeModule } from './infra/time/index.js';
import { DOMAIN_MODULES } from './modules/index.js';

/** Moduł główny API (modularny monolit, PROJECT.md §10.3). */
@Module({})
export class AppModule {
  /**
   * @param config zwalidowana konfiguracja (loadConfig)
   * @param extraModules dodatkowe moduły, np. kontroler testowy w testach integracyjnych
   * @param logger logger pino współdzielony z Fastify (createApp); domyślnie nowy z konfiguracji
   */
  static forRoot(
    config: AppConfig,
    extraModules: readonly (Type | DynamicModule)[] = [],
    logger: Logger = createRootLogger(config),
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        createLoggerModule(logger),
        SentryModule.forRoot(),
        DbModule,
        // Kolejki i outbox po stronie producenta; joby i eventy przetwarza worker (worker.ts).
        QueuesModule.forRoot(),
        OutboxModule,
        MailModule,
        SmsModule,
        StorageModule,
        RealtimeModule,
        WebModule,
        ...DOMAIN_MODULES,
        HealthModule,
        TimeModule,
        ...extraModules,
      ],
      providers: [
        // Odpowiedź metody z @ZodResponse przechodzi przez schemat DTO: zostają tylko pola ze
        // schematu (nic spoza kontraktu OpenAPI nie wycieka), a niezgodność to błąd 500.
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
      ],
    };
  }
}

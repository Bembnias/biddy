// Budowa aplikacji NestJS (Fastify) bez nasłuchiwania na porcie: używa jej main.ts oraz testy
// (fastify.inject() w procesie, testy integracyjne z Testcontainers).
import { type DynamicModule, RequestMethod, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger as PinoNestLogger } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import type { DestinationStream } from 'pino';
import { z } from 'zod';

import { AppModule } from './app.module.js';
import type { AppConfig } from './infra/config/index.js';
import { HEALTH_PATH, PROBE_PATHS, READY_PATH } from './infra/health/index.js';
import {
  ProblemDetailsFilter,
  REQUEST_ID_HEADER,
  createHttpAdapter,
  registerSecurityHeaders,
} from './infra/http/index.js';
import { createRootLogger } from './infra/logger/index.js';
import { DOCS_PATH, setupOpenApi } from './infra/openapi/index.js';

/** Prefiks wersji API dla wszystkich tras poza sondami i dokumentacją. */
export const API_PREFIX = 'v1';

export interface CreateAppOptions {
  /** Dodatkowe moduły (np. kontroler testowy w testach). */
  readonly extraModules?: readonly (Type | DynamicModule)[];
  /** Tylko testy: dokąd pisać logi (JSON). Domyślnie stdout albo pino-pretty. */
  readonly logDestination?: DestinationStream;
}

/**
 * Tworzy i inicjalizuje aplikację (app.init()), ale nie wywołuje listen(). Ustawia logger pino
 * z request id, prefiks /v1 (poza /health, /ready i /docs), walidację Zod, filtr Problem Details,
 * helmet, CORS, Swagger (gdy włączony) i obsługę sygnałów zamknięcia.
 */
export async function createApp(
  config: AppConfig,
  options: CreateAppOptions = {},
): Promise<NestFastifyApplication> {
  // Komunikaty walidacji Zod (pole `errors` w Problem Details) po polsku.
  z.config(z.locales.pl());

  const logger = createRootLogger(config, options.logDestination);
  const adapter = createHttpAdapter(config, logger, { quietPaths: PROBE_PATHS });
  // Helmet i CORS rejestrujemy na adapterze przed NestFactory.create, bo NestJS rejestruje
  // middleware (@fastify/middie) już przy tworzeniu aplikacji, a hooki onRequest działają
  // w kolejności rejestracji. Dzięki temu odpowiedź z błędem z middleware (np. 401 z middleware
  // uwierzytelniania) ma nagłówki CORS i przeglądarka może ją odczytać.
  await registerSecurityHeaders(adapter.getInstance(), DOCS_PATH);
  adapter.enableCors({
    origin: [...config.http.corsOrigins],
    credentials: true,
    // @fastify/cors domyślnie zezwala tylko na GET, HEAD i POST.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    exposedHeaders: [REQUEST_ID_HEADER],
    maxAge: 600,
    // OPTIONS bez nagłówków Origin i Access-Control-Request-Method to nie preflight CORS.
    // W trybie ścisłym @fastify/cors odpowiadałby na nie 400 text/plain (bez Problem Details),
    // a tak dostają zwykłe 204 bez nagłówków Access-Control-Allow-Origin.
    strictPreflight: false,
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(config, options.extraModules, logger),
    adapter,
    {
      bufferLogs: true,
      // abortOnError: false, żeby błąd startu był wyjątkiem (main.ts loguje go i kończy proces).
      abortOnError: false,
      // Bez parserów NestJS (JSON i formularze): zostaje parser JSON z Fastify (te same kody
      // błędów FST_ERR_CTP_*, limit 1 MiB), a formularze dostają 415 (patrz createHttpAdapter).
      bodyParser: false,
    },
  );

  try {
    app.useLogger(app.get(PinoNestLogger));
    app.setGlobalPrefix(API_PREFIX, {
      exclude: [
        { path: HEALTH_PATH, method: RequestMethod.GET },
        { path: READY_PATH, method: RequestMethod.GET },
        { path: DOCS_PATH.slice(1), method: RequestMethod.ALL },
      ],
    });
    app.useGlobalPipes(new ZodValidationPipe());
    app.useGlobalFilters(
      new ProblemDetailsFilter({ exposeInternals: config.http.exposeErrorDetails }),
    );
    setupOpenApi(app, config);
    app.enableShutdownHooks();
    await app.init();
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
  return app;
}

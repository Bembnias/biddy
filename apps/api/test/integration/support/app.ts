// Aplikacja w procesie testu: createApp (bez listen) z konfiguracją wskazującą na Postgresa
// w kontenerze, żądania przez fastify.inject(), logi JSON zbierane w pamięci.
import { Writable } from 'node:stream';

import { isProblemDetails, PROBLEM_CONTENT_TYPE, type ProblemDetails } from '@biddy/shared';
import type { DynamicModule, Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';

import { createApp } from '../../../src/create-app.js';
import { type AppConfig, loadConfig } from '../../../src/infra/config/index.js';
import { databaseUrl } from './database.js';

export const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Konfiguracja przez loadConfig (ta sama walidacja co przy starcie), domyślnie z bazą
 * w kontenerze. `env` nadpisuje pojedyncze zmienne, np. DATABASE_URL.
 */
export function integrationConfig(env: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl(),
    LOG_LEVEL: 'info',
    APP_RELEASE: 'integration-test',
    ...env,
  });
}

export interface TestApp {
  readonly app: NestFastifyApplication;
  readonly http: FastifyInstance;
  /** Linie logów (JSON) zapisane dotąd przez aplikację. */
  logLines(): Record<string, unknown>[];
  close(): Promise<void>;
}

/** Tworzy aplikację (app.init(), bez nasłuchiwania na porcie) z logami do pamięci. */
export async function startTestApp(
  config: AppConfig = integrationConfig(),
  extraModules: readonly (Type | DynamicModule)[] = [],
): Promise<TestApp> {
  const chunks: string[] = [];
  const logDestination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const app = await createApp(config, { extraModules, logDestination });
  return {
    app,
    http: app.getHttpAdapter().getInstance(),
    logLines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    close: () => app.close(),
  };
}

/** Sprawdza nagłówek application/problem+json i kształt treści, zwraca Problem Details. */
export function problemOf(response: LightMyRequestResponse): ProblemDetails {
  expect(response.headers['content-type']).toBe(`${PROBLEM_CONTENT_TYPE}; charset=utf-8`);
  const body: unknown = response.json();
  expect(isProblemDetails(body), response.body).toBe(true);
  return body as ProblemDetails;
}

// Konfiguracja API walidowana Zodem przy starcie (PROJECT.md §11.2). Brakująca lub błędna
// zmienna kończy start aplikacji z czytelną listą błędów, zanim cokolwiek się połączy.
import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const csv = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0),
);

/** Surowe zmienne środowiskowe API (puste wartości traktujemy jak brak zmiennej). */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Platformy (Render) podają port w PORT; lokalnie używamy API_PORT, żeby nie kolidować z web.
  PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  API_HOST: z.string().min(1).optional(),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  LOG_PRETTY: booleanFromString.optional(),
  CORS_ORIGINS: csv.default(['http://localhost:3000']),
  TRUST_PROXY: booleanFromString.optional(),
  OPENAPI_ENABLED: booleanFromString.optional(),
  SENTRY_DSN: z.url().optional(),
  SENTRY_ENVIRONMENT: z.string().min(1).optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
  APP_RELEASE: z.string().min(1).optional(),
});

export type AppEnvironment = 'development' | 'test' | 'production';

/** Konfiguracja aplikacji po walidacji i wyliczeniu wartości domyślnych. */
export interface AppConfig {
  readonly env: AppEnvironment;
  readonly release: string | undefined;
  readonly http: {
    readonly host: string;
    readonly port: number;
    readonly corsOrigins: readonly string[];
    readonly trustProxy: boolean;
  };
  readonly database: {
    readonly url: string;
    readonly poolMax: number;
  };
  readonly log: {
    readonly level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
    readonly pretty: boolean;
  };
  readonly openapi: {
    readonly enabled: boolean;
  };
  readonly sentry: {
    readonly dsn: string | undefined;
    readonly environment: string;
    readonly tracesSampleRate: number;
  };
}

/** Token DI dla {@link AppConfig}. */
export const APP_CONFIG = Symbol('APP_CONFIG');

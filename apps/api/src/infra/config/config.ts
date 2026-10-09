// Konfiguracja API walidowana Zodem przy starcie (PROJECT.md §11.2). Brakująca lub błędna
// zmienna kończy start aplikacji z czytelną listą błędów, zanim cokolwiek się połączy.
import { isIP } from 'node:net';

import { z } from 'zod';

const MISSING = 'brak zmiennej (nie ustawiono jej albo jest pusta)';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

function text() {
  return z.string({
    error: (issue) => (issue.input === undefined ? MISSING : 'oczekiwano tekstu'),
  });
}

function port() {
  return text()
    .regex(/^\d{1,5}$/, 'oczekiwano numeru portu (liczba całkowita 1–65535)')
    .transform(Number)
    .refine((value) => value >= 1 && value <= 65_535, 'port musi być z zakresu 1–65535');
}

function integer(min: number, max: number) {
  return text()
    .regex(/^\d+$/, `oczekiwano liczby całkowitej ${min}–${max}`)
    .transform(Number)
    .refine((value) => value >= min && value <= max, `oczekiwano liczby całkowitej ${min}–${max}`);
}

function boolean() {
  return z.stringbool({
    truthy: ['true', '1'],
    falsy: ['false', '0'],
    error: 'oczekiwano true lub false',
  });
}

function oneOf<const T extends readonly [string, ...string[]]>(values: T) {
  return z.enum(values, {
    error: (issue) =>
      issue.input === undefined ? MISSING : `oczekiwano jednej z wartości: ${values.join(', ')}`,
  });
}

function url(protocols: readonly string[], example: string, extra?: (url: URL) => boolean) {
  const schemes = protocols.map((protocol) => `${protocol}//`).join(' lub ');
  return text().refine((value) => {
    const parsed = URL.parse(value);
    return (
      parsed !== null &&
      protocols.includes(parsed.protocol) &&
      parsed.hostname !== '' &&
      (extra?.(parsed) ?? true)
    );
  }, `oczekiwano adresu ${schemes}…, np. ${example}`);
}

/** Lista originów po przecinku, np. `http://localhost:3000,https://biddy.pl`. */
function originList() {
  return text().transform((value, ctx) => {
    const origins = value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin !== '');
    for (const origin of origins) {
      const parsed = URL.parse(origin);
      const valid =
        parsed !== null &&
        ['http:', 'https:'].includes(parsed.protocol) &&
        parsed.origin === origin;
      if (!valid) {
        ctx.issues.push({
          code: 'custom',
          input: value,
          message: `„${origin}” nie jest originem (oczekiwano np. http://localhost:3000, bez ścieżki i ukośnika na końcu)`,
        });
        return z.NEVER;
      }
    }
    if (origins.length === 0) {
      ctx.issues.push({ code: 'custom', input: value, message: 'podaj co najmniej jeden origin' });
      return z.NEVER;
    }
    return origins;
  });
}

/**
 * Zaufane proxy przed API, od których bierzemy adres klienta z X-Forwarded-For: false (brak
 * proxy) albo lista adresów IP/CIDR proxy. true ufa każdemu wpisowi X-Forwarded-For, więc
 * klient może podać dowolny adres; ma sens tylko za proxy, które nadpisuje ten nagłówek.
 */
export type TrustProxy = boolean | readonly string[];

/** Nazwane zakresy adresów rozumiane przez Fastify (proxy-addr). */
const PROXY_RANGE_NAMES = new Set(['loopback', 'linklocal', 'uniquelocal']);

/**
 * Domyślne zaufane proxy na produkcji: sieci prywatne (10/8, 172.16/12, 192.168/16, fc00::/7)
 * i loopback, czyli load balancer platformy (Render) w sieci wewnętrznej. Adres klienta to
 * pierwszy od prawej publiczny wpis X-Forwarded-For, więc wpisy dopisane przez klienta na
 * początku nagłówka niczego nie zmieniają.
 */
export const DEFAULT_PRODUCTION_TRUST_PROXY: readonly string[] = ['loopback', 'uniquelocal'];

function isAddressOrRange(value: string): boolean {
  if (PROXY_RANGE_NAMES.has(value)) {
    return true;
  }
  const [address = '', prefix, ...rest] = value.split('/');
  const version = isIP(address);
  if (version === 0 || rest.length > 0) {
    return false;
  }
  if (prefix === undefined) {
    return true;
  }
  return /^\d{1,3}$/.test(prefix) && Number(prefix) <= (version === 4 ? 32 : 128);
}

/** TRUST_PROXY: `true`, `false` albo lista adresów IP/CIDR (i nazwanych zakresów) po przecinku. */
function trustProxy() {
  return text().transform((value, ctx): TrustProxy => {
    const normalized = value.toLowerCase();
    if (normalized === 'true' || normalized === 'false') {
      return normalized === 'true';
    }
    if (/^\d+$/.test(value)) {
      // Fastify 5 celowo ignoruje liczbę proxy (nie sprawdza, czy łączy się proxy, czy klient).
      ctx.issues.push({
        code: 'custom',
        input: value,
        message:
          'liczba proxy nie jest obsługiwana (Fastify jej nie stosuje, bo nie weryfikuje adresu proxy); podaj adresy IP/CIDR proxy, np. uniquelocal albo 10.0.0.0/8, albo true/false',
      });
      return z.NEVER;
    }
    const entries = value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
    const invalid = entries.filter((entry) => !isAddressOrRange(entry));
    if (entries.length === 0 || invalid.length > 0) {
      ctx.issues.push({
        code: 'custom',
        input: value,
        message: `oczekiwano true, false albo listy adresów IP/CIDR proxy po przecinku (np. 10.0.0.0/8,192.168.1.10; zakresy: ${[...PROXY_RANGE_NAMES].join(', ')})${invalid.length > 0 ? `; niepoprawne: ${invalid.join(', ')}` : ''}`,
      });
      return z.NEVER;
    }
    return entries;
  });
}

/**
 * Surowe zmienne środowiskowe API. Puste wartości traktujemy jak brak zmiennej (loadConfig
 * usuwa je przed walidacją), a wartości domyślne zależne od NODE_ENV wylicza loadConfig.
 */
export const envSchema = z.object({
  NODE_ENV: oneOf(['development', 'test', 'production']).default('development'),
  // Platformy (Render) podają port w PORT; lokalnie używamy API_PORT, żeby nie kolidować z web.
  PORT: port().optional(),
  API_PORT: port().optional(),
  API_HOST: text().optional(),
  DATABASE_URL: url(
    ['postgres:', 'postgresql:'],
    'postgres://biddy:biddy@localhost:5432/biddy (z nazwą bazy na końcu)',
    (parsed) => parsed.pathname.length > 1,
  ),
  DATABASE_POOL_MAX: integer(1, 100).optional(),
  LOG_LEVEL: oneOf(LOG_LEVELS).optional(),
  LOG_PRETTY: boolean().optional(),
  CORS_ORIGINS: originList().optional(),
  TRUST_PROXY: trustProxy().optional(),
  OPENAPI_ENABLED: boolean().optional(),
  SENTRY_DSN: url(['https:', 'http:'], 'https://klucz@o0.ingest.de.sentry.io/0').optional(),
  SENTRY_ENVIRONMENT: text().optional(),
  SENTRY_TRACES_SAMPLE_RATE: text()
    .regex(/^(0(\.\d+)?|1(\.0+)?)$/, 'oczekiwano liczby od 0 do 1, np. 0.1')
    .transform(Number)
    .optional(),
  APP_RELEASE: text().optional(),
});

/** Nazwy wszystkich zmiennych obsługiwanych przez schemat. */
export const ENV_KEYS = Object.keys(envSchema.shape) as (keyof z.input<typeof envSchema>)[];

export type AppEnvironment = 'development' | 'test' | 'production';

export type LogLevel = (typeof LOG_LEVELS)[number];

/** Konfiguracja aplikacji po walidacji i wyliczeniu wartości domyślnych. */
export interface AppConfig {
  readonly env: AppEnvironment;
  readonly release: string | undefined;
  readonly http: {
    readonly host: string;
    readonly port: number;
    readonly corsOrigins: readonly string[];
    readonly trustProxy: TrustProxy;
    /**
     * Szczegóły nieoczekiwanych błędów (komunikat, stos) w polu `debug` odpowiedzi. Tylko
     * development na adresie lokalnym: wdrożenie bez NODE_ENV (domyślnie development), które
     * musi słuchać na 0.0.0.0, nie pokaże ich publicznie.
     */
    readonly exposeErrorDetails: boolean;
  };
  readonly database: {
    readonly url: string;
    readonly poolMax: number;
  };
  readonly log: {
    readonly level: LogLevel;
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

/** Problem z jedną zmienną środowiskową. */
export interface ConfigIssue {
  readonly variable: string;
  readonly message: string;
}

/** Błędna konfiguracja: lista wszystkich złych zmiennych naraz, a nie tylko pierwszej. */
export class ConfigError extends Error {
  readonly issues: ConfigIssue[];

  constructor(issues: ConfigIssue[]) {
    super(
      [
        'Nieprawidłowa konfiguracja API (zmienne środowiskowe):',
        ...issues.map((issue) => `  • ${issue.variable}: ${issue.message}`),
      ].join('\n'),
    );
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/** Czytelny opis błędu konfiguracji do wypisania na stderr przy starcie. */
export function formatConfigError(error: ConfigError): string {
  return [
    error.message,
    '',
    'Popraw wartości w .env (lokalnie) albo w zmiennych środowiskowych platformy.',
    'Opis zmiennych API i wartości domyślne: sekcja „API” w .env.example.',
  ].join('\n');
}

type RawEnv = Readonly<Record<string, string | undefined>>;

/** Kopia zmiennych schematu bez pustych wartości (pusta wartość = brak zmiennej). */
function pickNonEmpty(env: RawEnv, keys: readonly string[]): Record<string, string> {
  const input: Record<string, string> = {};
  for (const key of keys) {
    const value = env[key];
    if (value !== undefined && value.trim() !== '') {
      input[key] = value.trim();
    }
  }
  return input;
}

function issuesOf(error: z.ZodError): ConfigIssue[] {
  return error.issues.map((issue) => ({
    variable: issue.path.map(String).join('.') || '(całość)',
    message: issue.message,
  }));
}

/** Czy API słucha tylko na interfejsie lokalnym (niedostępne z sieci). */
function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/** Problemy, które zależą od kilku zmiennych naraz (np. od NODE_ENV). */
function crossFieldIssues(input: Readonly<Record<string, string>>): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  // Na produkcji domyślny localhost w CORS byłby błędem konfiguracji, a nie wygodą.
  if (input['NODE_ENV'] === 'production' && input['CORS_ORIGINS'] === undefined) {
    issues.push({
      variable: 'CORS_ORIGINS',
      message: `${MISSING}; na produkcji podaj originy frontendu, np. https://biddy.pl`,
    });
  }
  return issues;
}

/** Kolejność zmiennych jak w schemacie, żeby lista błędów była zawsze taka sama. */
function byVariableOrder(left: ConfigIssue, right: ConfigIssue): number {
  const order = (issue: ConfigIssue) => {
    const index = (ENV_KEYS as readonly string[]).indexOf(issue.variable);
    return index === -1 ? ENV_KEYS.length : index;
  };
  return order(left) - order(right);
}

/**
 * Waliduje zmienne środowiskowe i wylicza konfigurację. Rzuca {@link ConfigError} ze
 * wszystkimi problemami naraz. Nie czyta process.env sama, żeby dało się ją testować.
 */
export function loadConfig(env: RawEnv): AppConfig {
  const input = pickNonEmpty(env, ENV_KEYS);
  const result = envSchema.safeParse(input);
  const issues = [...(result.success ? [] : issuesOf(result.error)), ...crossFieldIssues(input)];
  if (!result.success || issues.length > 0) {
    throw new ConfigError(issues.sort(byVariableOrder));
  }
  const vars = result.data;
  const production = vars.NODE_ENV === 'production';
  const development = vars.NODE_ENV === 'development';
  const host = vars.API_HOST ?? (production ? '0.0.0.0' : '127.0.0.1');

  return {
    env: vars.NODE_ENV,
    release: vars.APP_RELEASE,
    http: {
      host,
      port: vars.PORT ?? vars.API_PORT ?? 3001,
      corsOrigins: vars.CORS_ORIGINS ?? ['http://localhost:3000'],
      // Produkcja: proxy w sieci prywatnej (load balancer Render). Proxy z adresami publicznymi
      // (np. Cloudflare przed Render) trzeba dopisać w TRUST_PROXY, inaczej adresem klienta
      // będzie adres takiego proxy.
      trustProxy: vars.TRUST_PROXY ?? (production ? DEFAULT_PRODUCTION_TRUST_PROXY : false),
      exposeErrorDetails: development && isLoopbackHost(host),
    },
    database: {
      url: vars.DATABASE_URL,
      poolMax: vars.DATABASE_POOL_MAX ?? 10,
    },
    log: {
      level: vars.LOG_LEVEL ?? (development ? 'debug' : 'info'),
      pretty: vars.LOG_PRETTY ?? development,
    },
    openapi: {
      enabled: vars.OPENAPI_ENABLED ?? !production,
    },
    sentry: {
      dsn: vars.SENTRY_DSN,
      environment: vars.SENTRY_ENVIRONMENT ?? vars.NODE_ENV,
      tracesSampleRate: vars.SENTRY_TRACES_SAMPLE_RATE ?? 0,
    },
  };
}

/** Ustawienia Sentry potrzebne w instrument.ts (przed załadowaniem reszty aplikacji). */
export interface SentryOptions {
  readonly dsn: string;
  readonly environment: string;
  readonly release: string | undefined;
  readonly tracesSampleRate: number;
}

const sentryEnvSchema = envSchema.pick({
  NODE_ENV: true,
  SENTRY_DSN: true,
  SENTRY_ENVIRONMENT: true,
  SENTRY_TRACES_SAMPLE_RATE: true,
  APP_RELEASE: true,
});

/**
 * Czyta tylko zmienne Sentry (oraz NODE_ENV i APP_RELEASE). Zwraca undefined, gdy SENTRY_DSN
 * jest pusty albo zmienne są błędne: wtedy start i tak przerwie loadConfig w main.ts z pełną
 * listą błędów, więc tutaj niczego nie zgłaszamy.
 */
export function loadSentryOptions(env: RawEnv): SentryOptions | undefined {
  const result = sentryEnvSchema.safeParse(pickNonEmpty(env, Object.keys(sentryEnvSchema.shape)));
  if (!result.success || result.data.SENTRY_DSN === undefined) {
    return undefined;
  }
  const { SENTRY_DSN: dsn, ...vars } = result.data;
  return {
    dsn,
    environment: vars.SENTRY_ENVIRONMENT ?? vars.NODE_ENV,
    release: vars.APP_RELEASE,
    tracesSampleRate: vars.SENTRY_TRACES_SAMPLE_RATE ?? 0,
  };
}

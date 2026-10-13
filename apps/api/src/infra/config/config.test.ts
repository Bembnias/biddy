import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  ConfigError,
  DEFAULT_PRODUCTION_TRUST_PROXY,
  ENV_KEYS,
  type ConfigIssue,
  formatConfigError,
  loadConfig,
  loadSentryOptions,
} from './config.js';

const DATABASE_URL = 'postgres://biddy:biddy@localhost:5432/biddy';
const minimal = { DATABASE_URL } as const;

function issuesFor(env: Record<string, string | undefined>): ConfigIssue[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.issues;
    }
    throw error;
  }
  throw new Error('Oczekiwano ConfigError, a konfiguracja przeszła walidację.');
}

function variablesWithIssues(env: Record<string, string | undefined>): string[] {
  return issuesFor(env).map((issue) => issue.variable);
}

describe('loadConfig: wartości domyślne', () => {
  it('development (domyślne NODE_ENV): localhost, debug, ładne logi, OpenAPI włączone', () => {
    const config = loadConfig(minimal);

    expect(config).toEqual({
      env: 'development',
      release: undefined,
      http: {
        host: '127.0.0.1',
        port: 3001,
        corsOrigins: ['http://localhost:3000'],
        trustProxy: false,
        exposeErrorDetails: true,
      },
      database: { url: DATABASE_URL, poolMax: 10 },
      log: { level: 'debug', pretty: true },
      openapi: { enabled: true },
      sentry: { dsn: undefined, environment: 'development', tracesSampleRate: 0 },
    });
  });

  it('test: info, logi JSON, OpenAPI włączone, bez proxy', () => {
    const config = loadConfig({ ...minimal, NODE_ENV: 'test' });

    expect(config.env).toBe('test');
    expect(config.http.host).toBe('127.0.0.1');
    expect(config.http.trustProxy).toBe(false);
    expect(config.log).toEqual({ level: 'info', pretty: false });
    expect(config.openapi.enabled).toBe(true);
    expect(config.sentry.environment).toBe('test');
  });

  it('production: 0.0.0.0, info, JSON, OpenAPI wyłączone, proxy z sieci prywatnej', () => {
    const config = loadConfig({
      ...minimal,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://biddy.pl',
    });

    expect(config.http).toEqual({
      host: '0.0.0.0',
      port: 3001,
      corsOrigins: ['https://biddy.pl'],
      trustProxy: ['loopback', 'uniquelocal'],
      exposeErrorDetails: false,
    });
    expect(config.http.trustProxy).toBe(DEFAULT_PRODUCTION_TRUST_PROXY);
    expect(config.log).toEqual({ level: 'info', pretty: false });
    expect(config.openapi.enabled).toBe(false);
    expect(config.sentry.environment).toBe('production');
  });

  it('jawne zmienne nadpisują wartości domyślne', () => {
    const config = loadConfig({
      ...minimal,
      NODE_ENV: 'production',
      API_HOST: '::',
      CORS_ORIGINS: 'https://biddy.pl',
      TRUST_PROXY: 'false',
      LOG_LEVEL: 'warn',
      LOG_PRETTY: '1',
      OPENAPI_ENABLED: 'true',
      DATABASE_POOL_MAX: '25',
      SENTRY_DSN: 'https://abc@o1.ingest.de.sentry.io/2',
      SENTRY_ENVIRONMENT: 'staging',
      SENTRY_TRACES_SAMPLE_RATE: '0.25',
      APP_RELEASE: 'api@1.2.3',
    });

    expect(config.http.host).toBe('::');
    expect(config.http.trustProxy).toBe(false);
    expect(config.log).toEqual({ level: 'warn', pretty: true });
    expect(config.openapi.enabled).toBe(true);
    expect(config.database.poolMax).toBe(25);
    expect(config.release).toBe('api@1.2.3');
    expect(config.sentry).toEqual({
      dsn: 'https://abc@o1.ingest.de.sentry.io/2',
      environment: 'staging',
      tracesSampleRate: 0.25,
    });
  });

  it('LOG_PRETTY=false wyłącza ładne logi także w development', () => {
    expect(loadConfig({ ...minimal, LOG_PRETTY: 'false' }).log.pretty).toBe(false);
  });
});

describe('loadConfig: port', () => {
  it('PORT (platforma) ma pierwszeństwo przed API_PORT', () => {
    expect(loadConfig({ ...minimal, PORT: '10000', API_PORT: '4000' }).http.port).toBe(10_000);
  });

  it('bez PORT używa API_PORT', () => {
    expect(loadConfig({ ...minimal, API_PORT: '4000' }).http.port).toBe(4000);
  });

  it('bez obu zmiennych używa 3001', () => {
    expect(loadConfig(minimal).http.port).toBe(3001);
  });

  it('pusty PORT jest ignorowany (jak brak zmiennej)', () => {
    expect(loadConfig({ ...minimal, PORT: '', API_PORT: '4000' }).http.port).toBe(4000);
  });
});

describe('loadConfig: CORS_ORIGINS', () => {
  it('dzieli listę po przecinkach, usuwa spacje i puste pozycje', () => {
    const config = loadConfig({
      ...minimal,
      CORS_ORIGINS: ' http://localhost:3000 , https://biddy.pl,,https://admin.biddy.pl ',
    });
    expect(config.http.corsOrigins).toEqual([
      'http://localhost:3000',
      'https://biddy.pl',
      'https://admin.biddy.pl',
    ]);
  });

  it.each([
    ['ukośnik na końcu', 'http://localhost:3000/'],
    ['ścieżka', 'https://biddy.pl/app'],
    ['gwiazdka', '*'],
    ['brak schematu', 'biddy.pl'],
    ['inny schemat', 'ftp://biddy.pl'],
    ['same przecinki', ', ,'],
  ])('odrzuca: %s', (_label, value) => {
    expect(variablesWithIssues({ ...minimal, CORS_ORIGINS: value })).toEqual(['CORS_ORIGINS']);
  });

  it('na produkcji jest wymagane (domyślny localhost nie ma tam sensu)', () => {
    const issues = issuesFor({ ...minimal, NODE_ENV: 'production' });
    expect(issues.map((issue) => issue.variable)).toEqual(['CORS_ORIGINS']);
    expect(issues[0]?.message).toContain('brak zmiennej');
  });

  it('brak CORS_ORIGINS na produkcji trafia na jedną listę z innymi błędami', () => {
    const issues = issuesFor({ ...minimal, NODE_ENV: 'production', LOG_LEVEL: 'loud' });

    expect(issues.map((issue) => issue.variable)).toEqual(['LOG_LEVEL', 'CORS_ORIGINS']);
  });

  it('przy błędnym NODE_ENV nie zgłasza CORS_ORIGINS (nie wiadomo, czy to produkcja)', () => {
    expect(variablesWithIssues({ ...minimal, NODE_ENV: 'prod' })).toEqual(['NODE_ENV']);
  });
});

describe('loadConfig: TRUST_PROXY', () => {
  it.each<[value: string, expected: unknown]>([
    ['false', false],
    ['true', true],
    ['TRUE', true],
    ['uniquelocal', ['uniquelocal']],
    [' 10.0.0.0/8 , 192.168.1.10,fd00::/8 ', ['10.0.0.0/8', '192.168.1.10', 'fd00::/8']],
    ['loopback,linklocal,::1', ['loopback', 'linklocal', '::1']],
  ])('%j → %j', (value, expected) => {
    expect(loadConfig({ ...minimal, TRUST_PROXY: value }).http.trustProxy).toEqual(expected);
  });

  it.each([
    ['liczba proxy (Fastify jej nie stosuje)', '1', 'liczba proxy nie jest obsługiwana'],
    ['zero', '0', 'liczba proxy nie jest obsługiwana'],
    ['nie adres', 'yes', 'niepoprawne: yes'],
    ['zły prefiks CIDR', '10.0.0.0/33', 'niepoprawne: 10.0.0.0/33'],
    ['zły adres', '10.0.0.256', 'niepoprawne: 10.0.0.256'],
    ['same przecinki', ', ,', 'oczekiwano true, false albo listy'],
  ])('odrzuca: %s', (_label, value, message) => {
    const issues = issuesFor({ ...minimal, TRUST_PROXY: value });

    expect(issues.map((issue) => issue.variable)).toEqual(['TRUST_PROXY']);
    expect(issues[0]?.message).toContain(message);
  });
});

describe('loadConfig: szczegóły błędów w odpowiedziach (pole debug)', () => {
  it('tylko development na adresie lokalnym', () => {
    expect(loadConfig(minimal).http.exposeErrorDetails).toBe(true);
    expect(loadConfig({ ...minimal, API_HOST: 'localhost' }).http.exposeErrorDetails).toBe(true);
    expect(loadConfig({ ...minimal, API_HOST: '::1' }).http.exposeErrorDetails).toBe(true);
    expect(loadConfig({ ...minimal, NODE_ENV: 'test' }).http.exposeErrorDetails).toBe(false);
  });

  it('wdrożenie bez NODE_ENV (development) słuchające na 0.0.0.0 nie pokazuje szczegółów', () => {
    expect(loadConfig({ ...minimal, API_HOST: '0.0.0.0' }).http.exposeErrorDetails).toBe(false);
    expect(loadConfig({ ...minimal, API_HOST: '::' }).http.exposeErrorDetails).toBe(false);
    expect(loadConfig({ ...minimal, API_HOST: '10.1.2.3' }).http.exposeErrorDetails).toBe(false);
  });
});

describe('loadConfig: błędy', () => {
  it('brak DATABASE_URL', () => {
    const issues = issuesFor({});
    expect(issues).toEqual([
      { variable: 'DATABASE_URL', message: expect.stringContaining('brak zmiennej') as string },
    ]);
  });

  it('pusta wartość wymaganej zmiennej to brak zmiennej', () => {
    expect(issuesFor({ DATABASE_URL: '   ' })[0]?.message).toContain('brak zmiennej');
  });

  it.each<[variable: string, value: string]>([
    ['NODE_ENV', 'staging'],
    ['PORT', '0'],
    ['PORT', '70000'],
    ['PORT', 'abc'],
    ['PORT', '1e3'],
    ['API_PORT', '-1'],
    ['API_PORT', '3001.5'],
    ['DATABASE_URL', 'mysql://biddy:biddy@localhost:3306/biddy'],
    ['DATABASE_URL', 'postgres://biddy:biddy@localhost:5432'],
    ['DATABASE_URL', 'to nie jest adres'],
    ['DATABASE_POOL_MAX', '0'],
    ['DATABASE_POOL_MAX', '101'],
    ['DATABASE_POOL_MAX', 'dużo'],
    ['LOG_LEVEL', 'verbose'],
    ['LOG_PRETTY', 'tak'],
    ['TRUST_PROXY', 'yes'],
    ['TRUST_PROXY', '2'],
    ['OPENAPI_ENABLED', 'on'],
    ['SENTRY_DSN', 'nie-adres'],
    ['SENTRY_DSN', 'ftp://abc@sentry.io/1'],
    ['SENTRY_TRACES_SAMPLE_RATE', '1.5'],
    ['SENTRY_TRACES_SAMPLE_RATE', '-0.1'],
    ['SENTRY_TRACES_SAMPLE_RATE', 'połowa'],
  ])('%s=%j daje błąd tej zmiennej', (variable, value) => {
    const issues = issuesFor({ ...minimal, [variable]: value });
    expect(issues.map((issue) => issue.variable)).toEqual([variable]);
    expect(issues[0]?.message).not.toBe('');
  });

  it('zgłasza wszystkie złe zmienne naraz, a nie tylko pierwszą', () => {
    const variables = variablesWithIssues({
      NODE_ENV: 'staging',
      PORT: 'abc',
      API_PORT: '99999',
      LOG_LEVEL: 'loud',
      LOG_PRETTY: 'maybe',
      CORS_ORIGINS: 'http://localhost:3000/',
      TRUST_PROXY: 'x',
      OPENAPI_ENABLED: 'x',
      DATABASE_POOL_MAX: '0',
      SENTRY_DSN: 'x',
      SENTRY_TRACES_SAMPLE_RATE: '2',
    });

    expect(variables.sort()).toEqual(
      [
        'NODE_ENV',
        'PORT',
        'API_PORT',
        'DATABASE_URL',
        'DATABASE_POOL_MAX',
        'LOG_LEVEL',
        'LOG_PRETTY',
        'CORS_ORIGINS',
        'TRUST_PROXY',
        'OPENAPI_ENABLED',
        'SENTRY_DSN',
        'SENTRY_TRACES_SAMPLE_RATE',
      ].sort(),
    );
  });

  it('komunikaty są po polsku i wskazują poprawny format', () => {
    const issues = issuesFor({ ...minimal, NODE_ENV: 'staging', PORT: 'abc' });
    expect(issues).toEqual([
      {
        variable: 'NODE_ENV',
        message: 'oczekiwano jednej z wartości: development, test, production',
      },
      { variable: 'PORT', message: 'oczekiwano numeru portu (liczba całkowita 1–65535)' },
    ]);
  });

  it('ignoruje zmienne spoza schematu (np. zmienne infrastruktury)', () => {
    expect(() =>
      loadConfig({ ...minimal, REDIS_QUEUE_URL: 'cokolwiek', FOO: 'bar' }),
    ).not.toThrow();
  });

  it('ConfigError ma listę zmiennych w komunikacie, a formatConfigError dodaje wskazówkę', () => {
    let error: unknown;
    try {
      loadConfig({ PORT: 'abc' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const configError = error as ConfigError;
    expect(configError.message).toContain('Nieprawidłowa konfiguracja API');
    expect(configError.message).toContain('  • DATABASE_URL: brak zmiennej');
    expect(configError.message).toContain('  • PORT: oczekiwano numeru portu');
    expect(formatConfigError(configError)).toContain('.env.example');
  });
});

describe('ENV_KEYS', () => {
  it('obejmuje zmienne API opisane w .env.example', () => {
    expect(ENV_KEYS).toEqual(
      expect.arrayContaining([
        'NODE_ENV',
        'API_PORT',
        'DATABASE_URL',
        'CORS_ORIGINS',
        'LOG_LEVEL',
        'OPENAPI_ENABLED',
        'SENTRY_DSN',
      ]),
    );
  });
});

describe('loadSentryOptions', () => {
  it('bez SENTRY_DSN zwraca undefined (Sentry wyłączone)', () => {
    expect(loadSentryOptions({ NODE_ENV: 'production' })).toBeUndefined();
    expect(loadSentryOptions({ SENTRY_DSN: '' })).toBeUndefined();
  });

  it('czyta DSN, środowisko (domyślnie NODE_ENV), release i próbkowanie', () => {
    expect(
      loadSentryOptions({
        NODE_ENV: 'production',
        SENTRY_DSN: 'https://abc@o1.ingest.de.sentry.io/2',
        SENTRY_TRACES_SAMPLE_RATE: '0.1',
        APP_RELEASE: 'abc123',
      }),
    ).toEqual({
      dsn: 'https://abc@o1.ingest.de.sentry.io/2',
      environment: 'production',
      release: 'abc123',
      tracesSampleRate: 0.1,
    });
  });

  it('nie zależy od innych zmiennych (brak DATABASE_URL nie przeszkadza)', () => {
    expect(
      loadSentryOptions({ SENTRY_DSN: 'https://abc@o1.ingest.de.sentry.io/2' })?.environment,
    ).toBe('development');
  });

  it('błędne zmienne Sentry: undefined zamiast wyjątku (błąd zgłosi main.ts)', () => {
    expect(loadSentryOptions({ SENTRY_DSN: 'x' })).toBeUndefined();
    expect(
      loadSentryOptions({
        SENTRY_DSN: 'https://abc@o1.ingest.de.sentry.io/2',
        NODE_ENV: 'staging',
      }),
    ).toBeUndefined();
  });
});

describe('.env.example (sekcja API)', () => {
  const exampleText = readFileSync(new URL('../../../../../.env.example', import.meta.url), 'utf8');
  const example = parseEnv(exampleText) as Record<string, string>;

  /** Odkomentowane linie `# ZMIENNA=wartość` dla zmiennych API (opcjonalne są zakomentowane). */
  function uncommentedApiValues(): Record<string, string> {
    const values: Record<string, string> = {};
    for (const key of ENV_KEYS) {
      const match = new RegExp(`^# ${key}=(.*)$`, 'm').exec(exampleText);
      if (match) {
        values[key] = match[1] ?? '';
      }
    }
    return values;
  }

  it('przechodzi walidację (z odkomentowanymi zmiennymi API)', () => {
    expect(() => loadConfig({ ...example, ...uncommentedApiValues() })).not.toThrow();
  });

  it('opisuje zmienne API wartościami równymi domyślnym (odkomentowanie niczego nie zmienia)', () => {
    const documented = uncommentedApiValues();
    expect(Object.keys(documented)).toEqual(
      expect.arrayContaining([
        'API_PORT',
        'CORS_ORIGINS',
        'LOG_LEVEL',
        'OPENAPI_ENABLED',
        'SENTRY_DSN',
      ]),
    );
    expect(loadConfig({ ...example, ...documented })).toEqual(loadConfig(example));
  });
});

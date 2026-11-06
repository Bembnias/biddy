import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  ConfigError,
  DEFAULT_PRODUCTION_TRUST_PROXY,
  DEVELOPMENT_AUTH_SECRET,
  DEVELOPMENT_DATA_ENCRYPTION_KEY,
  derivedSecret,
  fakeWebhookSecret,
  TURNSTILE_TEST_SECRET_KEY,
  TURNSTILE_TEST_SITE_KEY,
  ENV_KEYS,
  type ConfigIssue,
  type ProcessRole,
  formatConfigError,
  loadBullBoardConfig,
  loadConfig,
  loadSentryOptions,
} from './config.js';

const DATABASE_URL = 'postgres://biddy:biddy@localhost:5432/biddy';
/** Bez Furgonetki (np. staging z FakeShipping). */
const NO_FURGONETKA = {
  SHIPPING_DEFAULT_PROVIDER: undefined,
  FURGONETKA_CLIENT_ID: undefined,
  FURGONETKA_CLIENT_SECRET: undefined,
  FURGONETKA_USERNAME: undefined,
  FURGONETKA_PASSWORD: undefined,
  FURGONETKA_WEBHOOK_TOKEN: undefined,
} as const;
/** Komplet zmiennych Furgonetki (F-24). */
const FURGONETKA = {
  SHIPPING_DEFAULT_PROVIDER: 'furgonetka',
  FURGONETKA_CLIENT_ID: 'furgonetka-client',
  FURGONETKA_CLIENT_SECRET: 'furgonetka-secret',
  FURGONETKA_USERNAME: 'sklep@biddy.pl',
  FURGONETKA_PASSWORD: 'haslo-konta',
  FURGONETKA_WEBHOOK_TOKEN: 'webhook-token',
} as const;
const minimal = { DATABASE_URL } as const;
/** Minimum na produkcji: adres Redisa kolejek nie ma tam wartości domyślnej. */
const production = {
  ...minimal,
  NODE_ENV: 'production',
  REDIS_QUEUE_URL: 'redis://red-queue.internal:6379',
  REDIS_CACHE_URL: 'redis://red-cache.internal:6379',
  RESEND_API_KEY: 're_test_key',
  BETTER_AUTH_SECRET: 'prod-secret-0123456789-0123456789-abcdef',
  API_PUBLIC_URL: 'https://api.biddy.pl',
  WEB_URL: 'https://biddy.pl',
  TURNSTILE_SITE_KEY: '0x4AAAAAAA-site',
  TURNSTILE_SECRET_KEY: '0x4AAAAAAA-secret',
  SMSAPI_TOKEN: 'smsapi-token',
  S3_ENDPOINT: 'https://konto.r2.cloudflarestorage.com',
  S3_ACCESS_KEY_ID: 'r2-key',
  S3_SECRET_ACCESS_KEY: 'r2-secret',
  MEDIA_PUBLIC_URL: 'https://media.biddy.pl',
  WEB_REVALIDATE_SECRET: 'revalidate-secret-0123456789-0123456789',
  MEILI_URL: 'https://ms-test.meilisearch.io',
  MEILI_API_KEY: 'meili-production-key-0123456789',
  DATA_ENCRYPTION_KEY: 'cHJvZHVjdGlvbi1kYXRhLWtleS0wMTIzNDU2Nzg5YWI=',
  // Na produkcji operator jest wymagany, a FakeGateway zablokowany (F-23).
  PAYMENTS_DEFAULT_PROVIDER: 'payu',
  // Na produkcji dostawca przesyłek jest wymagany, a FakeShipping zablokowany (F-24).
  ...FURGONETKA,
} as const;

function issuesFor(
  env: Record<string, string | undefined>,
  role: ProcessRole = 'api',
): ConfigIssue[] {
  try {
    loadConfig(env, role);
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
      deployment: 'local',
      release: undefined,
      http: {
        host: '127.0.0.1',
        port: 3001,
        corsOrigins: ['http://localhost:3000'],
        trustProxy: false,
        exposeErrorDetails: true,
      },
      database: { url: DATABASE_URL, poolMax: 10 },
      queues: { redisUrl: 'redis://localhost:6379', prefix: 'biddy', outboxPollIntervalMs: 250 },
      auth: {
        secret: DEVELOPMENT_AUTH_SECRET,
        apiUrl: 'http://localhost:3001',
        webUrl: 'http://localhost:3000',
        cookieDomain: undefined,
        secureCookies: false,
        google: undefined,
        apple: undefined,
        turnstile: { siteKey: TURNSTILE_TEST_SITE_KEY, secretKey: TURNSTILE_TEST_SECRET_KEY },
      },
      mail: {
        from: 'Biddy <no-reply@biddy.local>',
        transport: {
          kind: 'smtp',
          host: 'localhost',
          port: 1025,
          user: undefined,
          password: undefined,
        },
      },
      cache: { redisUrl: 'redis://localhost:6380' },
      log: { level: 'debug', pretty: true },
      openapi: { enabled: true },
      sms: { kind: 'log' },
      storage: {
        endpoint: 'http://localhost:9000',
        region: 'us-east-1',
        accessKeyId: 'biddy-local',
        secretAccessKey: 'biddy-local-secret',
        forcePathStyle: true,
        mediaBucket: 'biddy-media',
        uploadsBucket: 'biddy-uploads',
        mediaPublicUrl: 'http://localhost:9000/biddy-media',
      },
      auctions: { antiSnipingWindowMs: 120_000 },
      search: {
        url: 'http://localhost:7700',
        apiKey: 'biddy-local-meili-master-key',
        indexPrefix: 'biddy',
      },
      web: { url: 'http://localhost:3000', revalidateSecret: undefined },
      payments: {
        defaultProvider: 'fake',
        dataEncryptionKey: DEVELOPMENT_DATA_ENCRYPTION_KEY,
        fake: {
          enabled: true,
          webhookUrl: 'http://localhost:3001/v1/webhooks/payments/fake',
          webhookDelayMs: 2_000,
          webhookSecret: fakeWebhookSecret(DEVELOPMENT_AUTH_SECRET),
        },
      },
      shipping: {
        defaultProvider: 'fake',
        pointsProvider: 'fake',
        fake: {
          enabled: true,
          webhookUrl: 'http://localhost:3001/v1/webhooks/shipping/fake',
          stepDelayMs: 20_000,
          webhookSecret: derivedSecret(DEVELOPMENT_AUTH_SECRET, 'biddy:fake-shipping-webhook'),
        },
        furgonetka: undefined,
      },
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
    const config = loadConfig({ ...production, CORS_ORIGINS: 'https://biddy.pl' });

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
      ...production,
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
      QUEUE_PREFIX: 'biddy-staging',
      OUTBOX_POLL_INTERVAL_MS: '1000',
    });

    expect(config.http.host).toBe('::');
    expect(config.queues).toEqual({
      redisUrl: 'redis://red-queue.internal:6379',
      prefix: 'biddy-staging',
      outboxPollIntervalMs: 1000,
    });
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
    const issues = issuesFor(production);
    expect(issues.map((issue) => issue.variable)).toEqual(['CORS_ORIGINS']);
    expect(issues[0]?.message).toContain('brak zmiennej');
  });

  it('brak CORS_ORIGINS na produkcji trafia na jedną listę z innymi błędami', () => {
    const issues = issuesFor({ ...production, LOG_LEVEL: 'loud' });

    expect(issues.map((issue) => issue.variable)).toEqual(['LOG_LEVEL', 'CORS_ORIGINS']);
  });

  it('worker go nie wymaga (nie obsługuje HTTP)', () => {
    expect(loadConfig(production, 'worker').env).toBe('production');
  });

  it('przy błędnym NODE_ENV nie zgłasza CORS_ORIGINS (nie wiadomo, czy to produkcja)', () => {
    expect(variablesWithIssues({ ...minimal, NODE_ENV: 'prod' })).toEqual(['NODE_ENV']);
  });
});

describe('loadConfig: kolejki (Redis, prefiks, relay outboxa)', () => {
  it('poza produkcją domyślnie lokalny Redis z infra/docker-compose.yml', () => {
    expect(loadConfig({ ...minimal, NODE_ENV: 'test' }).queues.redisUrl).toBe(
      'redis://localhost:6379',
    );
  });

  it.each<ProcessRole>(['api', 'worker'])(
    'na produkcji REDIS_QUEUE_URL jest wymagany (%s)',
    (role) => {
      const issues = issuesFor(
        { ...production, REDIS_QUEUE_URL: undefined, CORS_ORIGINS: 'https://biddy.pl' },
        role,
      );
      expect(issues.map((issue) => issue.variable)).toEqual(['REDIS_QUEUE_URL']);
      expect(issues[0]?.message).toContain('noeviction');
    },
  );

  it('przyjmuje redis:// i rediss:// (TLS), także z numerem bazy', () => {
    expect(
      loadConfig({ ...minimal, REDIS_QUEUE_URL: 'rediss://user:pass@redis.example:6380/2' }).queues
        .redisUrl,
    ).toBe('rediss://user:pass@redis.example:6380/2');
  });

  it.each([
    ['inny protokół', { REDIS_QUEUE_URL: 'http://localhost:6379' }, 'REDIS_QUEUE_URL'],
    ['prefiks z dwukropkiem', { QUEUE_PREFIX: 'biddy:prod' }, 'QUEUE_PREFIX'],
    ['prefiks z wielką literą', { QUEUE_PREFIX: 'Biddy' }, 'QUEUE_PREFIX'],
    ['za krótki odstęp relaya', { OUTBOX_POLL_INTERVAL_MS: '5' }, 'OUTBOX_POLL_INTERVAL_MS'],
    ['odstęp relaya nie liczbą', { OUTBOX_POLL_INTERVAL_MS: '1s' }, 'OUTBOX_POLL_INTERVAL_MS'],
  ])('odrzuca: %s', (_label, env, variable) => {
    expect(variablesWithIssues({ ...minimal, ...env })).toEqual([variable]);
  });
});

describe('loadConfig: płatności i środowisko wdrożenia (F-23)', () => {
  const staging = {
    ...production,
    CORS_ORIGINS: 'https://staging.biddy.pl',
    DEPLOYMENT_ENV: 'staging',
    PAYMENTS_DEFAULT_PROVIDER: undefined,
    ...NO_FURGONETKA,
  };

  it('poza produkcją domyślnie FakeGateway z webhookiem na lokalne API', () => {
    const config = loadConfig({ ...minimal, NODE_ENV: 'test', API_PORT: '4000' });
    expect(config.deployment).toBe('local');
    expect(config.payments.defaultProvider).toBe('fake');
    expect(config.payments.fake).toMatchObject({
      enabled: true,
      webhookUrl: 'http://localhost:4000/v1/webhooks/payments/fake',
      webhookDelayMs: 2_000,
    });
  });

  it.each<ProcessRole>(['api', 'worker'])(
    'NODE_ENV=production bez DEPLOYMENT_ENV to produkcja: fake odrzucony (%s)',
    (role) => {
      const issues = issuesFor(
        { ...production, CORS_ORIGINS: 'https://biddy.pl', PAYMENTS_DEFAULT_PROVIDER: 'fake' },
        role,
      );
      expect(issues.map((issue) => issue.variable)).toEqual(['PAYMENTS_DEFAULT_PROVIDER']);
      expect(issues[0]?.message).toContain('nie może działać na produkcji');
      expect(issues[0]?.message).toContain('DEPLOYMENT_ENV=staging');
    },
  );

  it('jawne DEPLOYMENT_ENV=production blokuje fake także przy NODE_ENV=development', () => {
    expect(
      variablesWithIssues({
        ...minimal,
        DEPLOYMENT_ENV: 'production',
        PAYMENTS_DEFAULT_PROVIDER: 'fake',
        ...FURGONETKA,
      }),
    ).toEqual(['PAYMENTS_DEFAULT_PROVIDER']);
  });

  it('na produkcji operator jest wymagany, a FakeGateway wyłączony', () => {
    const issues = issuesFor({
      ...production,
      CORS_ORIGINS: 'https://biddy.pl',
      PAYMENTS_DEFAULT_PROVIDER: undefined,
    });
    expect(issues.map((issue) => issue.variable)).toEqual(['PAYMENTS_DEFAULT_PROVIDER']);
    expect(issues[0]?.message).toContain('brak zmiennej');

    const config = loadConfig({ ...production, CORS_ORIGINS: 'https://biddy.pl' });
    expect(config.deployment).toBe('production');
    expect(config.payments.defaultProvider).toBe('payu');
    expect(config.payments.fake.enabled).toBe(false);
  });

  it('klucz szyfrowania danych do wypłat (F-27): 32 bajty w base64, na produkcji z env', () => {
    const config = loadConfig({ ...production, CORS_ORIGINS: 'https://biddy.pl' });
    expect(config.payments.dataEncryptionKey).toBe(production.DATA_ENCRYPTION_KEY);
    expect(loadConfig(minimal).payments.dataEncryptionKey).toBe(DEVELOPMENT_DATA_ENCRYPTION_KEY);
    for (const key of ['krótki', Buffer.alloc(16).toString('base64'), `${'A'.repeat(43)}`]) {
      expect(variablesWithIssues({ ...minimal, DATA_ENCRYPTION_KEY: key })).toEqual([
        'DATA_ENCRYPTION_KEY',
      ]);
    }
  });

  it('staging (DEPLOYMENT_ENV=staging) działa z FakeGateway i adresem webhooka z API_PUBLIC_URL', () => {
    const api = loadConfig(staging, 'api');
    expect(api.env).toBe('production');
    expect(api.deployment).toBe('staging');
    expect(api.payments.defaultProvider).toBe('fake');
    expect(api.payments.fake.enabled).toBe(true);
    expect(api.payments.fake.webhookUrl).toBe('https://api.biddy.pl/v1/webhooks/payments/fake');
  });

  it('worker na stagingu bez API_PUBLIC_URL wymaga PAYMENTS_FAKE_WEBHOOK_URL', () => {
    const worker = { ...staging, API_PUBLIC_URL: undefined };
    const issues = issuesFor(worker, 'worker');
    expect(issues.map((issue) => issue.variable)).toEqual([
      'PAYMENTS_FAKE_WEBHOOK_URL',
      'SHIPPING_FAKE_WEBHOOK_URL',
    ]);
    expect(issues[0]?.message).toContain('webhooki FakeGateway');
    expect(issues[1]?.message).toContain('webhooki FakeShipping');

    const config = loadConfig(
      {
        ...worker,
        PAYMENTS_FAKE_WEBHOOK_URL: 'http://staging-api:3001/v1/webhooks/payments/fake',
        PAYMENTS_FAKE_WEBHOOK_DELAY_MS: '500',
        SHIPPING_FAKE_WEBHOOK_URL: 'http://staging-api:3001/v1/webhooks/shipping/fake',
      },
      'worker',
    );
    expect(config.payments.fake).toMatchObject({
      webhookUrl: 'http://staging-api:3001/v1/webhooks/payments/fake',
      webhookDelayMs: 500,
    });
  });

  it('sekret webhooków wynika z BETTER_AUTH_SECRET: ten sam w API i workerze, inny niż sam sekret', () => {
    const api = loadConfig(staging, 'api');
    const worker = loadConfig(staging, 'worker');
    expect(api.payments.fake.webhookSecret).toBe(worker.payments.fake.webhookSecret);
    expect(api.payments.fake.webhookSecret).not.toBe(production.BETTER_AUTH_SECRET);
    expect(api.payments.fake.webhookSecret).not.toBe(
      loadConfig(minimal).payments.fake.webhookSecret,
    );
  });

  it.each([
    ['nieznane środowisko', { DEPLOYMENT_ENV: 'qa' }, 'DEPLOYMENT_ENV'],
    [
      'operator wielkimi literami',
      { PAYMENTS_DEFAULT_PROVIDER: 'PayU' },
      'PAYMENTS_DEFAULT_PROVIDER',
    ],
    [
      'adres webhooka bez schematu',
      { PAYMENTS_FAKE_WEBHOOK_URL: 'api/webhooks' },
      'PAYMENTS_FAKE_WEBHOOK_URL',
    ],
    [
      'ujemne opóźnienie',
      { PAYMENTS_FAKE_WEBHOOK_DELAY_MS: '-1' },
      'PAYMENTS_FAKE_WEBHOOK_DELAY_MS',
    ],
  ])('odrzuca: %s', (_label, env, variable) => {
    expect(variablesWithIssues({ ...minimal, ...env })).toEqual([variable]);
  });
});

describe('loadConfig: dostawy (F-24)', () => {
  it('poza produkcją domyślnie FakeShipping z automatem co 20 s i webhookiem na lokalne API', () => {
    const config = loadConfig({ ...minimal, NODE_ENV: 'test', API_PORT: '4000' });
    expect(config.shipping).toEqual({
      defaultProvider: 'fake',
      pointsProvider: 'fake',
      fake: {
        enabled: true,
        webhookUrl: 'http://localhost:4000/v1/webhooks/shipping/fake',
        stepDelayMs: 20_000,
        webhookSecret: derivedSecret(DEVELOPMENT_AUTH_SECRET, 'biddy:fake-shipping-webhook'),
      },
      furgonetka: undefined,
    });
  });

  it.each<ProcessRole>(['api', 'worker'])(
    'na produkcji dostawca jest wymagany, a fake odrzucony (%s)',
    (role) => {
      const base = { ...production, CORS_ORIGINS: 'https://biddy.pl' };
      const missing = issuesFor({ ...base, SHIPPING_DEFAULT_PROVIDER: undefined }, role);
      expect(missing.map((issue) => issue.variable)).toEqual(['SHIPPING_DEFAULT_PROVIDER']);
      expect(missing[0]?.message).toContain('brak zmiennej');

      const fake = issuesFor({ ...base, SHIPPING_DEFAULT_PROVIDER: 'fake' }, role);
      expect(fake.map((issue) => issue.variable)).toEqual(['SHIPPING_DEFAULT_PROVIDER']);
      expect(fake[0]?.message).toContain('nie może działać na produkcji');
    },
  );

  it('produkcja z Furgonetką: adres API produkcyjny, FakeShipping wyłączony', () => {
    const config = loadConfig({ ...production, CORS_ORIGINS: 'https://biddy.pl' });
    expect(config.shipping.defaultProvider).toBe('furgonetka');
    expect(config.shipping.fake.enabled).toBe(false);
    expect(config.shipping.furgonetka).toEqual({
      apiUrl: 'https://api.furgonetka.pl',
      clientId: 'furgonetka-client',
      clientSecret: 'furgonetka-secret',
      username: 'sklep@biddy.pl',
      password: 'haslo-konta',
      webhookToken: 'webhook-token',
    });
  });

  it('zmienne Furgonetki idą w komplecie; poza produkcją domyślnie sandbox', () => {
    expect(
      variablesWithIssues({ ...minimal, FURGONETKA_CLIENT_ID: 'id', FURGONETKA_PASSWORD: 'x' }),
    ).toEqual(['FURGONETKA_CLIENT_SECRET', 'FURGONETKA_USERNAME', 'FURGONETKA_WEBHOOK_TOKEN']);
    expect(variablesWithIssues({ ...minimal, SHIPPING_DEFAULT_PROVIDER: 'furgonetka' })).toEqual([
      'FURGONETKA_CLIENT_ID',
      'FURGONETKA_CLIENT_SECRET',
      'FURGONETKA_USERNAME',
      'FURGONETKA_PASSWORD',
      'FURGONETKA_WEBHOOK_TOKEN',
    ]);
    const config = loadConfig({ ...minimal, ...FURGONETKA });
    expect(config.shipping.furgonetka?.apiUrl).toBe('https://api.sandbox.furgonetka.pl');
    expect(config.shipping.fake.enabled).toBe(true);
  });

  it('dostawca punktów (F-64): domyślnie jak przesyłek; staging: Furgonetka przy FakeShipping', () => {
    expect(
      loadConfig({ ...minimal, SHIPPING_DEFAULT_PROVIDER: 'fake' }).shipping.pointsProvider,
    ).toBe('fake');
    const staging = loadConfig({
      ...minimal,
      ...FURGONETKA,
      SHIPPING_DEFAULT_PROVIDER: 'fake',
      SHIPPING_POINTS_PROVIDER: 'furgonetka',
    });
    expect(staging.shipping).toMatchObject({
      defaultProvider: 'fake',
      pointsProvider: 'furgonetka',
    });
    expect(
      loadConfig({ ...minimal, ...FURGONETKA, SHIPPING_DEFAULT_PROVIDER: 'furgonetka' }).shipping
        .pointsProvider,
    ).toBe('furgonetka');
    expect(variablesWithIssues({ ...minimal, SHIPPING_POINTS_PROVIDER: 'furgonetka' })).toEqual([
      'FURGONETKA_CLIENT_ID',
      'FURGONETKA_CLIENT_SECRET',
      'FURGONETKA_USERNAME',
      'FURGONETKA_PASSWORD',
      'FURGONETKA_WEBHOOK_TOKEN',
    ]);
    expect(
      variablesWithIssues({
        ...minimal,
        ...FURGONETKA,
        SHIPPING_DEFAULT_PROVIDER: 'furgonetka',
        SHIPPING_POINTS_PROVIDER: 'fake',
      }),
    ).toEqual(['SHIPPING_POINTS_PROVIDER']);
    const base = { ...production, CORS_ORIGINS: 'https://biddy.pl' };
    expect(
      issuesFor(
        { ...base, SHIPPING_DEFAULT_PROVIDER: undefined, SHIPPING_POINTS_PROVIDER: 'fake' },
        'api',
      ).map((issue) => issue.variable),
    ).toEqual(['SHIPPING_DEFAULT_PROVIDER', 'SHIPPING_POINTS_PROVIDER']);
  });

  it('sekret webhooków FakeShipping różni się od sekretu FakeGateway', () => {
    const config = loadConfig(minimal);
    expect(config.shipping.fake.webhookSecret).not.toBe(config.payments.fake.webhookSecret);
  });

  it.each([
    ['nieznany dostawca', { SHIPPING_DEFAULT_PROVIDER: 'inpost' }, 'SHIPPING_DEFAULT_PROVIDER'],
    [
      'ujemny odstęp automatu',
      { SHIPPING_FAKE_STEP_DELAY_MS: '-1' },
      'SHIPPING_FAKE_STEP_DELAY_MS',
    ],
  ])('odrzuca: %s', (_label, env, variable) => {
    expect(variablesWithIssues({ ...minimal, ...env })).toEqual([variable]);
  });
});

describe('loadConfig: magazyn plików (F-12)', () => {
  it('produkcja: R2 z publicznym adresem CDN (bez ukośnika na końcu)', () => {
    const config = loadConfig({
      ...production,
      CORS_ORIGINS: 'https://biddy.pl',
      S3_REGION: 'auto',
      S3_FORCE_PATH_STYLE: 'false',
      MEDIA_PUBLIC_URL: 'https://media.biddy.pl/',
    });
    expect(config.storage).toEqual({
      endpoint: 'https://konto.r2.cloudflarestorage.com',
      region: 'auto',
      accessKeyId: 'r2-key',
      secretAccessKey: 'r2-secret',
      forcePathStyle: false,
      mediaBucket: 'biddy-media',
      uploadsBucket: 'biddy-uploads',
      mediaPublicUrl: 'https://media.biddy.pl',
    });
  });

  it('odrzuca złą nazwę kubełka', () => {
    expect(variablesWithIssues({ ...minimal, S3_BUCKET_UPLOADS: 'Uploads_Bucket' })).toEqual([
      'S3_BUCKET_UPLOADS',
    ]);
  });
});

describe('loadConfig: SMS-y (F-08)', () => {
  it('bez SMSAPI_TOKEN atrapa (kod w logu), z tokenem SMSAPI z opcjonalnym nadawcą', () => {
    expect(loadConfig(minimal).sms).toEqual({ kind: 'log' });
    expect(loadConfig({ ...minimal, SMSAPI_TOKEN: 't0k3n', SMSAPI_SENDER: 'Biddy' }).sms).toEqual({
      kind: 'smsapi',
      token: 't0k3n',
      sender: 'Biddy',
    });
  });

  it('odrzuca nazwę nadawcy dłuższą niż 11 znaków', () => {
    expect(variablesWithIssues({ ...minimal, SMSAPI_SENDER: 'Biddy-Aukcje-PL' })).toEqual([
      'SMSAPI_SENDER',
    ]);
  });

  describe('SMS_LOG_ONLY (atrapa z kodem w logu na stagingu)', () => {
    const staging = {
      ...production,
      CORS_ORIGINS: 'https://staging.biddy.pl',
      DEPLOYMENT_ENV: 'staging',
      PAYMENTS_DEFAULT_PROVIDER: undefined,
      ...NO_FURGONETKA,
    };

    it('włączone przełącza na atrapę nawet z tokenem; wyłączone zostawia SMSAPI', () => {
      const withToken = { ...minimal, SMSAPI_TOKEN: 't0k3n' };
      expect(loadConfig({ ...withToken, SMS_LOG_ONLY: 'true' }).sms).toEqual({ kind: 'log' });
      expect(loadConfig({ ...withToken, SMS_LOG_ONLY: '1' }).sms).toEqual({ kind: 'log' });
      expect(loadConfig({ ...withToken, SMS_LOG_ONLY: 'false' }).sms).toMatchObject({
        kind: 'smsapi',
      });
    });

    it('odrzuca wartość inną niż true i false', () => {
      expect(variablesWithIssues({ ...minimal, SMS_LOG_ONLY: 'tak' })).toEqual(['SMS_LOG_ONLY']);
    });

    it('staging bez tokenu wymaga SMSAPI_TOKEN, a z SMS_LOG_ONLY=true startuje z atrapą', () => {
      expect(variablesWithIssues({ ...staging, SMSAPI_TOKEN: undefined })).toEqual([
        'SMSAPI_TOKEN',
      ]);
      expect(loadConfig({ ...staging, SMSAPI_TOKEN: undefined, SMS_LOG_ONLY: 'true' }).sms).toEqual(
        { kind: 'log' },
      );
    });

    it('na produkcji jest odrzucane, z tokenem i bez niego', () => {
      const prod = { ...production, CORS_ORIGINS: 'https://biddy.pl' };
      expect(variablesWithIssues({ ...prod, SMS_LOG_ONLY: 'true' })).toEqual(['SMS_LOG_ONLY']);
      expect(
        variablesWithIssues({ ...prod, SMSAPI_TOKEN: undefined, SMS_LOG_ONLY: 'true' }),
      ).toEqual(['SMS_LOG_ONLY']);
      expect(loadConfig({ ...prod, SMS_LOG_ONLY: 'false' }).sms).toMatchObject({ kind: 'smsapi' });
    });
  });
});

describe('loadConfig: konta i e-maile (F-07)', () => {
  it('na produkcji API wymaga sekretu, adresów, Turnstile, Redisa cache, Resend, S3, Meilisearch i klucza danych; worker Redisa cache, Resend, S3, Meilisearch, rewalidacji web, sekretu linków i klucza danych', () => {
    const missing = {
      ...minimal,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://biddy.pl',
      REDIS_QUEUE_URL: 'redis://red-queue.internal:6379',
    };
    expect(variablesWithIssues(missing).sort()).toEqual(
      [
        'API_PUBLIC_URL',
        'BETTER_AUTH_SECRET',
        'DATA_ENCRYPTION_KEY',
        'MEDIA_PUBLIC_URL',
        'MEILI_API_KEY',
        'MEILI_URL',
        'REDIS_CACHE_URL',
        'RESEND_API_KEY',
        'S3_ACCESS_KEY_ID',
        'S3_ENDPOINT',
        'S3_SECRET_ACCESS_KEY',
        'SMSAPI_TOKEN',
        'TURNSTILE_SECRET_KEY',
        'TURNSTILE_SITE_KEY',
        'WEB_URL',
        'PAYMENTS_DEFAULT_PROVIDER',
        'SHIPPING_DEFAULT_PROVIDER',
      ].sort(),
    );
    expect(issuesFor(missing, 'worker').map((issue) => issue.variable)).toEqual([
      'REDIS_CACHE_URL',
      'WEB_URL',
      'BETTER_AUTH_SECRET',
      'RESEND_API_KEY',
      'S3_ENDPOINT',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'MEDIA_PUBLIC_URL',
      'MEILI_URL',
      'MEILI_API_KEY',
      'WEB_REVALIDATE_SECRET',
      'PAYMENTS_DEFAULT_PROVIDER',
      'DATA_ENCRYPTION_KEY',
      'SHIPPING_DEFAULT_PROVIDER',
    ]);
  });

  it('produkcja: Resend, bezpieczne ciasteczka, adresy bez ukośnika na końcu', () => {
    const config = loadConfig({
      ...production,
      CORS_ORIGINS: 'https://biddy.pl',
      API_PUBLIC_URL: 'https://api.biddy.pl/',
      AUTH_COOKIE_DOMAIN: 'biddy.pl',
    });
    expect(config.auth).toMatchObject({
      apiUrl: 'https://api.biddy.pl',
      webUrl: 'https://biddy.pl',
      cookieDomain: 'biddy.pl',
      secureCookies: true,
      turnstile: { siteKey: '0x4AAAAAAA-site', secretKey: '0x4AAAAAAA-secret' },
    });
    expect(config.mail.transport).toEqual({ kind: 'resend', apiKey: 're_test_key' });
  });

  it('Google i Apple włączone tylko z parą kluczy; sam identyfikator albo sam sekret to błąd', () => {
    const config = loadConfig({
      ...minimal,
      GOOGLE_CLIENT_ID: 'g-id',
      GOOGLE_CLIENT_SECRET: 'g-secret',
    });
    expect(config.auth.google).toEqual({ clientId: 'g-id', clientSecret: 'g-secret' });
    expect(config.auth.apple).toBeUndefined();
    expect(variablesWithIssues({ ...minimal, APPLE_CLIENT_ID: 'a-id' })).toEqual([
      'APPLE_CLIENT_SECRET',
    ]);
    expect(variablesWithIssues({ ...minimal, GOOGLE_CLIENT_SECRET: 's' })).toEqual([
      'GOOGLE_CLIENT_ID',
    ]);
  });

  it.each([
    ['za krótki sekret', { BETTER_AUTH_SECRET: 'krotki' }, 'BETTER_AUTH_SECRET'],
    [
      'domena ciasteczka z protokołem',
      { AUTH_COOKIE_DOMAIN: 'https://biddy.pl' },
      'AUTH_COOKIE_DOMAIN',
    ],
    ['WEB_URL bez protokołu', { WEB_URL: 'biddy.pl' }, 'WEB_URL'],
  ])('odrzuca: %s', (_label, env, variable) => {
    expect(variablesWithIssues({ ...minimal, ...env })).toEqual([variable]);
  });
});

describe('loadBullBoardConfig', () => {
  it('nie wymaga DATABASE_URL; domyślnie lokalny Redis, prefiks biddy i port 3002 na 127.0.0.1', () => {
    expect(loadBullBoardConfig({})).toEqual({
      redisUrl: 'redis://localhost:6379',
      prefix: 'biddy',
      host: '127.0.0.1',
      port: 3002,
    });
  });

  it('czyta REDIS_QUEUE_URL, QUEUE_PREFIX i BULL_BOARD_PORT', () => {
    expect(
      loadBullBoardConfig({
        REDIS_QUEUE_URL: 'redis://127.0.0.1:6390',
        QUEUE_PREFIX: 'biddy-e2e',
        BULL_BOARD_PORT: '4000',
      }),
    ).toMatchObject({ redisUrl: 'redis://127.0.0.1:6390', prefix: 'biddy-e2e', port: 4000 });
  });

  it('odmawia na produkcji (panel bez uwierzytelniania)', () => {
    expect(() => loadBullBoardConfig({ NODE_ENV: 'production' })).toThrow(/tylko poza produkcją/);
  });

  it('zgłasza błędne zmienne jako ConfigError', () => {
    expect(() => loadBullBoardConfig({ BULL_BOARD_PORT: '70000' })).toThrow(ConfigError);
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
    expect(() => loadConfig({ ...minimal, MEILI_PORT: 'cokolwiek', FOO: 'bar' })).not.toThrow();
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

  it('release: APP_RELEASE, a bez niego SHA commita z Render (RENDER_GIT_COMMIT)', () => {
    const dsn = 'https://abc@o1.ingest.de.sentry.io/2';
    expect(loadSentryOptions({ SENTRY_DSN: dsn, RENDER_GIT_COMMIT: 'f00d' })?.release).toBe('f00d');
    expect(
      loadSentryOptions({ SENTRY_DSN: dsn, RENDER_GIT_COMMIT: 'f00d', APP_RELEASE: 'api@1' })
        ?.release,
    ).toBe('api@1');
    expect(loadConfig({ ...minimal, RENDER_GIT_COMMIT: 'f00d' }).release).toBe('f00d');
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

  /** Sekcja „API” pliku (od jej nagłówka do następnej sekcji). */
  const apiSection =
    /^# --- API \(apps\/api\)[^\n]*\n([\s\S]*?)(?=^# --- |(?![\s\S]))/m.exec(exampleText)?.[1] ??
    '';

  /** Odkomentowane linie `# ZMIENNA=wartość` z sekcji API (opcjonalne są zakomentowane). */
  function uncommentedApiValues(): Record<string, string> {
    const values: Record<string, string> = {};
    for (const key of ENV_KEYS) {
      const match = new RegExp(`^# ${key}=(.*)$`, 'm').exec(apiSection);
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
        'BETTER_AUTH_SECRET',
        'API_PUBLIC_URL',
        'WEB_URL',
        'AUTH_COOKIE_DOMAIN',
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'APPLE_CLIENT_ID',
        'APPLE_CLIENT_SECRET',
        'APPLE_APP_BUNDLE_ID',
        'TURNSTILE_SITE_KEY',
        'TURNSTILE_SECRET_KEY',
        'RESEND_API_KEY',
        'SMSAPI_TOKEN',
        'SMSAPI_SENDER',
        'SMS_LOG_ONLY',
        'MEDIA_PUBLIC_URL',
        'AUCTION_ANTI_SNIPING_SECONDS',
      ]),
    );
    expect(loadConfig({ ...example, ...documented })).toEqual(loadConfig(example));
  });
});

describe('loadConfig: aukcje (F-15)', () => {
  it('okno anti-snipingu: domyślnie 120 s, zmienna w sekundach, 0 wyłącza', () => {
    expect(loadConfig(minimal).auctions.antiSnipingWindowMs).toBe(120_000);
    expect(
      loadConfig({ ...minimal, AUCTION_ANTI_SNIPING_SECONDS: '30' }).auctions.antiSnipingWindowMs,
    ).toBe(30_000);
    expect(
      loadConfig({ ...minimal, AUCTION_ANTI_SNIPING_SECONDS: '0' }).auctions.antiSnipingWindowMs,
    ).toBe(0);
    expect(() => loadConfig({ ...minimal, AUCTION_ANTI_SNIPING_SECONDS: '-1' })).toThrow();
  });
});

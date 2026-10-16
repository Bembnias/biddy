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

/** Nazwa kubełka S3: 3–63 znaki, małe litery, cyfry, kropki i myślniki. */
function bucketName() {
  return text().regex(
    /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/,
    'oczekiwano nazwy kubełka (3–63 znaki: małe litery, cyfry, kropki, myślniki)',
  );
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
  // Redis kolejek BullMQ (maxmemory-policy noeviction, PROJECT.md §11.2). Cache ma osobną instancję.
  REDIS_QUEUE_URL: url(['redis:', 'rediss:'], 'redis://localhost:6379').optional(),
  // Redis cache i pub/sub Socket.IO (allkeys-lru, PROJECT.md §11.2): druga instancja, bez jobów.
  REDIS_CACHE_URL: url(['redis:', 'rediss:'], 'redis://localhost:6380').optional(),
  QUEUE_PREFIX: text()
    .regex(
      /^[a-z0-9][a-z0-9_-]{0,31}$/,
      'oczekiwano 1–32 znaków: małe litery, cyfry, _ i - (bez dwukropka), np. biddy',
    )
    .optional(),
  OUTBOX_POLL_INTERVAL_MS: integer(10, 60_000).optional(),
  BULL_BOARD_PORT: port().optional(),
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
  // SHA commita, który Render podaje sam przy każdym deployu: wersja dla Sentry, gdy brak
  // APP_RELEASE (F-09).
  RENDER_GIT_COMMIT: text().optional(),
  // Konta i logowanie (Better Auth, F-07).
  API_PUBLIC_URL: url(['https:', 'http:'], 'https://api.biddy.pl').optional(),
  WEB_URL: url(['https:', 'http:'], 'https://biddy.pl').optional(),
  BETTER_AUTH_SECRET: text()
    .min(32, 'oczekiwano co najmniej 32 znaków (np. openssl rand -base64 32)')
    .optional(),
  AUTH_COOKIE_DOMAIN: text()
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'oczekiwano domeny bez protokołu, np. biddy.pl')
    .optional(),
  GOOGLE_CLIENT_ID: text().optional(),
  GOOGLE_CLIENT_SECRET: text().optional(),
  APPLE_CLIENT_ID: text().optional(),
  APPLE_CLIENT_SECRET: text().optional(),
  APPLE_APP_BUNDLE_ID: text().optional(),
  TURNSTILE_SITE_KEY: text().optional(),
  TURNSTILE_SECRET_KEY: text().optional(),
  // E-maile (weryfikacja, reset hasła): Resend z kluczem, inaczej SMTP (lokalnie Mailpit).
  MAIL_FROM: text().optional(),
  RESEND_API_KEY: text().optional(),
  SMTP_HOST: text().optional(),
  SMTP_PORT: port().optional(),
  SMTP_USER: text().optional(),
  SMTP_PASSWORD: text().optional(),
  // SMS-y z kodami weryfikacji telefonu (SMSAPI, F-08); bez tokenu atrapa (kod w logu).
  SMSAPI_TOKEN: text().optional(),
  SMSAPI_SENDER: text()
    .regex(/^[A-Za-z0-9 .-]{1,11}$/, 'oczekiwano nazwy nadawcy do 11 znaków (litery, cyfry)')
    .optional(),
  // Magazyn plików S3 (F-12): Cloudflare R2 na produkcji, lokalnie RustFS (te same zmienne co
  // `pnpm storage:setup`).
  S3_ENDPOINT: url(['https:', 'http:'], 'https://<konto>.r2.cloudflarestorage.com').optional(),
  S3_REGION: text().optional(),
  S3_ACCESS_KEY_ID: text().optional(),
  S3_SECRET_ACCESS_KEY: text().optional(),
  S3_FORCE_PATH_STYLE: boolean().optional(),
  S3_BUCKET_MEDIA: bucketName().optional(),
  S3_BUCKET_UPLOADS: bucketName().optional(),
  /** Publiczny adres kubełka media (CDN), np. https://media.biddy.pl. */
  MEDIA_PUBLIC_URL: url(['https:', 'http:'], 'https://media.biddy.pl').optional(),
  // Anti-sniping (§6.5, F-15): oferta w ostatnich N sekundach, która zmienia cenę albo lidera,
  // przesuwa koniec aukcji na teraz + N sekund.
  AUCTION_ANTI_SNIPING_SECONDS: integer(0, 3600).optional(),
  // Wyszukiwarka Meilisearch (F-19). Lokalnie klucz główny z infra/docker-compose.yml.
  MEILI_URL: url(['https:', 'http:'], 'https://ms-xxxx.meilisearch.io').optional(),
  MEILI_API_KEY: text().min(16, 'oczekiwano co najmniej 16 znaków').optional(),
  /** Klucz główny lokalnego Meilisearch (docker-compose); zapasowy MEILI_API_KEY poza produkcją. */
  MEILI_MASTER_KEY: text().min(16, 'oczekiwano co najmniej 16 znaków').optional(),
  SEARCH_INDEX_PREFIX: text()
    .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'oczekiwano małych liter, cyfr i myślników, np. biddy')
    .optional(),
  // Rewalidacja stron aukcji w web (ISR, F-18): sekret wspólny z web (Vercel).
  WEB_REVALIDATE_SECRET: text()
    .min(32, 'oczekiwano co najmniej 32 znaków (np. openssl rand -base64 32)')
    .optional(),
});

/** Nazwy wszystkich zmiennych obsługiwanych przez schemat. */
export const ENV_KEYS = Object.keys(envSchema.shape) as (keyof z.input<typeof envSchema>)[];

export type AppEnvironment = 'development' | 'test' | 'production';

export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Proces, dla którego wczytujemy konfigurację (PROJECT.md §10.4): API (HTTP) albo worker
 * (BullMQ, relay outboxa). Worker nie obsługuje HTTP, więc nie wymaga np. CORS_ORIGINS.
 */
export type ProcessRole = 'api' | 'worker';

/** Domyślny adres Redisa kolejek poza produkcją (infra/docker-compose.yml). */
export const DEFAULT_REDIS_QUEUE_URL = 'redis://localhost:6379';
export const DEFAULT_REDIS_CACHE_URL = 'redis://localhost:6380';

/** Domyślny prefiks kluczy BullMQ w Redisie. */
export const DEFAULT_QUEUE_PREFIX = 'biddy';

/** Domyślne okno anti-snipingu: 2 minuty (§6.5). */
export const DEFAULT_ANTI_SNIPING_SECONDS = 120;

/** Klucz główny lokalnego Meilisearch z infra/docker-compose.yml. */
export const DEFAULT_MEILI_MASTER_KEY = 'biddy-local-meili-master-key';

/**
 * Klucze testowe Cloudflare Turnstile (zawsze przechodzą): domyślne lokalnie i w testach.
 * https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 */
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';
export const TURNSTILE_TEST_SECRET_KEY = '1x0000000000000000000000000000000AA';

/** Sekret sesji poza produkcją (lokalnie i w testach); na produkcji BETTER_AUTH_SECRET jest wymagany. */
export const DEVELOPMENT_AUTH_SECRET = 'biddy-development-only-auth-secret-0123456789';

/** Nadawca e-maili lokalnie (jak MAIL_FROM w .env.example). */
export const DEFAULT_MAIL_FROM = 'Biddy <no-reply@biddy.local>';

/** Transport e-maili: Resend (produkcja) albo SMTP (lokalnie Mailpit). */
/** Magazyn plików S3 (F-12). */
export interface StorageConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle: boolean;
  /** Publiczny kubełek przetworzonych zdjęć (za CDN). */
  readonly mediaBucket: string;
  /** Prywatny kubełek oryginałów i zdjęć zatrzymanych przez moderację. */
  readonly uploadsBucket: string;
  /** Adres, pod którym klienci czytają obiekty kubełka media (bez ukośnika na końcu). */
  readonly mediaPublicUrl: string;
}

/** Wysyłka SMS-ów: SMSAPI albo atrapa (lokalnie i w testach; kod trafia do logu). */
export type SmsTransportConfig =
  | { readonly kind: 'smsapi'; readonly token: string; readonly sender: string | undefined }
  | { readonly kind: 'log' };

export type MailTransportConfig =
  | { readonly kind: 'resend'; readonly apiKey: string }
  | {
      readonly kind: 'smtp';
      readonly host: string;
      readonly port: number;
      readonly user: string | undefined;
      readonly password: string | undefined;
    };

/** Dostawca logowania OAuth z kluczami. */
export interface OAuthProviderConfig {
  readonly clientId: string;
  readonly clientSecret: string;
}

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
  readonly queues: {
    /** Redis kolejek BullMQ (noeviction); sprawdza go worker przy starcie. */
    readonly redisUrl: string;
    /** Prefiks kluczy BullMQ: osobne przestrzenie kolejek na jednej instancji (np. testy). */
    readonly prefix: string;
    /** Co ile relay outboxa sprawdza nowe eventy, gdy ostatnia porcja była niepełna. */
    readonly outboxPollIntervalMs: number;
  };
  readonly cache: {
    /** Redis cache i pub/sub (Socket.IO, F-17); instancja z allkeys-lru, nie kolejek. */
    readonly redisUrl: string;
  };
  readonly log: {
    readonly level: LogLevel;
    readonly pretty: boolean;
  };
  readonly openapi: {
    readonly enabled: boolean;
  };
  readonly auth: {
    /** Sekret podpisu ciasteczek i tokenów Better Auth. */
    readonly secret: string;
    /** Publiczny adres API (bez /v1): z niego Better Auth buduje linki i callbacki OAuth. */
    readonly apiUrl: string;
    /** Adres aplikacji web: przekierowania po weryfikacji e-maila, resecie hasła i OAuth. */
    readonly webUrl: string;
    /** Domena ciasteczka sesji wspólna dla web i API (np. biddy.pl); undefined = host API. */
    readonly cookieDomain: string | undefined;
    /** Ciasteczka tylko przez HTTPS (poza lokalnym HTTP). */
    readonly secureCookies: boolean;
    readonly google: OAuthProviderConfig | undefined;
    readonly apple:
      (OAuthProviderConfig & { readonly appBundleId: string | undefined }) | undefined;
    readonly turnstile: { readonly siteKey: string; readonly secretKey: string };
  };
  readonly mail: {
    readonly from: string;
    readonly transport: MailTransportConfig;
  };
  readonly sms: SmsTransportConfig;
  readonly storage: StorageConfig;
  readonly auctions: {
    /** Okno anti-snipingu (§6.5): długość przedłużenia i próg „końcówki” aukcji. */
    readonly antiSnipingWindowMs: number;
  };
  readonly search: {
    /** Adres Meilisearch (bez końcowego ukośnika). */
    readonly url: string;
    readonly apiKey: string;
    /** Prefiks nazw indeksów, np. `biddy` → indeks `biddy-auctions`. */
    readonly indexPrefix: string;
  };
  readonly web: {
    /** Adres aplikacji web (bez końcowego ukośnika). */
    readonly url: string;
    /** Sekret `POST /api/revalidate` w web; undefined = bez rewalidacji (strony co 60 s). */
    readonly revalidateSecret: string | undefined;
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

/**
 * loadConfig dla punktu wejścia procesu (main.ts, worker.ts): przy błędnej konfiguracji wypisuje
 * listę błędów na stderr i kończy proces kodem 1, zanim cokolwiek się połączy.
 */
export function loadConfigOrExit(env: RawEnv, role: ProcessRole): AppConfig {
  try {
    return loadConfig(env, role);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${formatConfigError(error)}\n`);
      process.exit(1);
    }
    throw error;
  }
}

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
function crossFieldIssues(
  input: Readonly<Record<string, string>>,
  role: ProcessRole,
): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (input['NODE_ENV'] !== 'production') {
    return issues;
  }
  // Na produkcji domyślne adresy localhost byłyby błędem konfiguracji, a nie wygodą.
  if (role === 'api' && input['CORS_ORIGINS'] === undefined) {
    issues.push({
      variable: 'CORS_ORIGINS',
      message: `${MISSING}; na produkcji podaj originy frontendu, np. https://biddy.pl`,
    });
  }
  if (input['REDIS_QUEUE_URL'] === undefined) {
    issues.push({
      variable: 'REDIS_QUEUE_URL',
      message: `${MISSING}; na produkcji podaj adres Redisa kolejek (instancja z maxmemory-policy noeviction)`,
    });
  }
  const required: [string, string][] = [
    [
      'REDIS_CACHE_URL',
      'adres Redisa cache i pub/sub (instancja allkeys-lru, osobna od kolejek); zdarzenia na żywo',
    ],
    ['RESEND_API_KEY', 'na produkcji e-maile (weryfikacja, reset hasła) wysyła Resend'],
    ['S3_ENDPOINT', 'adres S3 Cloudflare R2, np. https://<konto>.r2.cloudflarestorage.com'],
    ['S3_ACCESS_KEY_ID', 'klucz dostępu R2 (token API z uprawnieniem do kubełków)'],
    ['S3_SECRET_ACCESS_KEY', 'sekret klucza R2'],
    ['MEDIA_PUBLIC_URL', 'publiczny adres kubełka media (CDN), np. https://media.biddy.pl'],
    ['MEILI_URL', 'adres Meilisearch (wyszukiwarka), np. https://ms-xxxx.meilisearch.io'],
    ['MEILI_API_KEY', 'klucz API Meilisearch z uprawnieniami do indeksu aukcji'],
  ];
  if (role === 'api') {
    required.push(
      ['BETTER_AUTH_SECRET', 'sekret sesji, np. openssl rand -base64 32'],
      ['API_PUBLIC_URL', 'publiczny adres API, np. https://api.biddy.pl'],
      ['WEB_URL', 'adres aplikacji web, np. https://biddy.pl'],
      ['TURNSTILE_SITE_KEY', 'klucz witryny Cloudflare Turnstile'],
      ['TURNSTILE_SECRET_KEY', 'klucz tajny Cloudflare Turnstile'],
      ['SMSAPI_TOKEN', 'token API SMSAPI (kody weryfikacji telefonu)'],
    );
  } else {
    required.push(
      ['WEB_URL', 'adres aplikacji web, np. https://biddy.pl (rewalidacja stron aukcji)'],
      ['BETTER_AUTH_SECRET', 'ten sam sekret co w API: podpis linków wypisania z e-maili (F-20)'],
      [
        'WEB_REVALIDATE_SECRET',
        'sekret rewalidacji stron aukcji, ten sam co w web (np. openssl rand -base64 32)',
      ],
    );
  }
  for (const [variable, hint] of required) {
    if (input[variable] === undefined) {
      issues.push({ variable, message: `${MISSING}; ${hint}` });
    }
  }
  return issues;
}

/** Klucze dostawcy OAuth podaje się parami: sam identyfikator albo sam sekret to błąd. */
function oauthPairIssues(input: Readonly<Record<string, string>>): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  for (const [id, secret] of [
    ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    ['APPLE_CLIENT_ID', 'APPLE_CLIENT_SECRET'],
  ] as const) {
    if ((input[id] === undefined) !== (input[secret] === undefined)) {
      const missing = input[id] === undefined ? id : secret;
      issues.push({
        variable: missing,
        message: `${MISSING}; podaj ${id} i ${secret} razem albo żadnej (logowanie wyłączone)`,
      });
    }
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
 *
 * @param role proces, który startuje: worker nie wymaga zmiennych samego HTTP (CORS_ORIGINS)
 */
export function loadConfig(env: RawEnv, role: ProcessRole = 'api'): AppConfig {
  const input = pickNonEmpty(env, ENV_KEYS);
  const result = envSchema.safeParse(input);
  const issues = [
    ...(result.success ? [] : issuesOf(result.error)),
    ...crossFieldIssues(input, role),
    ...oauthPairIssues(input),
  ];
  if (!result.success || issues.length > 0) {
    throw new ConfigError(issues.sort(byVariableOrder));
  }
  const vars = result.data;
  const production = vars.NODE_ENV === 'production';
  const development = vars.NODE_ENV === 'development';
  const host = vars.API_HOST ?? (production ? '0.0.0.0' : '127.0.0.1');

  return {
    env: vars.NODE_ENV,
    release: vars.APP_RELEASE ?? vars.RENDER_GIT_COMMIT,
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
    queues: {
      redisUrl: vars.REDIS_QUEUE_URL ?? DEFAULT_REDIS_QUEUE_URL,
      prefix: vars.QUEUE_PREFIX ?? DEFAULT_QUEUE_PREFIX,
      outboxPollIntervalMs: vars.OUTBOX_POLL_INTERVAL_MS ?? 250,
    },
    cache: {
      redisUrl: vars.REDIS_CACHE_URL ?? DEFAULT_REDIS_CACHE_URL,
    },
    log: {
      level: vars.LOG_LEVEL ?? (development ? 'debug' : 'info'),
      pretty: vars.LOG_PRETTY ?? development,
    },
    openapi: {
      enabled: vars.OPENAPI_ENABLED ?? !production,
    },
    auth: {
      secret: vars.BETTER_AUTH_SECRET ?? DEVELOPMENT_AUTH_SECRET,
      apiUrl: (
        vars.API_PUBLIC_URL ?? `http://localhost:${vars.PORT ?? vars.API_PORT ?? 3001}`
      ).replace(/\/+$/, ''),
      webUrl: (vars.WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
      cookieDomain: vars.AUTH_COOKIE_DOMAIN,
      secureCookies: production || (vars.API_PUBLIC_URL?.startsWith('https:') ?? false),
      google:
        vars.GOOGLE_CLIENT_ID === undefined || vars.GOOGLE_CLIENT_SECRET === undefined
          ? undefined
          : { clientId: vars.GOOGLE_CLIENT_ID, clientSecret: vars.GOOGLE_CLIENT_SECRET },
      apple:
        vars.APPLE_CLIENT_ID === undefined || vars.APPLE_CLIENT_SECRET === undefined
          ? undefined
          : {
              clientId: vars.APPLE_CLIENT_ID,
              clientSecret: vars.APPLE_CLIENT_SECRET,
              appBundleId: vars.APPLE_APP_BUNDLE_ID,
            },
      turnstile: {
        siteKey: vars.TURNSTILE_SITE_KEY ?? TURNSTILE_TEST_SITE_KEY,
        secretKey: vars.TURNSTILE_SECRET_KEY ?? TURNSTILE_TEST_SECRET_KEY,
      },
    },
    mail: {
      from: vars.MAIL_FROM ?? DEFAULT_MAIL_FROM,
      transport:
        vars.RESEND_API_KEY === undefined
          ? {
              kind: 'smtp',
              host: vars.SMTP_HOST ?? 'localhost',
              port: vars.SMTP_PORT ?? 1025,
              user: vars.SMTP_USER,
              password: vars.SMTP_PASSWORD,
            }
          : { kind: 'resend', apiKey: vars.RESEND_API_KEY },
    },
    storage: storageConfig(vars),
    auctions: {
      antiSnipingWindowMs:
        (vars.AUCTION_ANTI_SNIPING_SECONDS ?? DEFAULT_ANTI_SNIPING_SECONDS) * 1000,
    },
    search: {
      url: (vars.MEILI_URL ?? 'http://localhost:7700').replace(/\/+$/, ''),
      apiKey: vars.MEILI_API_KEY ?? vars.MEILI_MASTER_KEY ?? DEFAULT_MEILI_MASTER_KEY,
      indexPrefix: vars.SEARCH_INDEX_PREFIX ?? 'biddy',
    },
    web: {
      url: (vars.WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
      revalidateSecret: vars.WEB_REVALIDATE_SECRET,
    },
    sms:
      vars.SMSAPI_TOKEN === undefined
        ? { kind: 'log' }
        : { kind: 'smsapi', token: vars.SMSAPI_TOKEN, sender: vars.SMSAPI_SENDER },
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
  RENDER_GIT_COMMIT: true,
});

/**
 * Czyta tylko zmienne Sentry (oraz NODE_ENV, APP_RELEASE i RENDER_GIT_COMMIT). Zwraca undefined, gdy SENTRY_DSN
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
    release: vars.APP_RELEASE ?? vars.RENDER_GIT_COMMIT,
    tracesSampleRate: vars.SENTRY_TRACES_SAMPLE_RATE ?? 0,
  };
}

/** Wartości domyślne jak lokalny RustFS z infra/docker-compose.yml i .env.example. */
function storageConfig(vars: z.output<typeof envSchema>): StorageConfig {
  const endpoint = (vars.S3_ENDPOINT ?? 'http://localhost:9000').replace(/\/+$/, '');
  const forcePathStyle = vars.S3_FORCE_PATH_STYLE ?? true;
  const mediaBucket = vars.S3_BUCKET_MEDIA ?? 'biddy-media';
  return {
    endpoint,
    region: vars.S3_REGION ?? 'us-east-1',
    accessKeyId: vars.S3_ACCESS_KEY_ID ?? 'biddy-local',
    secretAccessKey: vars.S3_SECRET_ACCESS_KEY ?? 'biddy-local-secret',
    forcePathStyle,
    mediaBucket,
    uploadsBucket: vars.S3_BUCKET_UPLOADS ?? 'biddy-uploads',
    mediaPublicUrl: (vars.MEDIA_PUBLIC_URL ?? `${endpoint}/${mediaBucket}`).replace(/\/+$/, ''),
  };
}

/** Ustawienia lokalnego Bull Board (src/bull-board.ts): podgląd kolejek tylko w development. */
export interface BullBoardConfig {
  readonly redisUrl: string;
  readonly prefix: string;
  /** Bull Board nie ma logowania, więc słucha wyłącznie na interfejsie lokalnym. */
  readonly host: '127.0.0.1';
  readonly port: number;
}

const bullBoardEnvSchema = envSchema.pick({
  NODE_ENV: true,
  REDIS_QUEUE_URL: true,
  QUEUE_PREFIX: true,
  BULL_BOARD_PORT: true,
});

/**
 * Konfiguracja Bull Board. Nie wymaga DATABASE_URL (podgląd czyta tylko Redis). Odmawia na
 * produkcji: panel pozwala ponawiać i usuwać joby, a nie ma uwierzytelniania (kolejki na
 * produkcji obejrzymy w panelu administracyjnym, F-34).
 */
export function loadBullBoardConfig(env: RawEnv): BullBoardConfig {
  const input = pickNonEmpty(env, Object.keys(bullBoardEnvSchema.shape));
  const result = bullBoardEnvSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigError(issuesOf(result.error).sort(byVariableOrder));
  }
  const vars = result.data;
  if (vars.NODE_ENV === 'production') {
    throw new ConfigError([
      {
        variable: 'NODE_ENV',
        message:
          'Bull Board działa tylko poza produkcją (nie ma uwierzytelniania); na produkcji kolejki pokaże panel administracyjny',
      },
    ]);
  }
  return {
    redisUrl: vars.REDIS_QUEUE_URL ?? DEFAULT_REDIS_QUEUE_URL,
    prefix: vars.QUEUE_PREFIX ?? DEFAULT_QUEUE_PREFIX,
    host: '127.0.0.1',
    port: vars.BULL_BOARD_PORT ?? 3002,
  };
}

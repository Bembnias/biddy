// Zmienne środowiskowe lokalnej infrastruktury: schemat Zod, wczytanie .env i czytelne błędy.
// Szablon z opisem każdej zmiennej: .env.example w katalogu głównym.
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { z } from 'zod';

import { CliError } from './lib/cli.js';
import { PERCENT_ENCODING_HINT, isLocalHostname, portOf, safeDecode } from './lib/net.js';
import { ENV_FILE } from './lib/paths.js';

const MISSING = 'brak zmiennej (nie ustawiono jej albo jest pusta)';

function text() {
  return z.string({
    error: (issue) => (issue.input === undefined ? MISSING : 'oczekiwano tekstu'),
  });
}

function port() {
  return text()
    .regex(/^\d{1,5}$/, 'oczekiwano numeru portu (liczba całkowita 1–65535)')
    .transform(Number)
    .refine((value) => value >= 1 && value <= 65535, 'port musi być z zakresu 1–65535');
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

const MAIL_FROM_PATTERN = /^(?:[^<>]+<(?<named>[^<>\s]+)>|(?<bare>[^<>\s]+))$/;

function isMailFrom(value: string): boolean {
  const groups = MAIL_FROM_PATTERN.exec(value.trim())?.groups;
  const address = groups?.['named'] ?? groups?.['bare'];
  return address !== undefined && z.email().safeParse(address).success;
}

const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

function bucket() {
  return text().regex(
    BUCKET_NAME,
    'nazwa kubełka S3: 3–63 znaki, małe litery, cyfry, kropki i myślniki',
  );
}

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

/** Schemat zmiennych. Kolejność i grupy odpowiadają .env.example. */
export const infraEnvSchema = z.object({
  // Ogólne
  NODE_ENV: z
    .enum(['development', 'test', 'production'], {
      error: 'dozwolone wartości: development, test, production',
    })
    .default('development'),

  // PostgreSQL
  POSTGRES_USER: text().regex(/^[a-z_][a-z0-9_]*$/i, 'litery, cyfry i podkreślenia'),
  POSTGRES_PASSWORD: text(),
  POSTGRES_DB: text().regex(/^[a-z_][a-z0-9_]*$/i, 'litery, cyfry i podkreślenia'),
  POSTGRES_PORT: port(),
  DATABASE_URL: url(
    ['postgres:', 'postgresql:'],
    'postgres://biddy:biddy@localhost:5432/biddy (z nazwą bazy na końcu)',
    (parsed) => parsed.pathname.length > 1,
  ).refine((value) => {
    const parsed = URL.parse(value);
    // Zły adres zgłasza już reguła wyżej; tu tylko kodowanie użytkownika, hasła i nazwy bazy.
    return (
      parsed === null ||
      [parsed.username, parsed.password, parsed.pathname].every(
        (part) => safeDecode(part) !== undefined,
      )
    );
  }, PERCENT_ENCODING_HINT),

  // Redis
  REDIS_QUEUE_PORT: port(),
  REDIS_QUEUE_URL: url(['redis:', 'rediss:'], 'redis://localhost:6379'),
  REDIS_CACHE_PORT: port(),
  REDIS_CACHE_URL: url(['redis:', 'rediss:'], 'redis://localhost:6380'),

  // Meilisearch
  MEILI_PORT: port(),
  MEILI_URL: url(['http:', 'https:'], 'http://localhost:7700'),
  MEILI_MASTER_KEY: text().min(16, 'klucz główny Meilisearch musi mieć co najmniej 16 znaków'),

  // S3 (RustFS lokalnie, Cloudflare R2 na produkcji)
  RUSTFS_PORT: port(),
  RUSTFS_CONSOLE_PORT: port(),
  S3_ENDPOINT: url(['http:', 'https:'], 'http://localhost:9000'),
  S3_REGION: text(),
  S3_ACCESS_KEY_ID: text().min(3, 'klucz dostępu S3 musi mieć co najmniej 3 znaki'),
  S3_SECRET_ACCESS_KEY: text().min(8, 'sekret S3 musi mieć co najmniej 8 znaków'),
  S3_FORCE_PATH_STYLE: z.stringbool({ error: 'oczekiwano true lub false' }),
  S3_BUCKET_MEDIA: bucket(),
  S3_BUCKET_DOCUMENTS: bucket(),
  S3_CORS_ORIGINS: originList(),

  // Poczta (Mailpit lokalnie, Resend na produkcji)
  SMTP_HOST: text(),
  SMTP_PORT: port(),
  SMTP_USER: text().optional(),
  SMTP_PASSWORD: text().optional(),
  MAIL_FROM: text().refine(
    isMailFrom,
    'oczekiwano adresu e-mail, np. "Biddy <no-reply@biddy.local>" albo no-reply@biddy.local',
  ),
  MAILPIT_UI_PORT: port(),
  MAILPIT_UI_URL: url(['http:', 'https:'], 'http://localhost:8025'),
});

export type InfraEnv = z.output<typeof infraEnvSchema>;

/** Nazwy wszystkich zmiennych obsługiwanych przez schemat. */
export const INFRA_ENV_KEYS = Object.keys(infraEnvSchema.shape) as (keyof InfraEnv)[];

export interface EnvIssue {
  variable: string;
  message: string;
}

/** Porty, które docker-compose.yml wystawia na hoście. Muszą być różne. */
const PUBLISHED_PORTS = [
  'POSTGRES_PORT',
  'REDIS_QUEUE_PORT',
  'REDIS_CACHE_PORT',
  'MEILI_PORT',
  'RUSTFS_PORT',
  'RUSTFS_CONSOLE_PORT',
  'SMTP_PORT',
  'MAILPIT_UI_PORT',
] as const satisfies readonly (keyof InfraEnv)[];

type PortVariable = (typeof PUBLISHED_PORTS)[number];
type UrlVariable =
  | 'DATABASE_URL'
  | 'REDIS_QUEUE_URL'
  | 'REDIS_CACHE_URL'
  | 'MEILI_URL'
  | 'S3_ENDPOINT'
  | 'MAILPIT_UI_URL';

/**
 * Zgodność między zmiennymi. Adres URL wskazujący na lokalny kontener musi używać portu,
 * na którym docker-compose.yml go wystawia; inaczej aplikacja łączy się z czymś innym albo z niczym.
 */
export function checkConsistency(env: InfraEnv): EnvIssue[] {
  const issues: EnvIssue[] = [];

  const portOwners = new Map<number, string>();
  for (const variable of PUBLISHED_PORTS) {
    const owner = portOwners.get(env[variable]);
    if (owner === undefined) {
      portOwners.set(env[variable], variable);
    } else {
      issues.push({
        variable,
        message: `port ${env[variable]} jest już przypisany do ${owner}; każda usługa potrzebuje osobnego portu`,
      });
    }
  }

  const expectLocalPort = (variable: UrlVariable, portVariable: PortVariable): void => {
    const parsed = new URL(env[variable]);
    const actual = portOf(parsed);
    const expected = env[portVariable];
    if (isLocalHostname(parsed.hostname) && actual !== expected) {
      issues.push({
        variable,
        message: `port ${actual ?? '(brak)'} nie zgadza się z ${portVariable}=${expected}; kontener jest wystawiony na porcie ${expected}`,
      });
    }
  };
  expectLocalPort('DATABASE_URL', 'POSTGRES_PORT');
  expectLocalPort('REDIS_QUEUE_URL', 'REDIS_QUEUE_PORT');
  expectLocalPort('REDIS_CACHE_URL', 'REDIS_CACHE_PORT');
  expectLocalPort('MEILI_URL', 'MEILI_PORT');
  expectLocalPort('S3_ENDPOINT', 'RUSTFS_PORT');
  expectLocalPort('MAILPIT_UI_URL', 'MAILPIT_UI_PORT');

  const database = new URL(env.DATABASE_URL);
  if (isLocalHostname(database.hostname)) {
    if (safeDecode(database.username) !== env.POSTGRES_USER) {
      issues.push({
        variable: 'DATABASE_URL',
        message: `użytkownik nie zgadza się z POSTGRES_USER=${env.POSTGRES_USER}`,
      });
    }
    if (safeDecode(database.password) !== env.POSTGRES_PASSWORD) {
      issues.push({
        variable: 'DATABASE_URL',
        message: 'hasło nie zgadza się z POSTGRES_PASSWORD',
      });
    }
  }

  // PROJECT.md §11.2: kolejki (noeviction) i cache (allkeys-lru) to dwie osobne instancje.
  const queue = new URL(env.REDIS_QUEUE_URL);
  const cache = new URL(env.REDIS_CACHE_URL);
  const sameHost =
    queue.hostname === cache.hostname ||
    (isLocalHostname(queue.hostname) && isLocalHostname(cache.hostname));
  if (sameHost && portOf(queue) === portOf(cache)) {
    issues.push({
      variable: 'REDIS_CACHE_URL',
      message:
        'wskazuje na tę samą instancję co REDIS_QUEUE_URL; kolejki i cache muszą być osobnymi instancjami Redis (PROJECT.md §11.2)',
    });
  }

  if (env.S3_BUCKET_MEDIA === env.S3_BUCKET_DOCUMENTS) {
    issues.push({
      variable: 'S3_BUCKET_DOCUMENTS',
      message: 'musi się różnić od S3_BUCKET_MEDIA (dokumenty są prywatne, media nie)',
    });
  }

  return issues;
}

/**
 * Zmienne, które docker compose podstawia w infra/docker-compose.yml (${VAR}).
 * compose.test.ts pilnuje, żeby lista była zgodna z plikiem.
 */
export const COMPOSE_VARIABLES = [
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'POSTGRES_PORT',
  'REDIS_QUEUE_PORT',
  'REDIS_CACHE_PORT',
  'MEILI_PORT',
  'MEILI_MASTER_KEY',
  'RUSTFS_PORT',
  'RUSTFS_CONSOLE_PORT',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_REGION',
  'SMTP_PORT',
  'MAILPIT_UI_PORT',
] as const satisfies readonly (keyof InfraEnv)[];

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

/** Opis problemu z wartością z pliku .env albo undefined, gdy compose i Node czytają ją tak samo. */
function ambiguousValue(value: string): string | undefined {
  const quote = value[0];
  if (quote === "'") {
    return undefined;
  }
  if (quote === '`') {
    return 'wartość w odwrotnych apostrofach (`…`): Node je usuwa, docker compose zostawia';
  }
  if (quote === '"') {
    const end = value.indexOf('"', 1);
    const inner = end === -1 ? value.slice(1) : value.slice(1, end);
    return inner.includes('$')
      ? 'znak $ w podwójnych cudzysłowach: docker compose podstawia w tym miejscu zmienną, a skrypty nie'
      : undefined;
  }
  // Spacja przed # oznacza komentarz w obu parserach, więc taki komentarz jest w porządku.
  const withoutComment = value.replace(/\s+#.*$/, '');
  if (withoutComment.includes('$')) {
    return 'znak $ bez cudzysłowu: docker compose podstawia w tym miejscu zmienną, a skrypty nie';
  }
  if (withoutComment.includes('#')) {
    return 'znak # bez cudzysłowu: skrypty ucinają wartość na #, a docker compose nie';
  }
  return undefined;
}

/**
 * Szuka w treści .env wartości, które docker compose i Node (util.parseEnv) odczytują różnie.
 * Dotyczy tylko zmiennych z COMPOSE_VARIABLES: inaczej kontener dostałby inne hasło lub klucz
 * niż skrypty i aplikacja, a `pnpm env:check` by tego nie zauważył.
 */
export function checkEnvFileSyntax(
  text: string,
  variables: readonly string[] = COMPOSE_VARIABLES,
): EnvIssue[] {
  const issues: EnvIssue[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = ENV_LINE.exec(line);
    const variable = match?.[1];
    const value = match?.[2];
    if (variable === undefined || value === undefined || !variables.includes(variable)) {
      continue;
    }
    const problem = ambiguousValue(value.trim());
    if (problem !== undefined) {
      issues.push({
        variable,
        message: `${problem}. Ujmij wartość w pojedyncze cudzysłowy, np. ${variable}='…'`,
      });
    }
  }
  return issues;
}

/** Błąd konfiguracji: lista wszystkich złych lub brakujących zmiennych naraz. */
export class InfraEnvError extends CliError {
  readonly issues: readonly EnvIssue[];

  constructor(issues: readonly EnvIssue[], context: ParseContext = {}) {
    const fileMissing = context.envFileFound === false;
    // Bez pliku .env najważniejsza jest ta informacja, a nie lista kilkudziesięciu braków.
    const header = fileMissing
      ? `Nie znaleziono pliku ${context.envFile ?? '.env'}, a w środowisku procesu brakuje zmiennych:`
      : 'Nieprawidłowa konfiguracja środowiska (plik .env):';
    const list = issues.map((issue) => `  • ${issue.variable}: ${issue.message}`).join('\n');
    const hints = fileMissing
      ? ['Utwórz .env z szablonu: cp .env.example .env (albo uruchom: pnpm bootstrap).']
      : [
          'Popraw wartości w .env. Opis każdej zmiennej i działające wartości są w .env.example.',
          'Najprościej zacząć od szablonu: cp .env.example .env',
        ];
    super(`${header}\n${list}`, hints);
    this.name = 'InfraEnvError';
    this.issues = issues;
  }
}

export interface ParseContext {
  envFile?: string;
  envFileFound?: boolean;
}

/**
 * Waliduje surowe zmienne. Puste wartości traktujemy jak brak zmiennej, więc `SMTP_USER=`
 * oznacza „bez logowania”, a puste wymagane pole daje czytelny błąd zamiast dziwnego.
 * Rzuca InfraEnvError ze wszystkimi problemami naraz, a nie tylko pierwszym.
 */
export function parseInfraEnv(
  raw: Readonly<Record<string, string | undefined>>,
  context: ParseContext = {},
): InfraEnv {
  const input: Record<string, string> = {};
  for (const key of INFRA_ENV_KEYS) {
    const value = raw[key];
    if (value !== undefined && value.trim() !== '') {
      input[key] = value;
    }
  }

  const result = infraEnvSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      variable: issue.path.map(String).join('.') || '(całość)',
      message: issue.message,
    }));
    throw new InfraEnvError(issues, context);
  }

  const consistencyIssues = checkConsistency(result.data);
  if (consistencyIssues.length > 0) {
    throw new InfraEnvError(consistencyIssues, context);
  }
  return result.data;
}

export interface LoadInfraEnvOptions {
  /** Domyślnie .env w katalogu głównym repozytorium (niezależnie od katalogu roboczego). */
  envFile?: string;
  /** Domyślnie process.env. */
  processEnv?: Readonly<Record<string, string | undefined>>;
}

export interface RawEnv {
  /** Zmienne z pliku .env nadpisane niepustymi zmiennymi środowiska procesu. */
  values: Record<string, string>;
  envFile: string;
  envFileFound: boolean;
  /** Wartości z pliku, które docker compose odczyta inaczej niż skrypty (checkEnvFileSyntax). */
  fileIssues: EnvIssue[];
}

/**
 * Czyta .env bez modyfikowania process.env. Zmienne ustawione w powłoce mają pierwszeństwo,
 * tak jak w docker compose i w `node --env-file`.
 */
export function readRawEnv(options: LoadInfraEnvOptions = {}): RawEnv {
  const envFile = options.envFile ?? ENV_FILE;
  const envFileFound = existsSync(envFile);
  const fileText = envFileFound ? readFileSync(envFile, 'utf8') : '';
  const fromFile = parseEnv(fileText);
  const fromProcess = Object.entries(options.processEnv ?? process.env).filter(
    ([, value]) => value !== undefined && value !== '',
  );
  const values: Record<string, string> = {};
  for (const [key, value] of [...Object.entries(fromFile), ...fromProcess]) {
    if (value !== undefined) {
      values[key] = value;
    }
  }
  // Zmienna z powłoki przesłania wartość z pliku także w docker compose, więc wtedy plik nie szkodzi.
  const overridden = new Set(fromProcess.map(([key]) => key));
  const fileIssues = checkEnvFileSyntax(fileText).filter(
    (issue) => !overridden.has(issue.variable),
  );
  return { values, envFile, envFileFound, fileIssues };
}

/** Wczytuje .env z katalogu głównego i zwraca zwalidowaną, typowaną konfigurację. */
export function loadInfraEnv(options: LoadInfraEnvOptions = {}): InfraEnv {
  const { values, envFile, envFileFound, fileIssues } = readRawEnv(options);
  const context: ParseContext = { envFile, envFileFound };
  let env: InfraEnv | undefined;
  let parseIssues: readonly EnvIssue[] = [];
  try {
    env = parseInfraEnv(values, context);
  } catch (error) {
    if (!(error instanceof InfraEnvError)) {
      throw error;
    }
    parseIssues = error.issues;
  }
  // Problemy z zapisem w pliku najpierw: często tłumaczą błędy walidacji, które po nich następują.
  const issues = [...fileIssues, ...parseIssues];
  if (env === undefined || issues.length > 0) {
    throw new InfraEnvError(issues, context);
  }
  return env;
}

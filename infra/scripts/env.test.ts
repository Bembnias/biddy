import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';

import {
  COMPOSE_VARIABLES,
  type EnvIssue,
  INFRA_ENV_KEYS,
  InfraEnvError,
  checkEnvFileSyntax,
  loadInfraEnv,
  parseInfraEnv,
} from './env.js';
import { ENV_EXAMPLE_FILE, INFRA_DIR } from './lib/paths.js';

const exampleText = readFileSync(ENV_EXAMPLE_FILE, 'utf8');
const example = parseEnv(exampleText) as Record<string, string>;

/** Zwraca problemy walidacji (albo rzuca, gdy walidacja przeszła). */
function issuesFor(raw: Record<string, string | undefined>): EnvIssue[] {
  try {
    parseInfraEnv(raw);
  } catch (error) {
    if (error instanceof InfraEnvError) {
      return [...error.issues];
    }
    throw error;
  }
  throw new Error('Oczekiwano błędu walidacji, a konfiguracja przeszła.');
}

/** Sprawdza listę problemów: kolejne zmienne i fragment komunikatu dla każdej z nich. */
function expectIssues(issues: EnvIssue[], expected: [variable: string, fragment: string][]): void {
  expect(issues.map((issue) => issue.variable)).toEqual(expected.map(([variable]) => variable));
  for (const [index, [, fragment]] of expected.entries()) {
    expect(issues[index]?.message).toContain(fragment);
  }
}

function variablesWithIssues(raw: Record<string, string | undefined>): string[] {
  return issuesFor(raw).map((issue) => issue.variable);
}

describe('.env.example', () => {
  it('przechodzi walidację bez żadnych zmian', () => {
    const env = parseInfraEnv(example);

    expect(env.NODE_ENV).toBe('development');
    expect(env.POSTGRES_PORT).toBe(5432);
    expect(env.REDIS_CACHE_PORT).toBe(6380);
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
    expect(env.S3_CORS_ORIGINS).toEqual(['http://localhost:3000']);
    expect(env.MAIL_FROM).toBe('Biddy <no-reply@biddy.local>');
    expect(env.SMTP_USER).toBeUndefined();
    expect(env.MEILI_MASTER_KEY.length).toBeGreaterThanOrEqual(16);
  });

  it('opisuje każdą zmienną ze schematu (opcjonalne mogą być zakomentowane)', () => {
    for (const key of INFRA_ENV_KEYS) {
      expect(exampleText, key).toMatch(new RegExp(`^(# )?${key}=`, 'm'));
    }
  });

  it('nie zawiera zmiennych nieznanych schematowi', () => {
    const unknown = Object.keys(example).filter(
      (key) => !(INFRA_ENV_KEYS as string[]).includes(key),
    );
    expect(unknown).toEqual([]);
  });
});

describe('parseInfraEnv', () => {
  it('zgłasza wszystkie złe zmienne naraz, a nie tylko pierwszą', () => {
    const variables = variablesWithIssues({
      ...example,
      NODE_ENV: 'staging',
      POSTGRES_PORT: 'abc',
      DATABASE_URL: 'postgres://biddy:biddy@localhost:5432',
      REDIS_QUEUE_URL: 'http://localhost:6379',
      MEILI_MASTER_KEY: 'za-krotki',
      S3_FORCE_PATH_STYLE: 'chyba',
      S3_BUCKET_MEDIA: 'Media_Bucket',
      S3_CORS_ORIGINS: 'http://localhost:3000/',
      MAIL_FROM: 'to nie jest adres',
      MAILPIT_UI_PORT: '70000',
    });

    expect(variables.sort()).toEqual(
      [
        'NODE_ENV',
        'POSTGRES_PORT',
        'DATABASE_URL',
        'REDIS_QUEUE_URL',
        'MEILI_MASTER_KEY',
        'S3_FORCE_PATH_STYLE',
        'S3_BUCKET_MEDIA',
        'S3_CORS_ORIGINS',
        'MAIL_FROM',
        'MAILPIT_UI_PORT',
      ].sort(),
    );
  });

  it('traktuje pustą wartość jak brak zmiennej', () => {
    const issues = issuesFor({ ...example, POSTGRES_PASSWORD: '', S3_REGION: '   ' });

    expectIssues(issues, [
      ['POSTGRES_PASSWORD', 'brak zmiennej'],
      ['S3_REGION', 'brak zmiennej'],
    ]);
  });

  it('pusty opcjonalny login SMTP oznacza wysyłkę bez logowania', () => {
    const env = parseInfraEnv({ ...example, SMTP_USER: '', SMTP_PASSWORD: '' });
    expect(env.SMTP_USER).toBeUndefined();
  });

  it('przyjmuje kilka originów CORS i adres nadawcy bez nazwy', () => {
    const env = parseInfraEnv({
      ...example,
      S3_CORS_ORIGINS: 'http://localhost:3000, https://biddy.test',
      MAIL_FROM: 'no-reply@biddy.local',
    });
    expect(env.S3_CORS_ORIGINS).toEqual(['http://localhost:3000', 'https://biddy.test']);
    expect(env.MAIL_FROM).toBe('no-reply@biddy.local');
  });

  it('wykrywa port w DATABASE_URL niezgodny z POSTGRES_PORT', () => {
    const issues = issuesFor({ ...example, POSTGRES_PORT: '5433' });
    expectIssues(issues, [['DATABASE_URL', 'POSTGRES_PORT=5433']]);
  });

  it('przyjmuje zmieniony port, gdy URL i *_PORT są zgodne', () => {
    const env = parseInfraEnv({
      ...example,
      POSTGRES_PORT: '5433',
      DATABASE_URL: 'postgres://biddy:biddy@127.0.0.1:5433/biddy',
      MEILI_PORT: '7701',
      MEILI_URL: 'http://localhost:7701',
    });
    expect(env.POSTGRES_PORT).toBe(5433);
    expect(env.MEILI_PORT).toBe(7701);
  });

  it('nie sprawdza portów dla usług poza tą maszyną', () => {
    const env = parseInfraEnv({
      ...example,
      DATABASE_URL: 'postgres://app:secret@db.example.com:6543/biddy',
    });
    expect(env.DATABASE_URL).toContain('db.example.com');
  });

  it('wykrywa użytkownika lub hasło w DATABASE_URL niezgodne z kontenerem', () => {
    const issues = issuesFor({
      ...example,
      DATABASE_URL: 'postgres://inny:zle-haslo@localhost:5432/biddy',
    });
    expectIssues(issues, [
      ['DATABASE_URL', 'POSTGRES_USER'],
      ['DATABASE_URL', 'POSTGRES_PASSWORD'],
    ]);
  });

  it('zgłasza niepoprawne kodowanie % w DATABASE_URL zamiast rzucać URIError', () => {
    const issues = issuesFor({
      ...example,
      POSTGRES_PASSWORD: '100%pewne',
      DATABASE_URL: 'postgres://biddy:100%pewne@localhost:5432/biddy',
    });
    expectIssues(issues, [['DATABASE_URL', '%25']]);
  });

  it('przyjmuje hasło z zakodowanym % (%25) zgodne z POSTGRES_PASSWORD', () => {
    const env = parseInfraEnv({
      ...example,
      POSTGRES_PASSWORD: '100%pewne',
      DATABASE_URL: 'postgres://biddy:100%25pewne@localhost:5432/biddy',
    });
    expect(env.POSTGRES_PASSWORD).toBe('100%pewne');
  });

  it('wymaga osobnych instancji Redis dla kolejek i cache (PROJECT.md §11.2)', () => {
    const issues = issuesFor({
      ...example,
      // Host spoza tej maszyny, żeby nie zadziałała dodatkowo kontrola portów kontenerów.
      REDIS_QUEUE_URL: 'redis://redis.internal:6379/0',
      REDIS_CACHE_URL: 'redis://redis.internal:6379/1',
    });
    expectIssues(issues, [['REDIS_CACHE_URL', 'osobnymi instancjami']]);
  });

  it('wymaga różnych portów dla wszystkich usług i różnych kubełków', () => {
    const issues = issuesFor({
      ...example,
      MAILPIT_UI_PORT: '9001',
      MAILPIT_UI_URL: 'http://localhost:9001',
      S3_BUCKET_DOCUMENTS: example['S3_BUCKET_MEDIA'] ?? '',
    });
    expectIssues(issues, [
      ['MAILPIT_UI_PORT', 'RUSTFS_CONSOLE_PORT'],
      ['S3_BUCKET_DOCUMENTS', 'S3_BUCKET_MEDIA'],
    ]);
  });

  it('formatuje czytelny błąd po polsku z listą zmiennych i wskazówką', () => {
    let error: unknown;
    try {
      parseInfraEnv({ ...example, POSTGRES_PORT: 'abc', MEILI_MASTER_KEY: undefined });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InfraEnvError);
    const { message, hints } = error as InfraEnvError;
    expect(message).toContain('Nieprawidłowa konfiguracja środowiska');
    expect(message).toContain('• POSTGRES_PORT: oczekiwano numeru portu');
    expect(message).toContain('• MEILI_MASTER_KEY: brak zmiennej');
    expect(hints.join('\n')).toContain('cp .env.example .env');
  });
});

describe('checkEnvFileSyntax', () => {
  // docker compose podstawia $ i nie traktuje # bez spacji jako komentarza, Node odwrotnie.
  it.each([
    ['S3_SECRET_ACCESS_KEY=secret$word123', 'znak $ bez cudzysłowu'],
    ['S3_SECRET_ACCESS_KEY=secret$$word123', 'znak $ bez cudzysłowu'],
    ['POSTGRES_PASSWORD="abc$def"', 'znak $ w podwójnych cudzysłowach'],
    ['POSTGRES_PASSWORD=abc#def', 'znak # bez cudzysłowu'],
    ['export MEILI_MASTER_KEY=klucz#glowny-dlugi', 'znak # bez cudzysłowu'],
    ['MEILI_MASTER_KEY=`biddy-local-meili-master-key`', 'odwrotnych apostrofach'],
  ])('zgłasza wartość, którą compose i Node czytają różnie: %s', (line, fragment) => {
    const issues = checkEnvFileSyntax(line);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain(fragment);
    expect(issues[0]?.message).toContain('pojedyncze cudzysłowy');
  });

  it.each([
    "S3_SECRET_ACCESS_KEY='secret$word123'",
    "POSTGRES_PASSWORD='abc#def'",
    'POSTGRES_PASSWORD="abc#def"',
    'POSTGRES_PASSWORD=biddy # komentarz po spacji',
    '# POSTGRES_PASSWORD=abc$def',
    // DATABASE_URL nie trafia do docker compose, więc różnica parserów go nie dotyczy.
    'DATABASE_URL=postgres://biddy:a$b@localhost:5432/biddy',
  ])('przepuszcza wartość czytaną tak samo albo nieużywaną przez compose: %s', (line) => {
    expect(checkEnvFileSyntax(line)).toEqual([]);
  });

  it('przepuszcza .env.example', () => {
    expect(checkEnvFileSyntax(exampleText)).toEqual([]);
  });

  it('obejmuje tylko zmienne ze schematu', () => {
    for (const variable of COMPOSE_VARIABLES) {
      expect(INFRA_ENV_KEYS).toContain(variable);
    }
  });
});

describe('loadInfraEnv', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'biddy-env-test-'));
  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function envFileWith(name: string, overrides: Record<string, string>): string {
    const lines = exampleText
      .split('\n')
      .map((line) => {
        const key = /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1];
        return key !== undefined && key in overrides ? `${key}=${overrides[key]}` : line;
      })
      .join('\n');
    const file = join(tempDir, name);
    writeFileSync(file, lines);
    return file;
  }

  it('zgłasza wartość z $ w .env, choć sam schemat by ją przyjął (compose dostałby inny sekret)', () => {
    const envFile = envFileWith('dollar.env', { S3_SECRET_ACCESS_KEY: 'secret$word123' });
    let error: unknown;
    try {
      loadInfraEnv({ envFile, processEnv: {} });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(InfraEnvError);
    expectIssues([...(error as InfraEnvError).issues], [['S3_SECRET_ACCESS_KEY', 'znak $']]);
  });

  it('przy # w haśle zgłasza najpierw zapis w pliku, a potem skutki ucięcia wartości', () => {
    const envFile = envFileWith('hash.env', { POSTGRES_PASSWORD: 'abc#def' });
    let error: unknown;
    try {
      loadInfraEnv({ envFile, processEnv: {} });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(InfraEnvError);
    expectIssues(
      [...(error as InfraEnvError).issues],
      [
        ['POSTGRES_PASSWORD', 'znak #'],
        ['DATABASE_URL', 'hasło nie zgadza się'],
      ],
    );
  });

  it('przyjmuje tę samą wartość w pojedynczych cudzysłowach albo ustawioną w powłoce', () => {
    const quoted = envFileWith('quoted.env', { S3_SECRET_ACCESS_KEY: "'secret$word123'" });
    expect(loadInfraEnv({ envFile: quoted, processEnv: {} }).S3_SECRET_ACCESS_KEY).toBe(
      'secret$word123',
    );

    const unquoted = envFileWith('shell.env', { S3_SECRET_ACCESS_KEY: 'secret$word123' });
    const env = loadInfraEnv({
      envFile: unquoted,
      processEnv: { S3_SECRET_ACCESS_KEY: 'z-powloki-123' },
    });
    expect(env.S3_SECRET_ACCESS_KEY).toBe('z-powloki-123');
  });

  it('czyta wskazany plik i pozwala nadpisać zmienne ze środowiska procesu', () => {
    const env = loadInfraEnv({
      envFile: ENV_EXAMPLE_FILE,
      processEnv: {
        POSTGRES_PORT: '5544',
        DATABASE_URL: 'postgres://biddy:biddy@localhost:5544/biddy',
        // Pusta zmienna w powłoce nie przesłania wartości z pliku.
        S3_REGION: '',
      },
    });
    expect(env.POSTGRES_PORT).toBe(5544);
    expect(env.S3_REGION).toBe('us-east-1');
  });

  it('bez pliku .env podpowiada skopiowanie szablonu i wymienia brakujące zmienne', () => {
    let error: unknown;
    try {
      loadInfraEnv({ envFile: join(INFRA_DIR, 'nie-ma-takiego-pliku.env'), processEnv: {} });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InfraEnvError);
    const { issues, hints, message } = error as InfraEnvError;
    expect(message.split('\n')[0]).toContain('Nie znaleziono pliku');
    expect(hints.join('\n')).toContain('cp .env.example .env');
    expect(issues.map((issue) => issue.variable)).toEqual(
      expect.arrayContaining(['DATABASE_URL', 'MEILI_MASTER_KEY', 'S3_ENDPOINT', 'SMTP_HOST']),
    );
  });
});

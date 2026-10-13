// Spójność infra/docker-compose.yml z .env.example (bez uruchamiania Dockera).
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';

import { COMPOSE_VARIABLES } from './env.js';
import { COMPOSE_FILE, ENV_EXAMPLE_FILE } from './lib/paths.js';

const compose = readFileSync(COMPOSE_FILE, 'utf8');
const example = parseEnv(readFileSync(ENV_EXAMPLE_FILE, 'utf8'));

interface Interpolation {
  variable: string;
  defaultValue: string | undefined;
}

/** Wszystkie ${VAR} i ${VAR:-domyślna} z pominięciem komentarzy i ucieczek $${VAR}. */
function interpolations(text: string): Interpolation[] {
  const withoutComments = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
  const pattern = /(?<!\$)\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?-([^}]*))?\}/g;
  return [...withoutComments.matchAll(pattern)].map((match) => ({
    variable: match[1] ?? '',
    defaultValue: match[2],
  }));
}

/**
 * Każdy wpis list `ports:` (także składnia długa `- target:`/`published:` i lista w nawiasach),
 * a nie tylko te w pojedynczych cudzysłowach. Lista kończy się na pierwszym kluczu o wcięciu
 * nie większym niż `ports:` (YAML pozwala na `- ` na tym samym wcięciu co klucz).
 */
function portEntries(text: string): string[] {
  const lines = text.split('\n');
  const entries: string[] = [];
  for (const [index, line] of lines.entries()) {
    const match = /^(\s*)ports:(.*)$/.exec(line);
    if (match === null) {
      continue;
    }
    const indent = match[1]?.length ?? 0;
    const inline = match[2]?.trim() ?? '';
    if (inline !== '' && !inline.startsWith('#')) {
      entries.push(`ports: ${inline}`);
      continue;
    }
    for (const next of lines.slice(index + 1)) {
      const content = next.trim();
      if (content === '' || content.startsWith('#')) {
        continue;
      }
      const nextIndent = next.length - next.trimStart().length;
      if (nextIndent < indent || (nextIndent === indent && !content.startsWith('- '))) {
        break;
      }
      entries.push(content);
    }
  }
  return entries;
}

/** Jedyny dozwolony zapis: port hosta ze zmiennej, wystawiony tylko na 127.0.0.1. */
const LOCAL_PORT_MAPPING = /^- '127\.0\.0\.1:\$\{[A-Z_]+_PORT:-\d+\}:\d+'$/;

describe('portEntries', () => {
  it('widzi mapowania bez cudzysłowu, w składni długiej i w nawiasach', () => {
    const exposed = [
      'services:',
      '  mailpit:',
      '    ports:',
      "      - '127.0.0.1:${MAILPIT_UI_PORT:-8025}:8025'",
      '      - 8027:8025',
      '      # komentarz',
      '      - target: 8025',
      '        published: 8028',
      '    volumes:',
      '      - mailpit-data:/data',
      '  other:',
      '    ports:',
      '    - "8029:8025"',
      '  third:',
      "    ports: ['8030:8025']",
    ].join('\n');

    const entries = portEntries(exposed);
    expect(entries).toEqual([
      "- '127.0.0.1:${MAILPIT_UI_PORT:-8025}:8025'",
      '- 8027:8025',
      '- target: 8025',
      'published: 8028',
      '- "8029:8025"',
      "ports: ['8030:8025']",
    ]);
    expect(entries.filter((entry) => !LOCAL_PORT_MAPPING.test(entry))).toHaveLength(5);
  });
});

describe('docker-compose.yml', () => {
  const used = interpolations(compose);

  it('korzysta ze zmiennych środowiskowych', () => {
    expect(used.length).toBeGreaterThan(10);
  });

  it('każda zmienna ${VAR} jest zdefiniowana w .env.example', () => {
    const missing = used
      .map(({ variable }) => variable)
      .filter((variable) => !(variable in example));
    expect(missing).toEqual([]);
  });

  it('wartości domyślne ${VAR:-…} są takie same jak w .env.example', () => {
    const mismatched = used
      .filter(({ variable, defaultValue }) => {
        return defaultValue !== undefined && example[variable] !== defaultValue;
      })
      .map(({ variable, defaultValue }) => `${variable}: ${defaultValue} ≠ ${example[variable]}`);
    expect(mismatched).toEqual([]);
  });

  it('lista COMPOSE_VARIABLES (sprawdzanie zapisu w .env) obejmuje wszystkie zmienne pliku', () => {
    const variables = new Set(used.map(({ variable }) => variable));
    expect([...COMPOSE_VARIABLES].sort()).toEqual([...variables].sort());
  });

  it('wystawia porty tylko na 127.0.0.1', () => {
    const entries = portEntries(compose);
    expect(entries).toHaveLength(8);
    expect(entries.filter((entry) => !LOCAL_PORT_MAPPING.test(entry))).toEqual([]);
    expect(compose).not.toMatch(/^\s*published:/m);
  });

  it('Mailpit odpowiada tylko na lokalny nagłówek Host (ochrona przed DNS rebinding)', () => {
    expect(compose).toMatch(/mailpit:[\s\S]*?MP_ALLOWED_HOSTS: 'localhost,127\.0\.0\.1'/);
  });

  it('ma dwie instancje Redis z politykami z PROJECT.md §11.2', () => {
    expect(compose).toMatch(
      /redis-queue:[\s\S]*?--appendonly', 'yes', '--maxmemory-policy', 'noeviction'/,
    );
    expect(compose).toMatch(/redis-cache:[\s\S]*?'--maxmemory-policy',\s*'allkeys-lru'/);
    // VOLUME /data z obrazu w tmpfs, żeby nie powstawały osierocone anonimowe wolumeny.
    expect(compose).toMatch(/redis-cache:[\s\S]*?tmpfs:\s*- \/data\s/);
  });
});

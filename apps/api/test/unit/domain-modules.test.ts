import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { DOMAIN_MODULES } from '../../src/modules/index.js';

/** Moduły backendu z PROJECT.md §10.3, w kolejności z tabeli. */
const EXPECTED_MODULES = [
  'identity',
  'catalog',
  'media',
  'auctions',
  'orders',
  'payments',
  'ledger',
  'shipping',
  'disputes',
  'messaging',
  'reviews',
  'notifications',
  'search',
  'trust-safety',
  'compliance',
  'admin',
] as const;

const MODULES_DIR = new URL('../../src/modules/', import.meta.url);

/** `TrustSafetyModule` → `trust-safety`. */
function moduleName(moduleClass: { name: string }): string {
  return moduleClass.name
    .replace(/Module$/, '')
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

describe('DOMAIN_MODULES', () => {
  it('zawiera 16 modułów z PROJECT.md §10.3 w tej samej kolejności', () => {
    expect(DOMAIN_MODULES).toHaveLength(16);
    expect(DOMAIN_MODULES.map(moduleName)).toEqual(EXPECTED_MODULES);
  });

  it('każdy moduł ma katalog z <nazwa>.module.ts i publicznym API index.ts', () => {
    const directories = readdirSync(MODULES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(directories.toSorted()).toEqual(EXPECTED_MODULES.toSorted());
    for (const name of EXPECTED_MODULES) {
      expect(existsSync(new URL(`${name}/${name}.module.ts`, MODULES_DIR)), name).toBe(true);
      expect(existsSync(new URL(`${name}/index.ts`, MODULES_DIR)), name).toBe(true);
    }
  });

  it('index.ts modułu eksportuje klasę modułu z rejestru', async () => {
    for (const [index, name] of EXPECTED_MODULES.entries()) {
      const publicApi = (await import(
        fileURLToPath(new URL(`${name}/index.ts`, MODULES_DIR))
      )) as Record<string, unknown>;

      expect(Object.values(publicApi), name).toContain(DOMAIN_MODULES[index]);
    }
  });

  it('wszystkie moduły kompilują się w module testowym NestJS', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [...DOMAIN_MODULES] }).compile();
    try {
      for (const moduleClass of DOMAIN_MODULES) {
        expect(moduleRef.get(moduleClass, { strict: false })).toBeInstanceOf(moduleClass);
      }
    } finally {
      await moduleRef.close();
    }
  });
});

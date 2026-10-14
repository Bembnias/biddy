// Kryteria F-11 na prawdziwym Postgresie (Testcontainers): seed drzewa kategorii z migracji
// (ltree, spójne ścieżki, poprawne definicje), API kategorii, dziedziczenie atrybutów i flag,
// walidacja atrybutów przedmiotu i odporność wyświetlania na zmianę schematu kategorii.
import { attributeDefinitionsSchema } from '@biddy/shared';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DomainError } from '../../src/infra/http/index.js';
import { CategoryService } from '../../src/modules/catalog/index.js';
import { integrationConfig, problemOf, startTestApp, type TestApp } from './support/app.js';
import type { ScratchDatabase } from './support/database.js';
import { createMigratedDatabase, redisUrl, uniqueQueuePrefix } from './support/worker.js';

let database: ScratchDatabase;
let pool: Pool;
let api: TestApp;
let service: CategoryService;

interface CategoryRow {
  id: string;
  parent_id: string | null;
  path: string;
  slug: string;
  attributes: unknown;
  is_restricted: boolean;
}

interface CategoryBody {
  id: string;
  slug: string;
  path: string[];
  depth: number;
  isLeaf: boolean;
  isRestricted: boolean;
  isBrandSensitive: boolean;
}

beforeAll(async () => {
  database = await createMigratedDatabase();
  pool = new Pool({ connectionString: database.url, max: 2 });
  api = await startTestApp(
    integrationConfig({
      DATABASE_URL: database.url,
      REDIS_QUEUE_URL: redisUrl(),
      QUEUE_PREFIX: uniqueQueuePrefix(),
    }),
  );
  service = api.app.get(CategoryService);
});

afterAll(async () => {
  await api.close();
  await pool.end();
  await database.drop();
});

async function idOf(slug: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>('select id from categories where slug = $1', [
    slug,
  ]);
  return rows[0]?.id ?? '';
}

async function rejection(promise: Promise<unknown>): Promise<DomainError> {
  const error: unknown = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DomainError);
  return error as DomainError;
}

describe('seed z migracji', () => {
  it('spójne drzewo: ścieżki ltree z rodziców, unikalne slugi, poprawne definicje atrybutów', async () => {
    const { rows } = await pool.query<CategoryRow>(
      'select id, parent_id, path::text as path, slug, attributes, is_restricted from categories',
    );
    expect(rows.length).toBeGreaterThanOrEqual(40);
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const row of rows) {
      const parent = row.parent_id === null ? undefined : byId.get(row.parent_id);
      expect(row.path, row.slug).toBe(
        parent === undefined ? row.slug : `${parent.path}.${row.slug}`,
      );
      expect(attributeDefinitionsSchema.safeParse(row.attributes).success, row.slug).toBe(true);
    }
    expect(new Set(rows.map((row) => row.slug)).size).toBe(rows.length);
    expect(
      rows
        .filter((row) => row.parent_id === null)
        .map((row) => row.slug)
        .sort(),
    ).toEqual(
      [
        'agd',
        'dom-i-ogrod',
        'elektronika',
        'inne',
        'kolekcjonerstwo',
        'ksiazki-muzyka-filmy',
        'moda',
        'rtv',
        'sport-i-hobby',
      ].sort(),
    );
  });

  it('ltree: poddrzewo kategorii zapytaniem <@', async () => {
    const { rows } = await pool.query<{ slug: string }>(
      `select slug from categories where path <@ 'kolekcjonerstwo' and slug <> 'kolekcjonerstwo' order by position`,
    );
    expect(rows.map((row) => row.slug)).toContain('karty-kolekcjonerskie');
    expect(rows.every((row) => row.slug !== 'sneakersy')).toBe(true);
  });
});

describe('API kategorii', () => {
  it('GET /v1/categories: kolejność drzewa, liście i flagi dziedziczone, cache publiczny', async () => {
    const response = await api.http.inject({ method: 'GET', url: '/v1/categories' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=300');
    const list = response.json<CategoryBody[]>();
    const kolekcjonerstwo = list.findIndex((category) => category.slug === 'kolekcjonerstwo');
    expect(list[kolekcjonerstwo]).toMatchObject({ depth: 0, isLeaf: false });
    expect(list[kolekcjonerstwo + 1]).toMatchObject({
      slug: 'karty-kolekcjonerskie',
      path: ['kolekcjonerstwo', 'karty-kolekcjonerskie'],
      depth: 1,
      isLeaf: true,
      isBrandSensitive: true,
    });
    expect(list.find((category) => category.slug === 'militaria')).toMatchObject({
      isRestricted: true,
    });
    expect(list.find((category) => category.slug === 'inne')).toMatchObject({ isLeaf: true });
  });

  it('GET /v1/categories/{id}/schema: atrybuty rodzica i własne, JSON Schema, zasady', async () => {
    const response = await api.http.inject({
      method: 'GET',
      url: `/v1/categories/${await idOf('sneakersy')}/schema`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      attributes: { key: string }[];
      jsonSchema: { properties: Record<string, unknown>; required: string[] };
      isBrandSensitive: boolean;
      listingNotice: string | null;
    }>();
    expect(body.attributes.map((attribute) => attribute.key)).toEqual(['kolor', 'rozmiarEu']);
    expect(body.isBrandSensitive).toBe(true);
    expect(body.listingNotice).toBeNull();
    expect(Object.keys(body.jsonSchema.properties)).toEqual(['kolor', 'rozmiarEu']);
    expect(body.jsonSchema.required).toEqual(['rozmiarEu']);

    const militaria = await api.http.inject({
      method: 'GET',
      url: `/v1/categories/${await idOf('militaria')}/schema`,
    });
    expect(militaria.json()).toMatchObject({
      isRestricted: true,
      listingNotice: expect.stringContaining('Bez broni') as string,
    });
  });

  it('nieznana kategoria i zły identyfikator: 404', async () => {
    for (const id of ['01960000-0000-7000-8000-000000000999', 'karty']) {
      const response = await api.http.inject({ method: 'GET', url: `/v1/categories/${id}/schema` });
      expect(response.statusCode, id).toBe(404);
      expect(problemOf(response).code).toBe('NOT_FOUND');
    }
  });
});

describe('walidacja atrybutów przedmiotu (dla F-14)', () => {
  it('poprawne wartości: normalizacja i domyślne wartości pól wyboru', async () => {
    expect(
      await service.validateItemAttributes(await idOf('retro-gaming'), {
        platforma: 'snes',
        region: 'pal',
      }),
    ).toEqual({ platforma: 'snes', region: 'pal', pudelko: false, instrukcja: false });
  });

  it('błąd pola po polsku na każdy zły atrybut', async () => {
    const error = await rejection(
      service.validateItemAttributes(await idOf('sneakersy'), {
        kolor: 'w-kropki',
        rozmiarEu: 60,
        marka: 'Nike',
      }),
    );
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.errors).toEqual([
      { path: 'attributes.marka', code: 'custom', message: 'Nieznany atrybut w tej kategorii.' },
      { path: 'attributes.kolor', code: 'custom', message: 'Wybierz jedną z opcji pola „Kolor”.' },
      {
        path: 'attributes.rozmiarEu',
        code: 'custom',
        message: 'Pole „Rozmiar” musi być liczbą od 15 do 52.',
      },
    ]);
  });

  it('przedmiot tylko w aktywnym liściu drzewa', async () => {
    const parent = await rejection(service.validateItemAttributes(await idOf('moda'), {}));
    expect(parent.errors?.[0]).toMatchObject({
      path: 'categoryId',
      message: expect.stringContaining('Wybierz podkategorię') as string,
    });
    const unknown = await rejection(
      service.validateItemAttributes('01960000-0000-7000-8000-000000000999', {}),
    );
    expect(unknown.errors?.[0]?.path).toBe('categoryId');
  });
});

describe('zmiana schematu kategorii', () => {
  it('istniejące wartości nadal się wyświetlają, nowe przedmioty podlegają nowym regułom', async () => {
    const sneakers = await idOf('sneakersy');
    const stored = { kolor: 'zolty', rozmiarEu: 42.5 };
    await pool.query(`update categories set attributes = $2::jsonb where id = $1`, [
      sneakers,
      JSON.stringify([
        { key: 'stan', label: 'Stan podeszwy', type: 'text', required: true },
        { key: 'pudelko', label: 'Oryginalne pudełko', type: 'boolean' },
      ]),
    ]);
    await pool.query(
      `update categories set attributes = jsonb_set(attributes, '{0,options}',
         (select jsonb_agg(option) from jsonb_array_elements(attributes->0->'options') option
          where option->>'value' <> 'zolty'))
       where slug = 'moda'`,
    );

    expect(await service.describeAttributes(sneakers, stored)).toEqual([
      { key: 'kolor', label: 'Kolor', value: 'zolty' },
    ]);
    const error = await rejection(service.validateItemAttributes(sneakers, stored));
    expect(error.errors?.map((item) => item.path)).toEqual([
      'attributes.rozmiarEu',
      'attributes.kolor',
      'attributes.stan',
    ]);
  });

  it('nieaktywna kategoria znika z listy razem z poddrzewem', async () => {
    await pool.query(`update categories set is_active = false where slug = 'rtv'`);
    const list = (await api.http.inject({ method: 'GET', url: '/v1/categories' })).json<
      CategoryBody[]
    >();
    expect(list.some((category) => category.path[0] === 'rtv')).toBe(false);
    const schema = await api.http.inject({
      method: 'GET',
      url: `/v1/categories/${await idOf('telewizory')}/schema`,
    });
    expect(schema.statusCode).toBe(404);
  });
});

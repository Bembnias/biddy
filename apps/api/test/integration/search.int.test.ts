// Kryteria F-19 (API) na prawdziwym Postgresie, Redisie i Meilisearch (Testcontainers) z workerem:
// publikacja → wyszukiwalna < 10 s, literówka, filtry i fasety kategorii, stanu, ceny i atrybutów,
// sortowania, nowa cena po ofercie, zakończona aukcja znika, nocny reindeks i sitemap.
import { inject } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId } from '../../src/infra/db/index.js';
import { MeiliClient } from '../../src/infra/search/index.js';
import { AuctionClosingService } from '../../src/modules/auctions/index.js';
import { AuctionIndexer } from '../../src/modules/search/index.js';
import { type TestUser, WEB_ORIGIN, createUser } from './support/accounts.js';
import { integrationConfig, problemOf, startTestApp, type TestApp } from './support/app.js';
import type { ScratchDatabase } from './support/database.js';
import { TEST_MEILI_KEY } from './support/meili.js';
import {
  type TestWorker,
  createMigratedDatabase,
  redisUrl,
  startTestWorker,
  uniqueQueuePrefix,
  uniqueSearchPrefix,
  waitFor,
  workerConfig,
} from './support/worker.js';

let database: ScratchDatabase;
let pool: Pool;
let api: TestApp;
let worker: TestWorker;
let seller: TestUser;
let meili: MeiliClient;
let index: string;
let ipCounter = 0;

beforeAll(async () => {
  database = await createMigratedDatabase();
  pool = new Pool({ connectionString: database.url, max: 8 });
  const prefix = uniqueSearchPrefix();
  index = `${prefix}-auctions`;
  const shared = {
    DATABASE_URL: database.url,
    REDIS_QUEUE_URL: redisUrl(),
    QUEUE_PREFIX: uniqueQueuePrefix(),
    TRUST_PROXY: 'loopback',
    SEARCH_INDEX_PREFIX: prefix,
  };
  api = await startTestApp(integrationConfig(shared));
  worker = await startTestWorker(workerConfig(database.url, shared));
  seller = await createUser(api, pool, { name: 'Sprzedawca Testowy' });
  meili = new MeiliClient(inject('meiliUrl'), TEST_MEILI_KEY);
}, 120_000);

afterAll(async () => {
  await worker.close();
  await api.close();
  await pool.end();
  await database.drop();
});

function call(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  user?: TestUser,
  body?: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  ipCounter += 1;
  return api.http.inject({
    method,
    url,
    headers: {
      'x-forwarded-for': `192.0.2.${String(ipCounter % 250)}`,
      origin: WEB_ORIGIN,
      ...(user === undefined ? {} : { cookie: user.cookie }),
      ...headers,
    },
    ...(body === undefined ? {} : { payload: body }),
  });
}

async function readyPhotos(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = newId();
    await pool.query(
      `insert into media (id, owner_id, purpose, status, content_type, size_bytes, width, height)
       values ($1, $2, 'ITEM_PHOTO', 'READY', 'image/jpeg', 1000, 1600, 1200)`,
      [id, seller.id],
    );
    ids.push(id);
  }
  return ids;
}

async function categoryId(slug: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>('select id from categories where slug = $1', [
    slug,
  ]);
  return rows[0]?.id ?? '';
}

interface Published {
  readonly id: string;
  readonly publicId: string;
}

/** Opublikowana aukcja przez API (szkic → pola → publikacja). */
async function publish(fields: Record<string, unknown>): Promise<Published> {
  const created = await call('POST', '/v1/auctions', seller);
  expect(created.statusCode, created.body).toBe(201);
  const { id, publicId } = created.json<Published>();
  const patched = await call('PATCH', `/v1/auctions/${id}`, seller, {
    mediaIds: await readyPhotos(4),
    condition: 'VERY_GOOD',
    packageSize: 'M',
    allowedCarriers: ['inpost-paczkomat'],
    startPrice: 2_000,
    durationDays: 7,
    ...fields,
  });
  expect(patched.statusCode, patched.body).toBe(200);
  const published = await call('POST', `/v1/auctions/${id}/publish`, seller, {
    kycNoticeAccepted: true,
  });
  expect(published.statusCode, published.body).toBe(200);
  expect(published.json<{ status: string }>().status).toBe('ACTIVE');
  return { id, publicId };
}

interface SearchResult {
  items: { id: string; title: string; price: number; bidCount: number; slug: string }[];
  total: number;
  sort: string;
  facets: {
    categories: { slug: string; count: number }[];
    conditions: { value: string; count: number }[];
    price: { min: number; max: number } | null;
    attributes: {
      key: string;
      type: string;
      options: { value: string; label: string; count: number }[];
      range: { min: number; max: number } | null;
    }[];
  };
}

async function search(query: string): Promise<SearchResult> {
  const response = await call('GET', `/v1/auctions?${query}`);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<SearchResult>();
}

const ids = (result: SearchResult) => result.items.map((item) => item.id).sort();

let sneakers: Published;
let boots: Published;
let console: Published;

describe('indeksowanie i wyszukiwanie', () => {
  it('opublikowana aukcja jest wyszukiwalna w mniej niż 10 s, także z literówką', async () => {
    const started = Date.now();
    sneakers = await publish({
      categoryId: await categoryId('sneakersy'),
      title: 'Nike Air Max 90 białe',
      description: 'Buty noszone kilka razy, bez uszkodzeń, oryginalne pudełko.',
      brand: 'Nike',
      attributes: { rozmiarEu: 42, kolor: 'bialy' },
      startPrice: 15_000,
    });
    await waitFor(
      async () => (await search('q=nikee')).items.some((item) => item.id === sneakers.id),
      'aukcja w wynikach „nikee”',
      10_000,
    );
    expect(Date.now() - started).toBeLessThan(10_000);
    const result = await search('q=nikee');
    expect(result.items[0]).toMatchObject({
      id: sneakers.id,
      title: 'Nike Air Max 90 białe',
      price: 15_000,
      bidCount: 0,
      slug: 'nike-air-max-90-biale',
    });
    expect(result.sort).toBe('relevance');
  });

  it('filtry i fasety kategorii, stanu, ceny i atrybutów; sortowania', async () => {
    boots = await publish({
      categoryId: await categoryId('sneakersy'),
      title: 'Adidas Samba czarne',
      description: 'Klasyczne buty, rozmiar 44, stan bardzo dobry.',
      brand: 'Adidas',
      attributes: { rozmiarEu: 44, kolor: 'czarny' },
      condition: 'NEW',
      startPrice: 9_000,
    });
    console = await publish({
      categoryId: await categoryId('retro-gaming'),
      title: 'Pegasus z dwoma padami',
      description: 'Konsola działa, komplet kabli i dwa pady.',
      attributes: { platforma: 'nes' },
      startPrice: 5_000,
    });
    const moda = await categoryId('moda');
    const sneakersCategory = await categoryId('sneakersy');
    await waitFor(async () => (await search('')).total === 3, 'trzy aukcje w indeksie', 10_000);

    const all = await search('');
    expect(all.sort).toBe('ending');
    expect(all.facets.categories.map((entry) => [entry.slug, entry.count])).toEqual(
      expect.arrayContaining([
        ['moda', 2],
        ['elektronika', 1],
      ]),
    );
    expect(all.facets.price).toEqual({ min: 5_000, max: 15_000 });
    expect(all.facets.attributes).toEqual([]);

    // Kategoria nadrzędna: podkategorie i atrybut „kolor” (bez rozmiaru z liścia).
    const fashion = await search(`category=${moda}`);
    expect(ids(fashion)).toEqual([sneakers.id, boots.id].sort());
    expect(fashion.facets.categories).toEqual([
      expect.objectContaining({ slug: 'sneakersy', count: 2 }),
    ]);
    expect(fashion.facets.attributes.map((facet) => facet.key)).toEqual(['kolor']);
    expect(fashion.facets.attributes[0]?.options).toEqual([
      { value: 'czarny', label: 'Czarny', count: 1 },
      { value: 'bialy', label: 'Biały', count: 1 },
    ]);

    // Liść: rozmiar z zakresem, filtr opcji i zakresu liczb.
    const leaf = await search(`category=${sneakersCategory}`);
    expect(leaf.facets.attributes.map((facet) => facet.key)).toEqual(['kolor', 'rozmiarEu']);
    expect(leaf.facets.attributes[1]?.range).toEqual({ min: 42, max: 44 });
    expect(ids(await search(`category=${sneakersCategory}&attr=kolor:czarny`))).toEqual([boots.id]);
    expect(
      ids(await search(`category=${sneakersCategory}&attr=kolor:czarny&attr=kolor:bialy`)),
    ).toEqual([sneakers.id, boots.id].sort());
    expect(ids(await search(`category=${sneakersCategory}&attr=rozmiarEu:41..43`))).toEqual([
      sneakers.id,
    ]);

    expect(ids(await search('condition=NEW'))).toEqual([boots.id]);
    expect(ids(await search('priceMin=6000&priceMax=10000'))).toEqual([boots.id]);
    expect(ids(await search(`seller=${seller.id}&q=pegasus`))).toEqual([console.id]);

    // Pasek „kończy się w ciągu godziny” (F-63): liczba z `total` przy pageSize=1.
    const inHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect((await search(`endsBefore=${inHour}&pageSize=1`)).total).toBe(0);
    const inMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    expect((await search(`endsBefore=${encodeURIComponent(inMonth)}&pageSize=1`)).total).toBe(3);
    expect((await call('GET', '/v1/auctions?endsBefore=jutro')).statusCode).toBe(400);

    const cheapest = await search('sort=price_asc');
    expect(cheapest.items.map((item) => item.price)).toEqual([5_000, 9_000, 15_000]);
    const newest = await search('sort=newest');
    expect(newest.items[0]?.id).toBe(console.id);

    const outside = await call('GET', `/v1/auctions?category=${moda}&attr=rozmiarEu:42`);
    expect(outside.statusCode).toBe(400);
    expect(problemOf(outside).errors?.[0]).toMatchObject({ path: 'attr' });
    expect((await call('GET', '/v1/auctions?attr=kolor:czarny')).statusCode).toBe(400);
    expect((await call('GET', `/v1/auctions?category=${newId()}`)).statusCode).toBe(400);
  });

  it('oferta zmienia cenę w indeksie (jedna aktualizacja na okno)', async () => {
    const buyer = await createUser(api, pool);
    const bid = await call(
      'POST',
      `/v1/auctions/${boots.id}/bids`,
      buyer,
      { maxAmount: 12_000 },
      { 'idempotency-key': 'search-bid-1' },
    );
    expect(bid.statusCode, bid.body).toBe(201);
    await waitFor(
      async () =>
        (await search('q=samba')).items.find((item) => item.id === boots.id)?.bidCount === 1,
      'nowa liczba ofert w indeksie',
      10_000,
    );
    expect((await search('q=samba')).items[0]).toMatchObject({ price: 9_000, bidCount: 1 });
  });

  it('zakończona aukcja znika z wyników i z indeksu w kilka sekund po zamknięciu', async () => {
    await pool.query(`update auctions set ends_at = now() - interval '1 second' where id = $1`, [
      console.id,
    ]);
    const closedAt = Date.now();
    await worker.app.get(AuctionClosingService).close(console.id);
    await waitFor(
      async () => {
        const documents = await meili.fetchDocuments<{ id: string }>(index, {
          fields: ['id'],
          limit: 100,
          offset: 0,
        });
        return !documents.results.some((document) => document.id === console.id);
      },
      'usunięcie dokumentu zakończonej aukcji',
      15_000,
    );
    expect(Date.now() - closedAt).toBeLessThan(60_000);
    expect(ids(await search('q=pegasus'))).toEqual([]);
  }, 30_000);

  it('nocny reindeks dodaje brakujące aukcje i usuwa nieaktywne; sitemap', async () => {
    await meili.waitForTask(await meili.deleteDocuments(index, [sneakers.id]));
    await meili.waitForTask(
      await meili.replaceDocuments(index, [
        { id: newId(), status: 'ACTIVE', title: 'Zaginiony dokument', endsAtTs: Date.now() + 1e9 },
      ]),
    );
    const result = await worker.app.get(AuctionIndexer).reindex();
    expect(result).toEqual({ indexed: 2, removed: 1 });
    expect(ids(await search(''))).toEqual([sneakers.id, boots.id].sort());

    const sitemap = await call('GET', '/v1/sitemap/auctions');
    expect(sitemap.statusCode).toBe(200);
    const entries = sitemap.json<{ items: { publicId: string; slug: string }[] }>().items;
    expect(entries.map((entry) => entry.publicId).sort()).toEqual(
      [sneakers.publicId, boots.publicId].sort(),
    );
    expect(entries).toContainEqual(
      expect.objectContaining({ publicId: sneakers.publicId, slug: 'nike-air-max-90-biale' }),
    );
  }, 30_000);
});

// Kryteria F-18 (API) na prawdziwym Postgresie i Redisie: publiczny widok aukcji (bez maksimów
// i ceny minimalnej, 404 dla niepublicznych), stan licytacji użytkownika (`me/bids`) i
// rewalidacja strony w web przez worker (atrapa web: sekret, tag, najwyżej raz na 5 s).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { auctionCacheTag } from '@biddy/shared';
import type { LightMyRequestResponse } from 'fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId, newPublicId } from '../../src/infra/db/index.js';
import { type TestUser, WEB_ORIGIN, createUser } from './support/accounts.js';
import { integrationConfig, startTestApp, type TestApp } from './support/app.js';
import type { ScratchDatabase } from './support/database.js';
import {
  type TestWorker,
  createMigratedDatabase,
  redisUrl,
  startTestWorker,
  uniqueQueuePrefix,
  waitFor,
  workerConfig,
} from './support/worker.js';

const SECRET = 'revalidate-secret-0123456789-0123456789';

interface RevalidateCall {
  readonly authorization: string | undefined;
  readonly tags: string[];
  readonly at: number;
}

let database: ScratchDatabase;
let pool: Pool;
let api: TestApp;
let worker: TestWorker;
let web: Server;
let seller: TestUser;
const calls: RevalidateCall[] = [];
let ipCounter = 0;

beforeAll(async () => {
  web = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      if (request.method === 'POST' && request.url === '/api/revalidate') {
        calls.push({
          authorization: request.headers.authorization,
          tags: (JSON.parse(body) as { tags: string[] }).tags,
          at: Date.now(),
        });
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"revalidated":1}');
    });
  });
  await new Promise<void>((resolve) => {
    web.listen(0, '127.0.0.1', resolve);
  });
  const webUrl = `http://127.0.0.1:${String((web.address() as AddressInfo).port)}`;

  database = await createMigratedDatabase();
  pool = new Pool({ connectionString: database.url, max: 8 });
  const shared = {
    DATABASE_URL: database.url,
    REDIS_QUEUE_URL: redisUrl(),
    QUEUE_PREFIX: uniqueQueuePrefix(),
    TRUST_PROXY: 'loopback',
  };
  api = await startTestApp(integrationConfig(shared));
  worker = await startTestWorker(
    workerConfig(database.url, { ...shared, WEB_URL: webUrl, WEB_REVALIDATE_SECRET: SECRET }),
  );
  seller = await createUser(api, pool, { name: 'Sprzedawca Testowy' });
}, 120_000);

afterAll(async () => {
  await worker.close();
  await api.close();
  await pool.end();
  await database.drop();
  await new Promise((resolve) => web.close(resolve));
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

async function readyPhoto(owner: TestUser): Promise<string> {
  const id = newId();
  await pool.query(
    `insert into media (id, owner_id, purpose, status, content_type, size_bytes, width, height)
     values ($1, $2, 'ITEM_PHOTO', 'READY', 'image/jpeg', 1000, 1600, 1200)`,
    [id, owner.id],
  );
  return id;
}

async function categoryId(slug: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>('select id from categories where slug = $1', [
    slug,
  ]);
  return rows[0]?.id ?? '';
}

interface Draft {
  readonly id: string;
  readonly publicId: string;
}

/** Szkic z kompletnymi polami (bez publikacji). */
async function draft(overrides: Record<string, unknown> = {}): Promise<Draft> {
  const created = await call('POST', '/v1/auctions', seller);
  expect(created.statusCode, created.body).toBe(201);
  const { id, publicId } = created.json<Draft>();
  const patched = await call('PATCH', `/v1/auctions/${id}`, seller, {
    mediaIds: [await readyPhoto(seller), await readyPhoto(seller)],
    categoryId: await categoryId('dekoracje'),
    title: 'Wazon ceramiczny, lata 70.',
    description: 'Ręcznie malowany wazon, bez pęknięć i odprysków. Wysokość 30 cm.',
    condition: 'VERY_GOOD',
    packageSize: 'M',
    allowedCarriers: ['inpost-paczkomat', 'dpd-kurier'],
    startPrice: 2_000,
    durationDays: 7,
    ...overrides,
  });
  expect(patched.statusCode, patched.body).toBe(200);
  return { id, publicId };
}

async function published(overrides: Record<string, unknown> = {}): Promise<Draft> {
  const auction = await draft(overrides);
  const response = await call('POST', `/v1/auctions/${auction.id}/publish`, seller, {
    kycNoticeAccepted: true,
  });
  expect(response.statusCode, response.body).toBe(200);
  return auction;
}

let keyCounter = 0;

function bid(user: TestUser, auctionId: string, maxAmount: number) {
  keyCounter += 1;
  return call(
    'POST',
    `/v1/auctions/${auctionId}/bids`,
    user,
    { maxAmount },
    {
      'idempotency-key': `page-${String(keyCounter)}`,
    },
  );
}

interface PublicAuction {
  id: string;
  publicId: string;
  slug: string;
  status: string;
  title: string;
  category: { slug: string; name: string }[];
  photos: { urls: Record<string, string> }[];
  carriers: { id: string; name: string }[];
  seller: { id: string; name: string; kind: string };
  startPrice: number;
  currentPrice: number | null;
  bidCount: number;
  leader: { publicName: string } | null;
  minimumNextBid: number | null;
  reserveStatus: string;
  buyNowPrice: number | null;
  buyNowAvailable: boolean;
  version: number;
  extensionWindowSeconds: number;
}

interface MyBidding {
  isSeller: boolean;
  hasBid: boolean;
  leading: boolean;
  maxAmount: number | null;
  outcome: string;
  order: { publicId: string; total: number; paymentDueAt: string } | null;
}

describe('widok publiczny aukcji', () => {
  it('przedmiot, sprzedawca i licytacja po publicId i UUID; bez maksimów i ceny minimalnej', async () => {
    const { id, publicId } = await published({ reservePrice: 5_000, buyNowPrice: 10_000 });

    const response = await call('GET', `/v1/auctions/${publicId}`);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const auction = response.json<PublicAuction>();
    expect(auction).toMatchObject({
      id,
      publicId,
      slug: 'wazon-ceramiczny-lata-70',
      status: 'ACTIVE',
      title: 'Wazon ceramiczny, lata 70.',
      seller: { id: seller.id, name: 'Sprzedawca Testowy', kind: 'PRIVATE' },
      startPrice: 2_000,
      currentPrice: null,
      bidCount: 0,
      leader: null,
      minimumNextBid: 2_000,
      reserveStatus: 'NOT_MET',
      buyNowPrice: 10_000,
      buyNowAvailable: true,
      extensionWindowSeconds: 120,
    });
    expect(auction.category.at(-1)).toMatchObject({ slug: 'dekoracje' });
    expect(auction.photos).toHaveLength(2);
    expect(auction.photos[0]?.urls['large']).toMatch(/^https?:\/\//u);
    expect(auction.carriers.map((carrier) => carrier.id).sort()).toEqual([
      'dpd-kurier',
      'inpost-paczkomat',
    ]);
    expect(response.body).not.toContain('5000');

    const byUuid = await call('GET', `/v1/auctions/${id}`);
    expect(byUuid.json<PublicAuction>().publicId).toBe(publicId);

    const buyer = await createUser(api, pool, { name: 'Kasia Kupująca' });
    expect((await bid(buyer, id, 3_000)).statusCode).toBe(201);
    const after = await call('GET', `/v1/auctions/${publicId}`);
    expect(after.json<PublicAuction>()).toMatchObject({
      currentPrice: 2_000,
      bidCount: 1,
      leader: { publicName: 'k***a' },
      buyNowPrice: null,
      buyNowAvailable: false,
    });
    expect(after.json<PublicAuction>().version).toBeGreaterThan(auction.version);
    expect(after.body).not.toContain(buyer.id);
    expect(after.body).not.toContain('maxAmount');
    expect(after.body).not.toContain('3000');
  });

  it('404: szkic, aukcja w moderacji, zablokowany sprzedawca, błędny identyfikator', async () => {
    const created = await draft();
    expect((await call('GET', `/v1/auctions/${created.publicId}`)).statusCode).toBe(404);

    const inReview = await published();
    await pool.query(`update auctions set status = 'PENDING_REVIEW' where id = $1`, [inReview.id]);
    expect((await call('GET', `/v1/auctions/${inReview.id}`)).statusCode).toBe(404);

    const other = await createUser(api, pool, { name: 'Zablokowany Sprzedawca' });
    const itemId = newId();
    const auctionId = newId();
    const otherPublicId = newPublicId();
    await pool.query(`insert into items (id, seller_id, title) values ($1, $2, 'Przedmiot')`, [
      itemId,
      other.id,
    ]);
    await pool.query(
      `insert into auctions (id, public_id, item_id, seller_id, status, start_price, starts_at,
         ends_at, original_ends_at, published_at)
       values ($1, $2, $3, $4, 'ACTIVE', 1000, now(), now() + interval '1 day',
         now() + interval '1 day', now())`,
      [auctionId, otherPublicId, itemId, other.id],
    );
    expect((await call('GET', `/v1/auctions/${otherPublicId}`)).statusCode).toBe(200);
    await pool.query(`update users set status = 'BANNED' where id = $1`, [other.id]);
    expect((await call('GET', `/v1/auctions/${otherPublicId}`)).statusCode).toBe(404);

    for (const unknown of ['nieistnieje', newPublicId(), newId(), 'K3X9QA7M']) {
      const response = await call('GET', `/v1/auctions/${unknown}`);
      expect(response.statusCode, unknown).toBe(404);
    }
  });
});

describe('stan licytacji użytkownika (me/bids)', () => {
  it('prowadzenie, przebicie, sprzedający; bez sesji 401', async () => {
    const { id, publicId } = await published();
    const anna = await createUser(api, pool, { name: 'Anna' });
    const bartek = await createUser(api, pool, { name: 'Bartek' });
    expect((await bid(anna, id, 5_000)).statusCode).toBe(201);
    expect((await bid(bartek, id, 3_000)).statusCode).toBe(201);

    const mine = async (user: TestUser) => {
      const response = await call('GET', `/v1/me/bids/${publicId}`, user);
      expect(response.statusCode, response.body).toBe(200);
      return response.json<MyBidding>();
    };
    expect(await mine(anna)).toMatchObject({
      isSeller: false,
      hasBid: true,
      leading: true,
      maxAmount: 5_000,
      outcome: 'NONE',
      order: null,
    });
    expect(await mine(bartek)).toMatchObject({ leading: false, maxAmount: 3_000 });
    expect(await mine(seller)).toMatchObject({
      isSeller: true,
      hasBid: false,
      leading: false,
      maxAmount: null,
    });
    expect((await call('GET', `/v1/me/bids/${publicId}`)).statusCode).toBe(401);
  });

  it('po zakończeniu: wygrana z zamówieniem, przegrana, nieosiągnięta cena minimalna', async () => {
    const sold = await published({ buyNowPrice: 10_000 });
    const anna = await createUser(api, pool, { name: 'Anna' });
    keyCounter += 1;
    const bought = await call('POST', `/v1/auctions/${sold.id}/buy-now`, anna, undefined, {
      'idempotency-key': `page-${String(keyCounter)}`,
    });
    expect(bought.statusCode, bought.body).toBe(201);
    const won = await call('GET', `/v1/me/bids/${sold.id}`, anna);
    expect(won.json<MyBidding>()).toMatchObject({ outcome: 'WON', leading: true });
    expect(won.json<MyBidding>().order).toMatchObject({ total: expect.any(Number) as number });
    expect(won.json<MyBidding>().order?.total).toBeGreaterThan(10_000);

    const contested = await published();
    const winner = await createUser(api, pool, { name: 'Wygrywający' });
    const loser = await createUser(api, pool, { name: 'Przegrany' });
    await bid(loser, contested.id, 3_000);
    await bid(winner, contested.id, 6_000);
    await pool.query(`update auctions set status = 'ENDED_SOLD' where id = $1`, [contested.id]);
    const lost = await call('GET', `/v1/me/bids/${contested.id}`, loser);
    expect(lost.json<MyBidding>()).toMatchObject({ outcome: 'LOST', order: null });

    const reserved = await published({ reservePrice: 50_000 });
    const hopeful = await createUser(api, pool, { name: 'Bez Ceny Minimalnej' });
    await bid(hopeful, reserved.id, 4_000);
    await pool.query(`update auctions set status = 'ENDED_UNSOLD' where id = $1`, [reserved.id]);
    const unsold = await call('GET', `/v1/me/bids/${reserved.id}`, hopeful);
    expect(unsold.json<MyBidding>()).toMatchObject({ outcome: 'RESERVE_NOT_MET' });
  });
});

describe('rewalidacja strony aukcji w web', () => {
  it('po publikacji i ofertach worker woła web z sekretem i tagiem, najwyżej raz na 5 s', async () => {
    const { id, publicId } = await published();
    const tag = auctionCacheTag(publicId);
    const forPage = () => calls.filter((entry) => entry.tags.includes(tag));

    await waitFor(() => forPage().length > 0, 'rewalidacja po publikacji', 10_000);
    expect(forPage()[0]?.authorization).toBe(`Bearer ${SECRET}`);
    const afterPublish = forPage().length;

    const buyers = await Promise.all([1, 2, 3].map(() => createUser(api, pool)));
    const firstBidAt = Date.now();
    for (const [index, buyer] of buyers.entries()) {
      expect((await bid(buyer, id, 3_000 + index * 1_000)).statusCode).toBe(201);
    }
    await waitFor(() => forPage().length > afterPublish, 'rewalidacja po ofertach', 10_000);
    // Oferty mogły trafić w dwa sąsiednie okna; wtedy wywołania dzieli co najmniej ok. 5 s.
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    const afterBids = forPage().slice(afterPublish);
    expect(afterBids.length).toBeGreaterThanOrEqual(1);
    expect(afterBids.length).toBeLessThanOrEqual(2);
    expect(afterBids[0]?.at ?? 0).toBeLessThan(firstBidAt + 7_000);
    for (let index = 1; index < afterBids.length; index += 1) {
      expect((afterBids[index]?.at ?? 0) - (afterBids[index - 1]?.at ?? 0)).toBeGreaterThan(4_000);
    }
  }, 40_000);
});

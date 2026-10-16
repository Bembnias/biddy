// Kryteria F-21 (API) na prawdziwym Postgresie: listy Moje Biddy. Licytacje trwające
// (prowadzę/przebity), wygrane z zamówieniem, przegrane (także cena minimalna i anulowanie),
// unieważnione oferty pominięte, obserwowane w kolejności i zamówienie przy sprzedanej aukcji.
import type { LightMyRequestResponse } from 'fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId } from '../../src/infra/db/index.js';
import { AuctionClosingService } from '../../src/modules/auctions/index.js';
import { type TestUser, WEB_ORIGIN, createUser } from './support/accounts.js';
import { integrationConfig, startTestApp, type TestApp } from './support/app.js';
import type { ScratchDatabase } from './support/database.js';
import { createMigratedDatabase, redisUrl, uniqueQueuePrefix } from './support/worker.js';

let database: ScratchDatabase;
let pool: Pool;
let api: TestApp;
let ipCounter = 0;

beforeAll(async () => {
  database = await createMigratedDatabase();
  pool = new Pool({ connectionString: database.url, max: 8 });
  api = await startTestApp(
    integrationConfig({
      DATABASE_URL: database.url,
      REDIS_QUEUE_URL: redisUrl(),
      QUEUE_PREFIX: uniqueQueuePrefix(),
      TRUST_PROXY: 'loopback',
    }),
  );
}, 120_000);

afterAll(async () => {
  await api.close();
  await pool.end();
  await database.drop();
});

function call(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
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

interface Published {
  readonly id: string;
  readonly publicId: string;
  readonly owner: TestUser;
}

async function publish(title: string, fields: Record<string, unknown> = {}): Promise<Published> {
  const owner = await createUser(api, pool, { name: 'Sprzedawca' });
  const media = newId();
  await pool.query(
    `insert into media (id, owner_id, purpose, status, content_type, size_bytes, width, height)
     values ($1, $2, 'ITEM_PHOTO', 'READY', 'image/jpeg', 1000, 1600, 1200)`,
    [media, owner.id],
  );
  const { rows } = await pool.query<{ id: string }>(
    `select id from categories where slug = 'dekoracje'`,
  );
  const created = await call('POST', '/v1/auctions', owner);
  const { id, publicId } = created.json<{ id: string; publicId: string }>();
  const patched = await call('PATCH', `/v1/auctions/${id}`, owner, {
    mediaIds: [media],
    categoryId: rows[0]?.id,
    title,
    description: 'Opis przedmiotu testowego, wystarczająco długi do publikacji.',
    condition: 'GOOD',
    packageSize: 'M',
    allowedCarriers: ['inpost-paczkomat'],
    startPrice: 2_000,
    durationDays: 7,
    ...fields,
  });
  expect(patched.statusCode, patched.body).toBe(200);
  const published = await call('POST', `/v1/auctions/${id}/publish`, owner, {
    kycNoticeAccepted: true,
  });
  expect(published.statusCode, published.body).toBe(200);
  return { id, publicId, owner };
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
      'idempotency-key': `mine-${String(keyCounter)}`,
    },
  );
}

async function close(auctionId: string): Promise<void> {
  await pool.query(`update auctions set ends_at = now() - interval '1 second' where id = $1`, [
    auctionId,
  ]);
  await api.app.get(AuctionClosingService).close(auctionId);
}

interface MyBids {
  items: {
    auction: { id: string; title: string; status: string; price: number; coverUrl: string | null };
    maxAmount: number;
    leading: boolean;
    outcome: string;
    order: { publicId: string; status: string; total: number } | null;
  }[];
  total: number;
  totalPages: number;
}

async function myBids(user: TestUser, status: string): Promise<MyBids> {
  const response = await call('GET', `/v1/me/bids?status=${status}`, user);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<MyBids>();
}

describe('Moje Biddy: licytacje', () => {
  it('trwające (prowadzę/przebity), wygrane z zamówieniem, przegrane; unieważnione pominięte', async () => {
    const anna = await createUser(api, pool, { name: 'Anna' });
    const bartek = await createUser(api, pool, { name: 'Bartek' });

    const outbid = await publish('Aukcja przebita');
    await bid(anna, outbid.id, 3_000);
    await bid(bartek, outbid.id, 5_000);
    const leading = await publish('Aukcja prowadzona');
    await bid(anna, leading.id, 4_000);
    await pool.query(`update auctions set ends_at = now() + interval '1 hour' where id = $1`, [
      leading.id,
    ]);

    const bought = await publish('Aukcja kupiona', { buyNowPrice: 10_000 });
    keyCounter += 1;
    expect(
      (
        await call('POST', `/v1/auctions/${bought.id}/buy-now`, anna, undefined, {
          'idempotency-key': `mine-${String(keyCounter)}`,
        })
      ).statusCode,
    ).toBe(201);

    const lost = await publish('Aukcja przegrana');
    await bid(anna, lost.id, 3_000);
    await bid(bartek, lost.id, 6_000);
    await close(lost.id);

    const reserve = await publish('Aukcja z ceną minimalną', { reservePrice: 50_000 });
    await bid(anna, reserve.id, 4_000);
    await close(reserve.id);

    const cancelled = await publish('Aukcja anulowana');
    await bid(anna, cancelled.id, 3_000);
    expect(
      (await call('POST', `/v1/auctions/${cancelled.id}/cancel`, cancelled.owner, {})).statusCode,
    ).toBe(200);

    // Jedyna oferta Anny unieważniona przez personel: aukcji nie ma na liście.
    const voided = await publish('Aukcja z unieważnioną ofertą');
    await bid(anna, voided.id, 3_000);
    const staff = await createUser(api, pool, { name: 'Support' });
    await pool.query(`update users set staff_role = 'support' where id = $1`, [staff.id]);
    const { rows } = await pool.query<{ id: string }>(
      `select id from bids where auction_id = $1 and bidder_id = $2`,
      [voided.id, anna.id],
    );
    const cancelBid = await call('POST', `/v1/admin/bids/${rows[0]?.id ?? ''}/cancel`, staff, {
      reason: 'TYPO',
      note: 'Literówka zgłoszona do supportu.',
    });
    expect(cancelBid.statusCode, cancelBid.body).toBe(200);

    const active = await myBids(anna, 'ACTIVE');
    expect(active.items.map((item) => [item.auction.title, item.leading, item.maxAmount])).toEqual([
      ['Aukcja prowadzona', true, 4_000],
      ['Aukcja przebita', false, 3_000],
    ]);
    expect(active.items[1]?.auction.price).toBe(3_100);
    expect(active.items[0]?.auction.coverUrl).toMatch(/^https?:\/\//u);

    const won = await myBids(anna, 'WON');
    expect(won.items).toHaveLength(1);
    expect(won.items[0]).toMatchObject({
      auction: { title: 'Aukcja kupiona', status: 'ENDED_SOLD' },
      outcome: 'WON',
      order: { status: 'AWAITING_PAYMENT' },
    });
    expect(won.items[0]?.order?.total).toBeGreaterThan(10_000);

    const lostList = await myBids(anna, 'LOST');
    expect(
      lostList.items.map((item) => [item.auction.title, item.auction.status, item.outcome]).sort(),
    ).toEqual(
      [
        ['Aukcja anulowana', 'CANCELLED', 'NONE'],
        ['Aukcja przegrana', 'ENDED_SOLD', 'LOST'],
        ['Aukcja z ceną minimalną', 'ENDED_UNSOLD', 'RESERVE_NOT_MET'],
      ].sort(),
    );
    expect(lostList.items.every((item) => item.order === null)).toBe(true);
    expect((await myBids(bartek, 'WON')).items.map((item) => item.auction.title)).toEqual([
      'Aukcja przegrana',
    ]);

    // Sprzedający widzi zamówienie przy sprzedanej aukcji.
    const sellerList = await call('GET', '/v1/me/auctions?status=ENDED_SOLD', bought.owner);
    expect(sellerList.json<{ order: { status: string } | null }[]>()[0]?.order).toMatchObject({
      status: 'AWAITING_PAYMENT',
    });

    expect((await call('GET', '/v1/me/bids?status=ACTIVE')).statusCode).toBe(401);
    expect((await call('GET', '/v1/me/bids?status=ALL', anna)).statusCode).toBe(400);
  });
});

describe('Moje Biddy: obserwowane', () => {
  it('aktywne najpierw (najbliższy koniec), potem zakończone', async () => {
    const ola = await createUser(api, pool, { name: 'Ola' });
    const later = await publish('Kończy się później');
    const sooner = await publish('Kończy się wcześniej');
    const ended = await publish('Już zakończona');
    await pool.query(`update auctions set ends_at = now() + interval '2 hours' where id = $1`, [
      sooner.id,
    ]);
    for (const auction of [later, sooner, ended]) {
      expect((await call('PUT', `/v1/me/watchlist/${auction.id}`, ola)).statusCode).toBe(204);
    }
    await close(ended.id);
    const response = await call('GET', '/v1/me/watchlist', ola);
    expect(response.statusCode, response.body).toBe(200);
    expect(
      response
        .json<{ items: { title: string; status: string }[] }>()
        .items.map((item) => [item.title, item.status]),
    ).toEqual([
      ['Kończy się wcześniej', 'ACTIVE'],
      ['Kończy się później', 'ACTIVE'],
      ['Już zakończona', 'ENDED_UNSOLD'],
    ]);
  });
});

// Kryteria F-16 na prawdziwym Postgresie i Redisie z workerem w procesie: event publikacji →
// job zamknięcia → zamknięcie z zamówieniem; przedłużenia przez prawdziwe oferty (krótkie okno
// anti-snipingu); sweeper dla aukcji bez joba; ENDED_UNSOLD; dokładnie jedno zamówienie przy
// równoległych zamknięciach; Kup teraz z zamówieniem; anulowanie przez moderację.
import { setTimeout as delay } from 'node:timers/promises';

import type { LightMyRequestResponse } from 'fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Database, DRIZZLE, newId } from '../../src/infra/db/index.js';
import { Outbox } from '../../src/infra/outbox/index.js';
import { AuctionClosingService, AuctionPublished } from '../../src/modules/auctions/index.js';
import { type TestUser, WEB_ORIGIN, createUser } from './support/accounts.js';
import { integrationConfig, problemOf, startTestApp, type TestApp } from './support/app.js';
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

/** Okno anti-snipingu w tym pliku: 3 s zamiast 2 minut. */
const WINDOW_MS = 3_000;

let database: ScratchDatabase;
let pool: Pool;
let api: TestApp;
let worker: TestWorker;
let seller: TestUser;
let categoryId: string;

beforeAll(async () => {
  database = await createMigratedDatabase();
  pool = new Pool({ connectionString: database.url, max: 8 });
  const shared = {
    DATABASE_URL: database.url,
    REDIS_QUEUE_URL: redisUrl(),
    QUEUE_PREFIX: uniqueQueuePrefix(),
    AUCTION_ANTI_SNIPING_SECONDS: String(WINDOW_MS / 1000),
  };
  api = await startTestApp(integrationConfig(shared));
  worker = await startTestWorker(workerConfig(database.url, shared));
  seller = await createUser(api, pool, { name: 'Sprzedawca Testowy' });
  const { rows } = await pool.query<{ id: string }>(
    `select id from categories where slug = 'dekoracje'`,
  );
  categoryId = rows[0]?.id ?? '';
}, 120_000);

afterAll(async () => {
  await worker.close();
  await api.close();
  await pool.end();
  await database.drop();
});

interface AuctionOptions {
  readonly startPrice?: number;
  readonly reservePrice?: number | null;
  readonly buyNowPrice?: number | null;
  /** Koniec względem teraz (ujemny: w przeszłości). */
  readonly endsInMs: number;
  /** Stan licytacji wpisany wprost (bez ofert przez API). */
  readonly leader?: { readonly id: string; readonly price: number };
}

/** Aktywna aukcja z przedmiotem (kategoria, zdjęcie) wstawiona wprost do bazy. */
async function auction(options: AuctionOptions): Promise<{ id: string; endsAt: Date }> {
  const itemId = newId();
  const mediaId = newId();
  const id = newId();
  await pool.query(
    `insert into media (id, owner_id, purpose, status, content_type, size_bytes, width, height, attached_at)
     values ($1, $2, 'ITEM_PHOTO', 'READY', 'image/jpeg', 1000, 1600, 1200, now())`,
    [mediaId, seller.id],
  );
  await pool.query(
    `insert into items (id, seller_id, category_id, title, description, condition, package_size, allowed_carriers)
     values ($1, $2, $3, 'Wazon ceramiczny, lata 70.', 'Ręcznie malowany wazon, bez pęknięć.', 'GOOD', 'M', '{inpost-paczkomat}')`,
    [itemId, seller.id, categoryId],
  );
  await pool.query(`insert into item_media (item_id, media_id, position) values ($1, $2, 0)`, [
    itemId,
    mediaId,
  ]);
  const { rows } = await pool.query<{ ends_at: Date }>(
    `insert into auctions (id, public_id, item_id, seller_id, status, start_price, reserve_price,
       buy_now_price, duration_days, starts_at, ends_at, original_ends_at, published_at,
       current_price, leader_id, leader_max_amount, bid_count)
     values ($1, $2, $3, $4, 'ACTIVE', $5, $6, $7, 7, now(), now() + $8 * interval '1 millisecond',
       now() + $8 * interval '1 millisecond', now(), $9, $10, $9, $11)
     returning ends_at`,
    [
      id,
      id.slice(-8),
      itemId,
      seller.id,
      options.startPrice ?? 1_000,
      options.reservePrice ?? null,
      options.buyNowPrice ?? null,
      options.endsInMs,
      options.leader?.price ?? null,
      options.leader?.id ?? null,
      options.leader === undefined ? 0 : 1,
    ],
  );
  return { id, endsAt: rows[0]?.ends_at ?? new Date() };
}

/** Event publikacji w outboxie (jak po publikacji w kreatorze, F-14). */
async function published(id: string, endsAt: Date): Promise<void> {
  const db = api.app.get<Database>(DRIZZLE);
  const outbox = api.app.get(Outbox);
  await db.transaction(async (tx) => {
    await outbox.add(
      tx,
      AuctionPublished.create({
        aggregateId: id,
        payload: {
          sellerId: seller.id,
          itemId: newId(),
          categoryId,
          startPrice: { amount: 1_000, currency: 'PLN' },
          buyNowPrice: null,
          startsAt: new Date().toISOString(),
          endsAt: endsAt.toISOString(),
        },
      }),
    );
  });
}

let keyCounter = 0;
function bid(
  user: TestUser,
  auctionId: string,
  maxAmount: number,
): Promise<LightMyRequestResponse> {
  keyCounter += 1;
  return api.http.inject({
    method: 'POST',
    url: `/v1/auctions/${auctionId}/bids`,
    headers: {
      origin: WEB_ORIGIN,
      cookie: user.cookie,
      'idempotency-key': `c-${String(keyCounter)}`,
    },
    payload: { maxAmount },
  });
}

interface AuctionRow {
  status: string;
  ends_at: Date;
  updated_at: Date;
  current_price: string | null;
}

async function row(id: string): Promise<AuctionRow> {
  const { rows } = await pool.query<AuctionRow>('select * from auctions where id = $1', [id]);
  if (rows[0] === undefined) {
    throw new Error('brak aukcji');
  }
  return rows[0];
}

interface OrderRow {
  id: string;
  status: string;
  buyer_id: string;
  items_total: string;
  pok_fee: string;
  pok_vat: string;
  total: string;
  payment_due_at: Date;
  hammer_price: string;
  item_snapshot: Record<string, unknown>;
}

async function ordersOf(auctionId: string): Promise<OrderRow[]> {
  const { rows } = await pool.query<OrderRow>(
    `select o.*, i.hammer_price, i.item_snapshot from orders o
     join order_items i on i.order_id = o.id where i.auction_id = $1 and i.is_active`,
    [auctionId],
  );
  return rows;
}

async function outbox(type: string, aggregateId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
    'select payload from outbox where type = $1 and aggregate_id = $2 order by occurred_at',
    [type, aggregateId],
  );
  return rows.map((entry) => entry.payload);
}

const ended = (id: string) =>
  waitFor(
    async () => {
      const state = await row(id);
      return state.status === 'ACTIVE' ? undefined : state;
    },
    'zakończenie aukcji',
    25_000,
  );

describe('zamykanie po czasie', () => {
  it('event publikacji → job → ENDED_SOLD z zamówieniem (POK, termin 24 h, snapshot)', async () => {
    const buyer = await createUser(api, pool, { name: 'Kupujący Testowy' });
    const { id, endsAt } = await auction({ endsInMs: WINDOW_MS + 1_500 });
    await published(id, endsAt);
    expect((await bid(buyer, id, 5_000)).statusCode).toBe(201);

    const state = await ended(id);
    expect(state.status).toBe('ENDED_SOLD');
    expect(state.updated_at.getTime()).toBeGreaterThanOrEqual(endsAt.getTime());
    expect(state.updated_at.getTime() - endsAt.getTime()).toBeLessThan(5_000);

    const [order] = await ordersOf(id);
    // 10 zł + POK (2,99 zł + 7% z 10 zł = 3,69 zł, VAT 0,69 zł).
    expect(order).toMatchObject({
      status: 'AWAITING_PAYMENT',
      buyer_id: buyer.id,
      items_total: '1000',
      pok_fee: '369',
      pok_vat: '69',
      total: '1369',
      hammer_price: '1000',
    });
    expect(order?.payment_due_at.getTime()).toBe(endsAt.getTime() + 24 * 60 * 60 * 1_000);
    expect(order?.item_snapshot).toMatchObject({
      version: 1,
      auction: { id, endedBy: 'TIME', endedAt: endsAt.toISOString() },
      item: {
        title: 'Wazon ceramiczny, lata 70.',
        category: { id: categoryId, path: ['Dom i ogród', 'Dekoracje'] },
        condition: 'GOOD',
        photos: [{ urls: { large: expect.stringContaining('/large.webp') as string } }],
      },
    });
    expect(await outbox('AuctionEnded', id)).toEqual([
      expect.objectContaining({ outcome: 'SOLD', winnerId: buyer.id, endedBy: 'TIME' }),
    ]);
    expect(await outbox('OrderCreated', order?.id ?? '')).toEqual([
      expect.objectContaining({
        auctionId: id,
        buyerId: buyer.id,
        total: { amount: 1_369, currency: 'PLN' },
      }),
    ]);
  });

  it('kilka przedłużeń z rzędu: nie kończy się przed ostatnim czasem końca, kończy się po nim', async () => {
    const anna = await createUser(api, pool);
    const bartek = await createUser(api, pool);
    const { id, endsAt } = await auction({ endsInMs: 2_000 });
    await published(id, endsAt);

    expect((await bid(anna, id, 2_000)).statusCode).toBe(201);
    await delay(1_000);
    expect((await bid(bartek, id, 3_000)).statusCode).toBe(201);
    await delay(1_000);
    expect((await bid(anna, id, 4_000)).statusCode).toBe(201);
    const extended = await row(id);
    expect(extended.ends_at.getTime()).toBeGreaterThan(endsAt.getTime() + 1_500);
    expect(await outbox('AuctionExtended', id)).toHaveLength(3);

    // Stare joby (pierwotny koniec i wcześniejsze przedłużenia) już minęły: aukcja trwa.
    await delay(Math.max(0, extended.ends_at.getTime() - Date.now() - 500));
    expect((await row(id)).status).toBe('ACTIVE');

    const state = await ended(id);
    expect(state.status).toBe('ENDED_SOLD');
    expect(state.updated_at.getTime()).toBeGreaterThanOrEqual(extended.ends_at.getTime());
    expect(await ordersOf(id)).toHaveLength(1);
  });

  it('sweeper zamyka aukcję, której job zaginął (najpóźniej 30 s po końcu)', async () => {
    const buyer = await createUser(api, pool);
    const { id, endsAt } = await auction({
      endsInMs: -6_000,
      leader: { id: buyer.id, price: 1_500 },
    });
    const state = await ended(id);
    expect(state.status).toBe('ENDED_SOLD');
    expect(state.updated_at.getTime() - endsAt.getTime()).toBeLessThan(30_000);
    expect(await ordersOf(id)).toHaveLength(1);
    // API i worker działają tu w jednym procesie: statyczny Logger Nesta pisze do loggera API.
    const logs = [...api.logLines(), ...worker.logLines()];
    expect(
      logs.some(
        (line) =>
          line['msg'] === 'Sweeper zamknął aukcję (job zamknięcia nie zdążył)' &&
          line['auctionId'] === id,
      ),
    ).toBe(true);
  }, 40_000);
});

describe('wynik zamknięcia', () => {
  it('bez ofert albo z nieosiągniętą ceną minimalną: ENDED_UNSOLD bez zamówienia', async () => {
    const closing = api.app.get(AuctionClosingService);
    const empty = await auction({ endsInMs: -1_000 });
    expect(await closing.close(empty.id)).toBe('UNSOLD');

    const buyer = await createUser(api, pool);
    const belowReserve = await auction({
      endsInMs: -1_000,
      reservePrice: 20_000,
      leader: { id: buyer.id, price: 15_000 },
    });
    expect(await closing.close(belowReserve.id)).toBe('UNSOLD');
    expect((await row(belowReserve.id)).status).toBe('ENDED_UNSOLD');
    expect(await ordersOf(belowReserve.id)).toEqual([]);
    expect(await outbox('AuctionEnded', belowReserve.id)).toEqual([
      expect.objectContaining({ outcome: 'UNSOLD', winnerId: null, finalPrice: null }),
    ]);
  });

  it('przed końcem (przedłużona): brak zamknięcia, nowy job na aktualny termin', async () => {
    const closing = api.app.get(AuctionClosingService);
    const { id } = await auction({ endsInMs: 60_000 });
    expect(await closing.close(id)).toBe('RESCHEDULED');
    expect((await row(id)).status).toBe('ACTIVE');
  });

  it('równoległe zamknięcia: dokładnie jedno zamówienie; drugie aktywne odrzuca indeks', async () => {
    const closing = api.app.get(AuctionClosingService);
    const buyer = await createUser(api, pool);
    const { id } = await auction({ endsInMs: -1_000, leader: { id: buyer.id, price: 2_000 } });
    const results = await Promise.all(Array.from({ length: 5 }, () => closing.close(id)));
    expect(results.filter((result) => result === 'SOLD')).toHaveLength(1);
    expect(results.filter((result) => result === 'NOT_ACTIVE')).toHaveLength(4);
    const orders = await ordersOf(id);
    expect(orders).toHaveLength(1);

    await expect(
      pool.query(
        `insert into order_items (id, order_id, auction_id, hammer_price, item_snapshot)
         values ($1, $2, $3, 2000, '{}')`,
        [newId(), orders[0]?.id, id],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
});

describe('Kup teraz i moderacja', () => {
  it('Kup teraz tworzy zamówienie w tej samej transakcji', async () => {
    const buyer = await createUser(api, pool);
    const { id } = await auction({ endsInMs: 60 * 60_000, buyNowPrice: 8_000 });
    const response = await api.http.inject({
      method: 'POST',
      url: `/v1/auctions/${id}/buy-now`,
      headers: { origin: WEB_ORIGIN, cookie: buyer.cookie, 'idempotency-key': 'buy-1' },
    });
    expect(response.statusCode, response.body).toBe(201);
    const [order] = await ordersOf(id);
    expect(order).toMatchObject({ buyer_id: buyer.id, items_total: '8000', hammer_price: '8000' });
    expect(order?.item_snapshot).toMatchObject({ auction: { endedBy: 'BUY_NOW' } });
  });

  it('moderator anuluje aukcję z ofertami; support nie może; zamknięcie potem nic nie robi', async () => {
    const buyer = await createUser(api, pool);
    const moderator = await createUser(api, pool);
    const support = await createUser(api, pool);
    await pool.query(`update users set staff_role = 'moderator' where id = $1`, [moderator.id]);
    await pool.query(`update users set staff_role = 'support' where id = $1`, [support.id]);
    const { id } = await auction({ endsInMs: 60 * 60_000 });
    await bid(buyer, id, 3_000);

    const cancel = (user: TestUser) =>
      api.http.inject({
        method: 'POST',
        url: `/v1/admin/auctions/${id}/cancel`,
        headers: { origin: WEB_ORIGIN, cookie: user.cookie },
        payload: { note: 'Przedmiot z listy zakazanych (regulamin, pkt 4).' },
      });
    expect((await cancel(support)).statusCode).toBe(403);
    const response = await cancel(moderator);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ status: 'CANCELLED', bidCount: 1 });
    expect(await outbox('AuctionCancelled', id)).toEqual([
      expect.objectContaining({
        cancelledBy: 'MODERATOR',
        bidCount: 1,
        reason: 'Przedmiot z listy zakazanych (regulamin, pkt 4).',
      }),
    ]);
    expect(problemOf(await cancel(moderator)).code).toBe('CONFLICT');
    expect(await api.app.get(AuctionClosingService).close(id)).toBe('NOT_ACTIVE');
  });
});

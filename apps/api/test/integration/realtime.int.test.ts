// Kryteria F-17 na prawdziwym Postgresie i Redisie: dwie instancje API na portach (wspólny Redis
// pub/sub), worker i klienci Socket.IO. Zdarzenie z oferty na instancji A dociera do klienta na
// instancji B; roomy użytkowników tylko dla właściciela sesji (ciasteczko albo Bearer); Origin;
// limity subskrypcji; zegar; Kup teraz i zamknięcie w workerze.
import type {
  AuctionEndedEvent,
  AuctionUpdatedEvent,
  ClientToServerEvents,
  ServerToClientEvents,
  SubscribeResult,
  UserOutbidEvent,
  UserWonEvent,
} from '@biddy/realtime';
import { Pool } from 'pg';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { newId } from '../../src/infra/db/index.js';
import { REALTIME_PATH } from '../../src/infra/realtime/index.js';
import { AuctionClosingService } from '../../src/modules/auctions/index.js';
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

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let database: ScratchDatabase;
let pool: Pool;
let apiA: TestApp;
let apiB: TestApp;
let worker: TestWorker;
let urlA: string;
let urlB: string;
let seller: TestUser;
const clients: Client[] = [];

beforeAll(async () => {
  database = await createMigratedDatabase();
  pool = new Pool({ connectionString: database.url, max: 8 });
  const shared = {
    DATABASE_URL: database.url,
    REDIS_QUEUE_URL: redisUrl(),
    REDIS_CACHE_URL: redisUrl(),
    QUEUE_PREFIX: uniqueQueuePrefix(),
    CORS_ORIGINS: WEB_ORIGIN,
  };
  apiA = await startTestApp(integrationConfig(shared));
  apiB = await startTestApp(integrationConfig(shared));
  await apiA.app.listen(0, '127.0.0.1');
  await apiB.app.listen(0, '127.0.0.1');
  urlA = await apiA.app.getUrl();
  urlB = await apiB.app.getUrl();
  worker = await startTestWorker(workerConfig(database.url, shared));
  seller = await createUser(apiA, pool, { name: 'Sprzedawca Testowy' });
}, 120_000);

afterEach(() => {
  for (const client of clients.splice(0)) {
    client.disconnect();
  }
});

afterAll(async () => {
  await worker.close();
  await apiA.close();
  await apiB.close();
  await pool.end();
  await database.drop();
});

function connect(
  url: string,
  options: { readonly user?: TestUser; readonly bearer?: boolean; readonly origin?: string } = {},
): Client {
  const headers: Record<string, string> = {};
  if (options.origin !== undefined) {
    headers['origin'] = options.origin;
  }
  if (options.user !== undefined && options.bearer !== true) {
    headers['cookie'] = options.user.cookie;
    headers['origin'] ??= WEB_ORIGIN;
  }
  const client: Client = io(url, {
    path: REALTIME_PATH,
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: headers,
    auth:
      options.bearer === true && options.user !== undefined ? { token: options.user.token } : {},
  });
  clients.push(client);
  return client;
}

async function connected(client: Client): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (client.connected) {
      resolve();
      return;
    }
    client.once('connect', () => {
      resolve();
    });
    client.once('connect_error', reject);
  });
}

async function subscribe(client: Client, auctionId: string): Promise<SubscribeResult> {
  await connected(client);
  return client.emitWithAck('auction:subscribe', auctionId);
}

/** Zbiera zdarzenia danego typu z gniazda. */
function collect<E extends keyof ServerToClientEvents>(
  client: Client,
  event: E,
): Parameters<ServerToClientEvents[E]>[0][] {
  const received: Parameters<ServerToClientEvents[E]>[0][] = [];
  (client.on as (name: string, listener: (payload: unknown) => void) => void)(event, (payload) => {
    received.push(payload as Parameters<ServerToClientEvents[E]>[0]);
  });
  return received;
}

async function auction(
  options: {
    readonly buyNowPrice?: number;
    readonly endsInMs?: number;
    readonly leaderId?: string;
  } = {},
): Promise<string> {
  const itemId = newId();
  const id = newId();
  await pool.query(
    `insert into items (id, seller_id, title) values ($1, $2, 'Przedmiot na żywo')`,
    [itemId, seller.id],
  );
  await pool.query(
    `insert into auctions (id, public_id, item_id, seller_id, status, start_price, buy_now_price,
       duration_days, starts_at, ends_at, original_ends_at, published_at, current_price, leader_id,
       leader_max_amount, bid_count)
     values ($1, $2, $3, $4, 'ACTIVE', 1000, $5, 7, now(), now() + $6 * interval '1 millisecond',
       now() + $6 * interval '1 millisecond', now(), $7, $8, $7, $9)`,
    [
      id,
      id.slice(-8),
      itemId,
      seller.id,
      options.buyNowPrice ?? null,
      options.endsInMs ?? 24 * 60 * 60 * 1_000,
      options.leaderId === undefined ? null : 1_500,
      options.leaderId ?? null,
      options.leaderId === undefined ? 0 : 1,
    ],
  );
  return id;
}

let keyCounter = 0;
function bid(api: TestApp, user: TestUser, auctionId: string, maxAmount: number) {
  keyCounter += 1;
  return api.http.inject({
    method: 'POST',
    url: `/v1/auctions/${auctionId}/bids`,
    headers: {
      origin: WEB_ORIGIN,
      cookie: user.cookie,
      'idempotency-key': `rt-${String(keyCounter)}`,
    },
    payload: { maxAmount },
  });
}

describe('zdarzenia aukcji między instancjami', () => {
  it('oferta na instancji A → auction.updated u klienta na B (bez maksimów), p95 < 300 ms', async () => {
    const id = await auction();
    const viewer = connect(urlB);
    expect(await subscribe(viewer, id)).toEqual({ ok: true });
    const updates = collect(viewer, 'auction.updated');
    const anna = await createUser(apiA, pool, { name: 'Anna Licytująca' });
    const bartek = await createUser(apiA, pool, { name: 'Bartek' });

    const latencies: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const before = updates.length;
      const startedAt = performance.now();
      const response = await bid(
        apiA,
        index % 2 === 0 ? anna : bartek,
        id,
        1_000 + (index + 1) * 2_000,
      );
      expect(response.statusCode, response.body).toBe(201);
      await waitFor(() => updates.length > before, 'auction.updated', 2_000);
      latencies.push(performance.now() - startedAt);
    }
    latencies.sort((a, b) => a - b);
    expect(latencies[Math.floor(latencies.length * 0.95) - 1]).toBeLessThan(300);

    const last = updates.at(-1) as AuctionUpdatedEvent;
    expect(last).toMatchObject({
      auctionId: id,
      status: 'ACTIVE',
      leader: { publicName: 'b***k' },
      reserveStatus: 'NONE',
      buyNowAvailable: false,
    });
    expect(updates.map((update) => update.version)).toEqual(
      [...updates.map((update) => update.version)].sort((a, b) => a - b),
    );
    const raw = JSON.stringify(updates);
    expect(raw).not.toContain('maxAmount');
    expect(raw).not.toContain(anna.id);
    expect(raw).not.toContain(bartek.id);
  });
});

describe('roomy użytkowników', () => {
  it('przebity dostaje user.outbid (ciasteczko i Bearer); inni i anonimowi nie', async () => {
    const id = await auction();
    const anna = await createUser(apiA, pool);
    const bartek = await createUser(apiA, pool);
    const annaWeb = connect(urlA, { user: anna });
    const annaMobile = connect(urlB, { user: anna, bearer: true });
    const bartekWeb = connect(urlB, { user: bartek });
    const anonymous = connect(urlB);
    await Promise.all(
      [annaWeb, annaMobile, bartekWeb, anonymous].map((client) => connected(client)),
    );
    const annaEvents = [collect(annaWeb, 'user.outbid'), collect(annaMobile, 'user.outbid')];
    const others = [collect(bartekWeb, 'user.outbid'), collect(anonymous, 'user.outbid')];

    await bid(apiA, anna, id, 5_000);
    await bid(apiB, bartek, id, 9_000);
    await waitFor(
      () => annaEvents.every((events) => events.length === 1),
      'user.outbid u Anny na obu urządzeniach',
      3_000,
    );
    expect(annaEvents[0]?.[0]).toMatchObject({
      auctionId: id,
      currentPrice: 5_100,
      minimumNextBid: 5_200,
    } satisfies Partial<UserOutbidEvent>);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(others.map((events) => events.length)).toEqual([0, 0]);
  });

  it('Origin spoza aplikacji: połączenie odrzucone; błędny identyfikator i limit subskrypcji', async () => {
    const attacker = connect(urlA, { origin: 'https://evil.example' });
    await expect(connected(attacker)).rejects.toThrow();

    const client = connect(urlA);
    expect(await subscribe(client, 'user:01960000-0000-7000-8000-000000000001')).toEqual({
      ok: false,
      error: 'INVALID_AUCTION_ID',
    });
    for (let index = 0; index < 50; index += 1) {
      expect(await subscribe(client, newId())).toEqual({ ok: true });
    }
    expect(await subscribe(client, newId())).toEqual({
      ok: false,
      error: 'TOO_MANY_SUBSCRIPTIONS',
    });
  });

  it('time:ping zwraca czas serwera', async () => {
    const client = connect(urlB);
    await connected(client);
    const sentAt = Date.now();
    const { serverTime } = await client.emitWithAck('time:ping');
    expect(Math.abs(Date.parse(serverTime) - (sentAt + Date.now()) / 2)).toBeLessThan(100);
  });
});

describe('koniec aukcji', () => {
  it('Kup teraz: auction.ended u oglądających i user.won u kupującego', async () => {
    const id = await auction({ buyNowPrice: 8_000 });
    const buyer = await createUser(apiA, pool);
    const viewer = connect(urlB);
    await subscribe(viewer, id);
    const ended = collect(viewer, 'auction.ended');
    const buyerSocket = connect(urlA, { user: buyer });
    await connected(buyerSocket);
    const won = collect(buyerSocket, 'user.won');

    const response = await apiB.http.inject({
      method: 'POST',
      url: `/v1/auctions/${id}/buy-now`,
      headers: { origin: WEB_ORIGIN, cookie: buyer.cookie, 'idempotency-key': 'rt-buy' },
    });
    expect(response.statusCode).toBe(201);
    await waitFor(() => ended.length === 1 && won.length === 1, 'koniec i wygrana', 3_000);
    expect(ended[0]).toMatchObject({
      auctionId: id,
      outcome: 'SOLD',
      finalPrice: 8_000,
    } satisfies Partial<AuctionEndedEvent>);
    expect(won[0]).toMatchObject({
      auctionId: id,
      total: 8_000 + 299 + 560,
    } satisfies Partial<UserWonEvent>);
  });

  it('zamknięcie w workerze: auction.ended i user.won docierają przez Redis', async () => {
    const winner = await createUser(apiA, pool);
    const id = await auction({ endsInMs: -1_000, leaderId: winner.id });
    const viewer = connect(urlA);
    await subscribe(viewer, id);
    const ended = collect(viewer, 'auction.ended');
    const updated = collect(viewer, 'auction.updated');
    const winnerSocket = connect(urlB, { user: winner });
    await connected(winnerSocket);
    const won = collect(winnerSocket, 'user.won');

    expect(await worker.app.get(AuctionClosingService).close(id)).toBe('SOLD');
    await waitFor(() => ended.length === 1 && won.length === 1, 'zamknięcie z workera', 3_000);
    expect(updated.at(-1)).toMatchObject({ status: 'ENDED_SOLD', minimumNextBid: null });
    expect(won[0]?.orderPublicId).toMatch(/^[a-z2-9]{8}$/u);
  });
});

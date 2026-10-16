// Kryteria F-20 na prawdziwym Postgresie i Redisie z workerem i Mailpitem (Testcontainers):
// obserwowanie aukcji i sprzedawców, przebicie (in-app od razu, na żywo, e-mail najwyżej raz na
// 15 min na aukcję), deduplikacja przy ponownym dostarczeniu eventu, preferencje i wypisanie
// tokenem, „kończy się za godzinę”, wygrana i sprzedaż, brak sprzedaży, anulowanie, nowa aukcja
// obserwowanego sprzedawcy, lista i oznaczanie jako przeczytane.
import type { NotificationNewEvent, ServerToClientEvents } from '@biddy/realtime';
import type { LightMyRequestResponse } from 'fastify';
import { Pool } from 'pg';
import { io, type Socket } from 'socket.io-client';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId } from '../../src/infra/db/index.js';
import { type DomainEvent } from '../../src/infra/outbox/index.js';
import { REALTIME_PATH } from '../../src/infra/realtime/index.js';
import { AuctionClosingService } from '../../src/modules/auctions/index.js';
import { NotificationSources } from '../../src/modules/notifications/notifications/notification-sources.js';
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

const WEB_URL = 'https://biddy.test';

let database: ScratchDatabase;
let pool: Pool;
let api: TestApp;
let apiUrl: string;
let worker: TestWorker;
let mailpit: StartedTestContainer;
let mailpitApi: string;
let seller: TestUser;
let ipCounter = 0;
const sockets: Socket[] = [];

beforeAll(async () => {
  mailpit = await new GenericContainer('axllent/mailpit:v1.31')
    .withEnvironment({ MP_SMTP_AUTH_ACCEPT_ANY: 'true', MP_SMTP_AUTH_ALLOW_INSECURE: 'true' })
    .withExposedPorts(1025, 8025)
    .withWaitStrategy(Wait.forHttp('/livez', 8025))
    .start();
  mailpitApi = `http://${mailpit.getHost()}:${String(mailpit.getMappedPort(8025))}`;
  database = await createMigratedDatabase();
  pool = new Pool({ connectionString: database.url, max: 8 });
  const shared = {
    DATABASE_URL: database.url,
    REDIS_QUEUE_URL: redisUrl(),
    REDIS_CACHE_URL: redisUrl(),
    QUEUE_PREFIX: uniqueQueuePrefix(),
    TRUST_PROXY: 'loopback',
    CORS_ORIGINS: WEB_ORIGIN,
    WEB_URL,
    SMTP_HOST: mailpit.getHost(),
    SMTP_PORT: String(mailpit.getMappedPort(1025)),
  };
  api = await startTestApp(integrationConfig(shared));
  await api.app.listen(0, '127.0.0.1');
  apiUrl = await api.app.getUrl();
  worker = await startTestWorker(workerConfig(database.url, shared));
  seller = await createUser(api, pool, { name: 'Sprzedawca Testowy' });
}, 120_000);

afterAll(async () => {
  for (const socket of sockets) {
    socket.disconnect();
  }
  await worker.close();
  await api.close();
  await pool.end();
  await database.drop();
  await mailpit.stop();
});

function call(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
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

interface Published {
  readonly id: string;
  readonly publicId: string;
  /** Sprzedający (limit aktywnych aukcji na konto: domyślnie nowe konto na aukcję). */
  readonly owner: TestUser;
}

async function publish(fields: Record<string, unknown> = {}, owner?: TestUser): Promise<Published> {
  const sellerOf = owner ?? (await createUser(api, pool, { name: 'Sprzedawca Testowy' }));
  const created = await call('POST', '/v1/auctions', sellerOf);
  expect(created.statusCode, created.body).toBe(201);
  const { id, publicId } = created.json<Published>();
  const { rows } = await pool.query<{ id: string }>(
    `select id from categories where slug = 'dekoracje'`,
  );
  const patched = await call('PATCH', `/v1/auctions/${id}`, sellerOf, {
    mediaIds: [await readyPhoto(sellerOf)],
    categoryId: rows[0]?.id,
    title: 'Wazon ceramiczny, lata 70.',
    description: 'Ręcznie malowany wazon, bez pęknięć i odprysków. Wysokość 30 cm.',
    condition: 'VERY_GOOD',
    packageSize: 'M',
    allowedCarriers: ['inpost-paczkomat'],
    startPrice: 2_000,
    durationDays: 7,
    ...fields,
  });
  expect(patched.statusCode, patched.body).toBe(200);
  const published = await call('POST', `/v1/auctions/${id}/publish`, sellerOf, {
    kycNoticeAccepted: true,
  });
  expect(published.statusCode, published.body).toBe(200);
  return { id, publicId, owner: sellerOf };
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
      'idempotency-key': `notify-${String(keyCounter)}`,
    },
  );
}

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  url: string;
  read: boolean;
}

async function notificationsOf(
  user: TestUser,
): Promise<{ items: NotificationItem[]; unreadCount: number }> {
  const response = await call('GET', '/v1/me/notifications', user);
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}

async function waitForNotification(
  user: TestUser,
  type: string,
  count = 1,
): Promise<NotificationItem[]> {
  return waitFor(
    async () => {
      const items = (await notificationsOf(user)).items.filter((item) => item.type === type);
      return items.length >= count ? items : undefined;
    },
    `powiadomienie ${type} (${String(count)})`,
    15_000,
  );
}

interface MailpitMessage {
  readonly ID: string;
  readonly Subject: string;
  readonly To: readonly { readonly Address: string }[];
}

async function emailsTo(address: string, subject?: string): Promise<MailpitMessage[]> {
  const response = await fetch(`${mailpitApi}/api/v1/messages?limit=500`);
  const { messages } = (await response.json()) as { messages: MailpitMessage[] };
  return messages.filter(
    (message) =>
      message.To.some((to) => to.Address === address) &&
      (subject === undefined || message.Subject === subject),
  );
}

async function headersOf(id: string): Promise<Record<string, string[]>> {
  const response = await fetch(`${mailpitApi}/api/v1/message/${id}/headers`);
  return (await response.json()) as Record<string, string[]>;
}

async function emailOf(user: TestUser): Promise<string> {
  const { rows } = await pool.query<{ email: string }>('select email from users where id = $1', [
    user.id,
  ]);
  return rows[0]?.email ?? '';
}

function connect(user: TestUser): Socket<ServerToClientEvents> {
  const socket: Socket<ServerToClientEvents> = io(apiUrl, {
    path: REALTIME_PATH,
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: { cookie: user.cookie, origin: WEB_ORIGIN },
  });
  sockets.push(socket);
  return socket;
}

describe('obserwowanie', () => {
  it('aukcja: obserwuj, stan w me/bids, przestań; własna 409, szkic 404', async () => {
    const auction = await publish();
    const anna = await createUser(api, pool, { name: 'Anna' });
    expect((await call('PUT', `/v1/me/watchlist/${auction.id}`, anna)).statusCode).toBe(204);
    expect((await call('PUT', `/v1/me/watchlist/${auction.id}`, anna)).statusCode).toBe(204);
    const watching = await call('GET', `/v1/me/bids/${auction.publicId}`, anna);
    expect(watching.json<{ watching: boolean }>().watching).toBe(true);
    expect((await call('DELETE', `/v1/me/watchlist/${auction.id}`, anna)).statusCode).toBe(204);
    expect(
      (await call('GET', `/v1/me/bids/${auction.publicId}`, anna)).json<{ watching: boolean }>()
        .watching,
    ).toBe(false);

    expect((await call('PUT', `/v1/me/watchlist/${auction.id}`, auction.owner)).statusCode).toBe(
      409,
    );
    const draft = await call('POST', '/v1/auctions', auction.owner);
    const draftId = draft.json<{ id: string }>().id;
    expect((await call('PUT', `/v1/me/watchlist/${draftId}`, anna)).statusCode).toBe(404);
    expect((await call('PUT', `/v1/me/watchlist/${auction.id}`)).statusCode).toBe(401);
  });

  it('sprzedawca: obserwuj, stan, przestań; siebie 400, nieznany 404', async () => {
    const anna = await createUser(api, pool, { name: 'Anna' });
    const url = `/v1/me/followed-sellers/${seller.id}`;
    expect((await call('PUT', url, anna)).statusCode).toBe(204);
    expect((await call('GET', url, anna)).json()).toEqual({ following: true });
    expect((await call('DELETE', url, anna)).statusCode).toBe(204);
    expect((await call('GET', url, anna)).json()).toEqual({ following: false });
    expect((await call('PUT', url, seller)).statusCode).toBe(400);
    expect((await call('PUT', `/v1/me/followed-sellers/${newId()}`, anna)).statusCode).toBe(404);
  });
});

describe('przebicie', () => {
  it('in-app od razu i na żywo, e-mail z wypisaniem; kolejne przebicie w 15 min bez e-maila', async () => {
    const auction = await publish();
    const anna = await createUser(api, pool, { name: 'Anna Licytująca' });
    const bartek = await createUser(api, pool, { name: 'Bartek' });
    const socket = connect(anna);
    const live: NotificationNewEvent[] = [];
    socket.on('notification.new', (event) => {
      live.push(event);
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });

    expect((await bid(anna, auction.id, 3_000)).statusCode).toBe(201);
    expect((await bid(bartek, auction.id, 5_000)).statusCode).toBe(201);
    const [outbid] = await waitForNotification(anna, 'OUTBID');
    expect(outbid).toMatchObject({
      title: 'Przebito Twoją ofertę',
      url: `/a/wazon-ceramiczny-lata-70-${auction.publicId}`,
      read: false,
    });
    expect(outbid?.body).toContain('aktualna cena 31');
    await waitFor(() => live.length > 0, 'notification.new przez Socket.IO', 5_000);
    expect(live[0]).toMatchObject({ id: outbid?.id, type: 'OUTBID', unreadCount: 1 });

    const address = await emailOf(anna);
    const [email] = await waitFor(
      async () => {
        const found = await emailsTo(address, 'Przebito Twoją ofertę');
        return found.length > 0 ? found : undefined;
      },
      'e-mail o przebiciu',
      15_000,
    );
    const headers = await headersOf(email?.ID ?? '');
    expect(headers['List-Unsubscribe']?.[0]).toMatch(
      /^<https:\/\/biddy\.test\/api\/wypisz\?token=[\w-]+\.[\w-]+>$/u,
    );
    expect(headers['List-Unsubscribe-Post']).toEqual(['List-Unsubscribe=One-Click']);

    // Drugie przebicie w tej samej aukcji: in-app tak, e-mail nie (limit 15 min).
    expect((await bid(anna, auction.id, 6_000)).statusCode).toBe(201);
    expect((await bid(bartek, auction.id, 8_000)).statusCode).toBe(201);
    await waitForNotification(anna, 'OUTBID', 2);
    await waitFor(
      async () =>
        (
          await pool.query(
            `select 1 from processed_events where consumer = 'notifications.deliver'`,
          )
        ).rowCount ?? 0,
      'dostarczenie powiadomień',
      5_000,
    );
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(await emailsTo(address, 'Przebito Twoją ofertę')).toHaveLength(1);
    expect((await notificationsOf(anna)).unreadCount).toBe(2);
  });

  it('ponowne dostarczenie eventu nie tworzy drugiego powiadomienia', async () => {
    const { rows } = await pool.query<{
      id: string;
      aggregate_id: string;
      payload: Record<string, unknown>;
      occurred_at: Date;
    }>(`select * from outbox where type = 'UserOutbid' order by occurred_at limit 1`);
    const row = rows[0];
    expect(row).toBeDefined();
    const event = {
      id: row?.id ?? '',
      type: 'UserOutbid',
      version: 1,
      aggregateType: 'auction',
      aggregateId: row?.aggregate_id ?? '',
      occurredAt: row?.occurred_at.toISOString() ?? '',
      payload: row?.payload,
    } as unknown as DomainEvent<
      { userId: string; currentPrice: { amount: number; currency: 'PLN' }; endsAt: string },
      'UserOutbid'
    >;
    const sources = worker.app.get(NotificationSources);
    const count = async () =>
      (
        await pool.query(`select count(*)::int as n from notifications where dedupe_key = $1`, [
          `OUTBID:${event.id}`,
        ])
      ).rows[0] as { n: number };
    const before = await count();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const client = await pool.connect();
      try {
        const { drizzle } = await import('drizzle-orm/node-postgres');
        const db = drizzle(client, { casing: 'snake_case' });
        await db.transaction(async (tx) => {
          await sources.onOutbid(event, { tx, attempt: 1 });
        });
      } finally {
        client.release();
      }
    }
    expect(await count()).toEqual(before);
    expect(before.n).toBe(1);
  });
});

describe('preferencje i wypisanie', () => {
  it('wyłączony e-mail: in-app tak, e-mail nie; transakcyjnych nie da się wyłączyć', async () => {
    const auction = await publish();
    const anna = await createUser(api, pool, { name: 'Anna Bez Maili' });
    const bartek = await createUser(api, pool, { name: 'Bartek' });
    const updated = await call('PUT', '/v1/me/notification-preferences', anna, {
      items: [{ type: 'OUTBID', channel: 'EMAIL', enabled: false }],
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(
      updated
        .json<{ items: { type: string; channel: string; enabled: boolean }[] }>()
        .items.find((item) => item.type === 'OUTBID' && item.channel === 'EMAIL')?.enabled,
    ).toBe(false);
    const forbidden = await call('PUT', '/v1/me/notification-preferences', anna, {
      items: [{ type: 'WON', channel: 'EMAIL', enabled: false }],
    });
    expect(forbidden.statusCode).toBe(400);
    expect(problemOf(forbidden).detail).toBe('Tego powiadomienia nie można wyłączyć.');

    expect((await bid(anna, auction.id, 3_000)).statusCode).toBe(201);
    expect((await bid(bartek, auction.id, 5_000)).statusCode).toBe(201);
    await waitForNotification(anna, 'OUTBID');
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(await emailsTo(await emailOf(anna), 'Przebito Twoją ofertę')).toHaveLength(0);
  });

  it('wypisanie tokenem z e-maila: podgląd i POST; zły token 400', async () => {
    const auction = await publish();
    const anna = await createUser(api, pool, { name: 'Anna Wypisuje' });
    const bartek = await createUser(api, pool, { name: 'Bartek' });
    await bid(anna, auction.id, 3_000);
    await bid(bartek, auction.id, 5_000);
    const address = await emailOf(anna);
    const [email] = await waitFor(
      async () => {
        const found = await emailsTo(address, 'Przebito Twoją ofertę');
        return found.length > 0 ? found : undefined;
      },
      'e-mail o przebiciu',
      15_000,
    );
    const header = (await headersOf(email?.ID ?? ''))['List-Unsubscribe']?.[0] ?? '';
    const token = new URL(header.slice(1, -1)).searchParams.get('token') ?? '';

    const preview = await call('GET', `/v1/notifications/unsubscribe?token=${token}`);
    expect(preview.json()).toEqual({ scope: 'OUTBID', types: ['OUTBID'] });
    // Bez sesji i bez Origin, jak klient poczty (przez web).
    const done = await api.http.inject({
      method: 'POST',
      url: '/v1/notifications/unsubscribe',
      payload: { token },
    });
    expect(done.statusCode, done.body).toBe(200);
    const preferences = await call('GET', '/v1/me/notification-preferences', anna);
    expect(
      preferences
        .json<{ items: { type: string; channel: string; enabled: boolean }[] }>()
        .items.find((item) => item.type === 'OUTBID' && item.channel === 'EMAIL')?.enabled,
    ).toBe(false);
    expect(
      (await call('POST', '/v1/notifications/unsubscribe', undefined, { token: `${token}x` }))
        .statusCode,
    ).toBe(400);
  });
});

describe('źródła powiadomień', () => {
  it('kończy się za godzinę: obserwujący i licytujący, bez sprzedającego i bez duplikatów', async () => {
    const auction = await publish();
    const watcher = await createUser(api, pool, { name: 'Obserwujący' });
    const bidder = await createUser(api, pool, { name: 'Licytujący' });
    await call('PUT', `/v1/me/watchlist/${auction.id}`, watcher);
    await bid(bidder, auction.id, 3_000);
    await pool.query(`update auctions set ends_at = now() + interval '30 minutes' where id = $1`, [
      auction.id,
    ]);
    const sources = worker.app.get(NotificationSources);
    const job = { data: { auctionId: auction.id } } as Parameters<typeof sources.endingSoon>[0];
    expect(await sources.endingSoon(job)).toBe(2);
    expect(await sources.endingSoon(job)).toBe(0);
    await waitForNotification(watcher, 'ENDING_SOON');
    const [ending] = await waitForNotification(bidder, 'ENDING_SOON');
    expect(ending?.title).toBe('Aukcja kończy się za godzinę');
    expect(
      (await notificationsOf(auction.owner)).items.some((item) => item.type === 'ENDING_SOON'),
    ).toBe(false);
  });

  it('Kup teraz: wygrana i sprzedaż (e-mail transakcyjny bez wypisania)', async () => {
    const auction = await publish({ buyNowPrice: 10_000 });
    const buyer = await createUser(api, pool, { name: 'Kupujący' });
    keyCounter += 1;
    const bought = await call('POST', `/v1/auctions/${auction.id}/buy-now`, buyer, undefined, {
      'idempotency-key': `notify-${String(keyCounter)}`,
    });
    expect(bought.statusCode, bought.body).toBe(201);
    const [won] = await waitForNotification(buyer, 'WON');
    expect(won?.title).toBe('Wygrana: Wazon ceramiczny, lata 70.');
    expect(won?.body).toContain('Do zapłaty z Pakietem Ochrony Kupujących');
    await waitForNotification(auction.owner, 'SOLD');
    const address = await emailOf(buyer);
    const [email] = await waitFor(
      async () => {
        const found = await emailsTo(address, 'Wygrana: Wazon ceramiczny, lata 70.');
        return found.length > 0 ? found : undefined;
      },
      'e-mail o wygranej',
      15_000,
    );
    expect((await headersOf(email?.ID ?? ''))['List-Unsubscribe']).toBeUndefined();
  });

  it('brak sprzedaży, anulowanie i nowa aukcja obserwowanego sprzedawcy', async () => {
    const follower = await createUser(api, pool, { name: 'Fan Sprzedawcy' });
    await call('PUT', `/v1/me/followed-sellers/${seller.id}`, follower);
    const unsold = await publish({}, seller);
    const [newAuction] = await waitForNotification(follower, 'FOLLOWED_SELLER_NEW_AUCTION');
    expect(newAuction?.title).toBe('Nowa aukcja: Sprzedawca Testowy');
    // E-mail o nowej aukcji obserwowanego sprzedawcy jest domyślnie wyłączony.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(await emailsTo(await emailOf(follower), 'Nowa aukcja: Sprzedawca Testowy')).toHaveLength(
      0,
    );

    await pool.query(`update auctions set ends_at = now() - interval '1 second' where id = $1`, [
      unsold.id,
    ]);
    await worker.app.get(AuctionClosingService).close(unsold.id);
    const unsoldNotifications = await waitForNotification(seller, 'UNSOLD');
    expect(unsoldNotifications[0]?.body).toContain('aukcja nie dostała ofert');

    const cancelled = await publish();
    const watcher = await createUser(api, pool, { name: 'Obserwujący' });
    await call('PUT', `/v1/me/watchlist/${cancelled.id}`, watcher);
    const cancel = await call('POST', `/v1/auctions/${cancelled.id}/cancel`, cancelled.owner, {});
    expect(cancel.statusCode, cancel.body).toBe(200);
    const [cancelledNotification] = await waitForNotification(watcher, 'AUCTION_CANCELLED');
    expect(cancelledNotification?.body).toContain('została anulowana przez sprzedającego');
  });
});

describe('centrum powiadomień', () => {
  it('liczba nieprzeczytanych, oznaczanie wybranych i wszystkich', async () => {
    const auction = await publish();
    const anna = await createUser(api, pool, { name: 'Anna' });
    await call('PUT', `/v1/me/watchlist/${auction.id}`, anna);
    await bid(anna, auction.id, 3_000);
    const bartek = await createUser(api, pool, { name: 'Bartek' });
    await bid(bartek, auction.id, 5_000);
    await call('PUT', `/v1/me/followed-sellers/${seller.id}`, anna);
    await publish({}, seller);
    await waitForNotification(anna, 'OUTBID');
    await waitForNotification(anna, 'FOLLOWED_SELLER_NEW_AUCTION');
    const summary = await call('GET', '/v1/me/notifications/summary', anna);
    expect(summary.json()).toEqual({ unreadCount: 2 });
    const first = (await notificationsOf(anna)).items[0];
    const one = await call('POST', '/v1/me/notifications/read', anna, { ids: [first?.id] });
    expect(one.json()).toEqual({ unreadCount: 1 });
    const all = await call('POST', '/v1/me/notifications/read', anna, { all: true });
    expect(all.json()).toEqual({ unreadCount: 0 });
    expect((await notificationsOf(anna)).items.every((item) => item.read)).toBe(true);
    expect((await call('POST', '/v1/me/notifications/read', anna, {})).statusCode).toBe(400);
    expect((await call('GET', '/v1/me/notifications')).statusCode).toBe(401);
  });
});

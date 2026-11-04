// Kryteria F-29 na prawdziwym Postgresie, Redisie i magazynie S3 z workerem (konsument powiadomień):
// pytanie o aktywną aukcję i odpowiedź na żywo, ta sama rozmowa po zakupie, flagi danych
// kontaktowych, blokady w obie strony, limity, prywatne zdjęcia, wgląd personelu przy sporze,
// powiadomienie o nieprzeczytanych (raz na serię) i zgłoszenie z migawką.
import { PutObjectCommand } from '@aws-sdk/client-s3';
import type { ServerToClientEvents } from '@biddy/realtime';
import type { LightMyRequestResponse } from 'fastify';
import { Pool } from 'pg';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId } from '../../src/infra/db/index.js';
import { REALTIME_PATH } from '../../src/infra/realtime/index.js';
import { MessagingService } from '../../src/modules/messaging/index.js';
import { UnreadNotifier } from '../../src/modules/messaging/application/unread-notifier.js';
import { createUser, type TestUser, WEB_ORIGIN } from './support/accounts.js';
import { integrationConfig, problemOf, startTestApp, type TestApp } from './support/app.js';
import type { ScratchDatabase } from './support/database.js';
import { startS3, type TestS3, UPLOADS_BUCKET } from './support/s3.js';
import {
  createMigratedDatabase,
  redisUrl,
  startTestWorker,
  type TestWorker,
  uniqueQueuePrefix,
  waitFor,
  workerConfig,
} from './support/worker.js';

const MINUTE = 60_000;

let database: ScratchDatabase;
let pool: Pool;
let s3: TestS3;
let api: TestApp;
let apiUrl: string;
let worker: TestWorker;
let staff: TestUser;
let ipCounter = 0;
const sockets: Socket[] = [];

beforeAll(async () => {
  s3 = await startS3();
  database = await createMigratedDatabase();
  pool = new Pool({ connectionString: database.url, max: 8 });
  const shared = {
    DATABASE_URL: database.url,
    REDIS_QUEUE_URL: redisUrl(),
    REDIS_CACHE_URL: redisUrl(),
    QUEUE_PREFIX: uniqueQueuePrefix(),
    TRUST_PROXY: 'loopback',
    CORS_ORIGINS: WEB_ORIGIN,
    ...s3.env,
  };
  api = await startTestApp(integrationConfig(shared));
  await api.app.listen(0, '127.0.0.1');
  apiUrl = await api.app.getUrl();
  worker = await startTestWorker(workerConfig(database.url, shared));
  staff = await createUser(api, pool, { name: 'Moderator Rozmów' });
  await pool.query(`update users set staff_role = 'moderator' where id = $1`, [staff.id]);
}, 180_000);

afterAll(async () => {
  for (const socket of sockets) {
    socket.disconnect();
  }
  await worker.close();
  await api.close();
  await pool.end();
  await database.drop();
  await s3.stop();
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

async function readyPhoto(owner: TestUser, purpose = 'ITEM_PHOTO'): Promise<string> {
  const id = newId();
  await pool.query(
    `insert into media (id, owner_id, purpose, status, content_type, size_bytes, width, height)
     values ($1, $2, $3, 'READY', 'image/jpeg', 1000, 1600, 1200)`,
    [id, owner.id, purpose],
  );
  return id;
}

/** Zdjęcie w wiadomości: rekord READY i warianty w prywatnym kubełku (jak po przetworzeniu). */
async function messagePhoto(owner: TestUser): Promise<string> {
  const id = await readyPhoto(owner, 'MESSAGE_PHOTO');
  for (const variant of ['thumb', 'large']) {
    await s3.client.send(
      new PutObjectCommand({
        Bucket: UPLOADS_BUCKET,
        Key: `messages/${id}/${variant}.webp`,
        Body: Buffer.from(`webp-${variant}`),
        ContentType: 'image/webp',
      }),
    );
  }
  return id;
}

interface Auction {
  readonly id: string;
  readonly publicId: string;
  readonly seller: TestUser;
}

/** Aktywna aukcja nowego sprzedającego (z Kup teraz 120 zł). */
async function publish(name = 'Sprzedawca Rozmów'): Promise<Auction> {
  const seller = await createUser(api, pool, { name });
  const created = await call('POST', '/v1/auctions', seller);
  expect(created.statusCode, created.body).toBe(201);
  const { id, publicId } = created.json<{ id: string; publicId: string }>();
  const { rows } = await pool.query<{ id: string }>(
    `select id from categories where slug = 'dekoracje'`,
  );
  const patched = await call('PATCH', `/v1/auctions/${id}`, seller, {
    mediaIds: [await readyPhoto(seller)],
    categoryId: rows[0]?.id,
    title: 'Lampa biurkowa, lata 60.',
    description: 'Mosiężna lampa biurkowa, działa, nowy przewód. Wysokość 40 cm.',
    condition: 'VERY_GOOD',
    packageSize: 'M',
    allowedCarriers: ['inpost-paczkomat'],
    startPrice: 2_000,
    buyNowPrice: 12_000,
    durationDays: 7,
  });
  expect(patched.statusCode, patched.body).toBe(200);
  const published = await call('POST', `/v1/auctions/${id}/publish`, seller, {
    kycNoticeAccepted: true,
  });
  expect(published.statusCode, published.body).toBe(200);
  return { id, publicId, seller };
}

/** Kup teraz: zamówienie AWAITING_PAYMENT; zwraca numer zamówienia. */
async function buyNow(auction: Auction, buyer: TestUser): Promise<string> {
  const bought = await call('POST', `/v1/auctions/${auction.id}/buy-now`, buyer, undefined, {
    'idempotency-key': `chat-${newId()}`,
  });
  expect(bought.statusCode, bought.body).toBe(201);
  const { rows } = await pool.query<{ public_id: string }>(
    `select o.public_id from orders o join order_items i on i.order_id = o.id
     where i.auction_id = $1 and i.is_active`,
    [auction.id],
  );
  return rows[0]?.public_id ?? '';
}

interface Conversation {
  readonly id: string;
  readonly role: string;
  readonly counterpart: { readonly id: string; readonly name: string; readonly available: boolean };
  readonly auction: { readonly id: string; readonly title: string } | null;
  readonly order: { readonly publicId: string; readonly status: string } | null;
  readonly lastMessage: { readonly preview: string; readonly senderRole: string } | null;
  readonly unreadCount: number;
  readonly canSend: boolean;
  readonly blockedByMe: boolean;
}

interface Message {
  readonly id: string;
  readonly senderRole: string;
  readonly body: string;
  readonly photos: readonly { readonly id: string; readonly thumbUrl: string }[];
  readonly contactFlags: readonly string[];
  readonly readAt: string | null;
}

async function ask(auction: Auction, asker: TestUser, body: string): Promise<Conversation> {
  const response = await call('POST', '/v1/conversations', asker, { auctionId: auction.id, body });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<Conversation>();
}

async function send(
  conversationId: string,
  user: TestUser,
  body: string,
  mediaIds: string[] = [],
): Promise<Message> {
  const response = await call('POST', `/v1/conversations/${conversationId}/messages`, user, {
    body,
    mediaIds,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<Message>();
}

async function messagesOf(conversationId: string, user: TestUser): Promise<Message[]> {
  const response = await call('GET', `/v1/conversations/${conversationId}/messages`, user);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ items: Message[] }>().items;
}

describe('rozmowa o aukcji', () => {
  it('pytanie, odpowiedź na żywo, liczniki, odczyt i 404 dla obcych', async () => {
    const auction = await publish('Anna Sprzedająca');
    const asker = await createUser(api, pool, { name: 'Jan Pytający' });
    const stranger = await createUser(api, pool, { name: 'Obcy' });
    const sellerSocket = connect(auction.seller);
    const askerSocket = connect(asker);
    const sellerEvents: { conversationId: string; unreadCount: number }[] = [];
    const askerReads: string[] = [];
    sellerSocket.on('message.new', (event) => sellerEvents.push(event));
    askerSocket.on('conversation.read', (event) => askerReads.push(event.conversationId));
    await waitFor(() => sellerSocket.connected && askerSocket.connected, 'połączenia');

    const start = await call('GET', `/v1/conversations/start?auctionId=${auction.id}`, asker);
    expect(start.statusCode, start.body).toBe(200);
    expect(start.json()).toMatchObject({
      conversationId: null,
      role: 'BUYER',
      counterpart: { id: auction.seller.id, name: 'Anna Sprzedająca', available: true },
      auction: { id: auction.id, title: 'Lampa biurkowa, lata 60.', status: 'ACTIVE' },
      order: null,
      unavailableReason: null,
      canSend: true,
    });

    const conversation = await ask(auction, asker, '  Czy klosz ma rysy?  ');
    expect(conversation).toMatchObject({
      role: 'BUYER',
      unreadCount: 0,
      canSend: true,
      lastMessage: { preview: 'Czy klosz ma rysy?', senderRole: 'BUYER' },
    });
    await waitFor(() => sellerEvents.length === 1, 'message.new u sprzedającego');
    expect(sellerEvents[0]).toMatchObject({ conversationId: conversation.id, unreadCount: 1 });

    const list = await call('GET', '/v1/conversations', auction.seller);
    expect(list.json()).toMatchObject({
      items: [
        {
          id: conversation.id,
          role: 'SELLER',
          counterpart: { id: asker.id, name: 'Jan Pytający' },
          unreadCount: 1,
        },
      ],
      nextBefore: null,
    });
    expect((await call('GET', '/v1/conversations/summary', auction.seller)).json()).toEqual({
      unreadCount: 1,
    });

    const read = await call('POST', `/v1/conversations/${conversation.id}/read`, auction.seller);
    expect(read.json()).toEqual({ unreadCount: 0 });
    await waitFor(() => askerReads.includes(conversation.id), 'conversation.read u pytającego');

    await send(conversation.id, auction.seller, 'Nie ma rys, klosz jest cały.');
    const messages = await messagesOf(conversation.id, asker);
    expect(messages.map((message) => [message.senderRole, message.body])).toEqual([
      ['SELLER', 'Nie ma rys, klosz jest cały.'],
      ['BUYER', 'Czy klosz ma rysy?'],
    ]);
    expect(messages[0]?.readAt).toBeNull();
    expect(messages[1]?.readAt).not.toBeNull();

    // Ponowne pytanie o tę samą aukcję trafia do tej samej rozmowy.
    const again = await ask(auction, asker, 'A jaka jest długość przewodu?');
    expect(again.id).toBe(conversation.id);
    expect(
      (await call('GET', `/v1/conversations/start?auctionId=${auction.id}`, asker)).json(),
    ).toMatchObject({ conversationId: conversation.id });

    for (const [method, url] of [
      ['GET', `/v1/conversations/${conversation.id}`],
      ['GET', `/v1/conversations/${conversation.id}/messages`],
      ['POST', `/v1/conversations/${conversation.id}/read`],
    ] as const) {
      expect((await call(method, url, stranger)).statusCode, url).toBe(404);
    }
    const foreign = await call('POST', `/v1/conversations/${conversation.id}/messages`, stranger, {
      body: 'Hej',
    });
    expect(foreign.statusCode).toBe(404);
    expect((await call('GET', '/v1/conversations', stranger)).json()).toEqual({
      items: [],
      nextBefore: null,
    });

    const own = await call('POST', '/v1/conversations', auction.seller, {
      auctionId: auction.id,
      body: 'Test',
    });
    expect(own.statusCode).toBe(409);
    expect(problemOf(own)).toMatchObject({
      code: 'CONVERSATION_UNAVAILABLE',
      reason: 'OWN_AUCTION',
    });
  });

  it('po zakupie ta sama rozmowa z zamówieniem; zakończona aukcja bez zamówienia: 409', async () => {
    const auction = await publish();
    const buyer = await createUser(api, pool, { name: 'Kupująca Ewa' });
    const late = await createUser(api, pool);
    const conversation = await ask(auction, buyer, 'Czy wyślesz w poniedziałek?');
    const publicId = await buyNow(auction, buyer);

    const fromOrder = await call('POST', '/v1/conversations', buyer, {
      orderId: publicId,
      body: 'Kupione, dziękuję!',
    });
    expect(fromOrder.statusCode, fromOrder.body).toBe(201);
    expect(fromOrder.json()).toMatchObject({
      id: conversation.id,
      order: { publicId, status: 'AWAITING_PAYMENT' },
    });
    const sellerReply = await call('POST', '/v1/conversations', auction.seller, {
      orderId: publicId,
      body: 'Dziękuję, wyślę po opłaceniu.',
    });
    expect(sellerReply.json()).toMatchObject({ id: conversation.id, role: 'SELLER' });

    const closed = await call('GET', `/v1/conversations/start?auctionId=${auction.id}`, late);
    expect(closed.json()).toMatchObject({
      conversationId: null,
      unavailableReason: 'AUCTION_CLOSED',
      canSend: false,
    });
    const rejected = await call('POST', '/v1/conversations', late, {
      auctionId: auction.id,
      body: 'Czy jest jeszcze dostępne?',
    });
    expect(rejected.statusCode).toBe(409);
    expect(problemOf(rejected).code).toBe('CONVERSATION_UNAVAILABLE');
    expect(
      (await call('GET', `/v1/conversations/start?orderId=${publicId}`, late)).statusCode,
    ).toBe(404);
  });

  it('pisanie wymaga akceptacji regulaminu', async () => {
    const auction = await publish();
    const user = await createUser(api, pool);
    await pool.query('update users set is_adult_declared_at = null where id = $1', [user.id]);
    const response = await call('POST', '/v1/conversations', user, {
      auctionId: auction.id,
      body: 'Pytanie',
    });
    expect(response.statusCode).toBe(403);
    expect(problemOf(response).code).toBe('TERMS_NOT_ACCEPTED');
  });
});

describe('dane kontaktowe', () => {
  it('wiadomość z telefonem i e-mailem ma flagi widoczne dla obu stron', async () => {
    const auction = await publish();
    const asker = await createUser(api, pool);
    const conversation = await ask(auction, asker, 'Dzień dobry, czy da się odebrać osobiście?');
    const flagged = await send(
      conversation.id,
      auction.seller,
      'Tak, zadzwoń: 600 700 800 albo napisz na anna małpa wp kropka pl',
    );
    expect(flagged.contactFlags).toEqual(['PHONE', 'EMAIL']);
    const seen = await messagesOf(conversation.id, asker);
    expect(seen[0]).toMatchObject({ id: flagged.id, contactFlags: ['PHONE', 'EMAIL'] });
    expect(seen[1]?.contactFlags).toEqual([]);
    expect(await api.app.get(MessagingService).flaggedCount(auction.seller.id)).toBe(1);
  });
});

describe('blokady', () => {
  it('blokada w dowolną stronę wyłącza pisanie, odblokowanie przywraca', async () => {
    const auction = await publish('Blokujący Sprzedawca');
    const asker = await createUser(api, pool, { name: 'Natręt' });
    const conversation = await ask(auction, asker, 'Halo?');

    const blocked = await call('PUT', `/v1/me/blocks/${asker.id}`, auction.seller);
    expect(blocked.statusCode).toBe(204);
    expect((await call('PUT', `/v1/me/blocks/${asker.id}`, auction.seller)).statusCode).toBe(204);
    expect((await call('GET', '/v1/me/blocks', auction.seller)).json()).toMatchObject({
      items: [{ userId: asker.id, name: 'Natręt' }],
    });

    for (const [user, detail] of [
      [asker, 'Nie możesz pisać w tej rozmowie.'],
      [auction.seller, 'Zablokowano tę osobę. Odblokuj ją, żeby napisać.'],
    ] as const) {
      const response = await call('POST', `/v1/conversations/${conversation.id}/messages`, user, {
        body: 'Wiadomość',
      });
      expect(response.statusCode).toBe(403);
      expect(problemOf(response)).toMatchObject({ code: 'CONVERSATION_BLOCKED', detail });
    }
    expect((await call('GET', `/v1/conversations/${conversation.id}`, asker)).json()).toMatchObject(
      { canSend: false, blockedByMe: false },
    );
    expect(
      (await call('GET', `/v1/conversations/${conversation.id}`, auction.seller)).json(),
    ).toMatchObject({ canSend: false, blockedByMe: true });

    expect((await call('DELETE', `/v1/me/blocks/${asker.id}`, auction.seller)).statusCode).toBe(
      204,
    );
    await send(conversation.id, asker, 'Przepraszam za natarczywość.');

    expect((await call('PUT', `/v1/me/blocks/${asker.id}`, asker)).statusCode).toBe(400);
    expect((await call('PUT', `/v1/me/blocks/${newId()}`, asker)).statusCode).toBe(404);
  });
});

describe('limity', () => {
  it('11. wiadomość w minucie: 429 z Retry-After', async () => {
    const auction = await publish();
    const chatty = await createUser(api, pool);
    const conversation = await ask(auction, chatty, 'Wiadomość 1');
    for (let index = 2; index <= 10; index += 1) {
      await send(conversation.id, chatty, `Wiadomość ${String(index)}`);
    }
    const limited = await call('POST', `/v1/conversations/${conversation.id}/messages`, chatty, {
      body: 'Wiadomość 11',
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    expect(problemOf(limited).code).toBe('RATE_LIMITED');
  });
});

describe('zdjęcia i wgląd personelu', () => {
  it('zdjęcia tylko dla stron; personel czyta rozmowę i zdjęcia tylko przy sporze', async () => {
    const auction = await publish();
    const buyer = await createUser(api, pool);
    const stranger = await createUser(api, pool);
    const publicId = await buyNow(auction, buyer);
    const photo = await messagePhoto(buyer);
    const started = await call('POST', '/v1/conversations', buyer, {
      orderId: publicId,
      body: '',
      mediaIds: [photo],
    });
    expect(started.statusCode, started.body).toBe(201);
    const conversationId = started.json<Conversation>().id;
    const [message] = await messagesOf(conversationId, auction.seller);
    expect(message?.photos[0]?.thumbUrl).toMatch(
      new RegExp(`/v1/conversations/${conversationId}/photos/${photo}/thumb$`, 'u'),
    );

    const url = `/v1/conversations/${conversationId}/photos/${photo}/large`;
    const seen = await call('GET', url, auction.seller);
    expect(seen.statusCode).toBe(200);
    expect(seen.headers['content-type']).toBe('image/webp');
    expect(seen.body).toBe('webp-large');
    expect((await call('GET', url, stranger)).statusCode).toBe(404);
    expect((await call('GET', url, staff)).statusCode).toBe(404);

    const adminUrl = `/v1/admin/orders/${publicId}/messages`;
    expect((await call('GET', adminUrl, staff)).statusCode).toBe(404);
    expect((await call('GET', adminUrl, buyer)).statusCode).toBe(403);
    await pool.query('update orders set disputed_at = now() where public_id = $1', [publicId]);
    const view = await call('GET', adminUrl, staff);
    expect(view.statusCode, view.body).toBe(200);
    expect(view.json()).toMatchObject({
      conversationId,
      buyer: { id: buyer.id },
      seller: { id: auction.seller.id },
      messages: [{ senderRole: 'BUYER', body: '', photos: [{ id: photo }] }],
    });
    expect((await call('GET', url, staff)).statusCode).toBe(200);

    // Zdjęcie z innym przeznaczeniem nie trafi do wiadomości.
    const wrong = await call('POST', `/v1/conversations/${conversationId}/messages`, buyer, {
      body: 'Dowód',
      mediaIds: [await readyPhoto(buyer, 'DISPUTE_EVIDENCE')],
    });
    expect(wrong.statusCode).toBe(400);
  });
});

describe('powiadomienia o nieprzeczytanych', () => {
  it('jedno powiadomienie na serię; przeczytane wcześniej bez powiadomienia', async () => {
    const auction = await publish();
    const asker = await createUser(api, pool, { name: 'Ola Pytająca' });
    const reader = await createUser(api, pool);
    const notifier = api.app.get(UnreadNotifier);
    const conversation = await ask(auction, asker, 'Pierwsze pytanie');
    await send(conversation.id, asker, 'Drugie pytanie');

    const now = Date.now();
    await notifier.notifyUnread(new Date(now + 2 * MINUTE));
    const newMessage = async (user: TestUser) =>
      Number(
        (
          await pool.query<{ count: string }>(
            `select count(*) from notifications where user_id = $1 and type = 'NEW_MESSAGE'`,
            [user.id],
          )
        ).rows[0]?.count ?? 0,
      );
    expect(await newMessage(auction.seller)).toBe(0);

    await notifier.notifyUnread(new Date(now + 6 * MINUTE));
    await waitFor(async () => (await newMessage(auction.seller)) === 1, 'NEW_MESSAGE');
    const { rows } = await pool.query<{ payload: { message: Record<string, unknown> } }>(
      `select payload from notifications where user_id = $1 and type = 'NEW_MESSAGE'`,
      [auction.seller.id],
    );
    expect(rows[0]?.payload.message).toEqual({
      conversationId: conversation.id,
      senderName: 'Ola Pytająca',
      title: 'Lampa biurkowa, lata 60.',
      count: 2,
    });

    // Kolejna wiadomość w tej samej nieprzeczytanej serii nie daje drugiego powiadomienia.
    await send(conversation.id, asker, 'Trzecie pytanie');
    await notifier.notifyUnread(new Date(now + 12 * MINUTE));
    await call('POST', `/v1/conversations/${conversation.id}/read`, auction.seller);
    await send(conversation.id, asker, 'Czwarte, po odczycie');
    await notifier.notifyUnread(new Date(now + 18 * MINUTE));
    await waitFor(async () => (await newMessage(auction.seller)) === 2, 'druga seria');

    // Wiadomości przeczytane w ciągu 5 minut nie dają powiadomienia.
    const otherAuction = await publish();
    const other = await ask(otherAuction, reader, 'Pytanie');
    await send(other.id, reader, 'Dopisek');
    await call('POST', `/v1/conversations/${other.id}/read`, otherAuction.seller);
    await notifier.notifyUnread(new Date(now + 24 * MINUTE));
    const { rows: unnotified } = await pool.query(
      'select 1 from messages where conversation_id = $1 and notified_at is null',
      [other.id],
    );
    expect(unnotified).toHaveLength(2);
  });
});

describe('zgłoszenia', () => {
  it('zgłoszenie wiadomości z migawką, blokadą i eventem; ponowienie zwraca to samo', async () => {
    const auction = await publish();
    const scammer = await createUser(api, pool, { name: 'Oszust' });
    const conversation = await ask(auction, scammer, 'Czy aktualne?');
    const offending = await send(
      conversation.id,
      scammer,
      'Zapłacę przelewem na 61 1090 1014 0000 0712 1981 2874, bez Biddy taniej',
    );

    const reported = await call(
      'POST',
      `/v1/conversations/${conversation.id}/report`,
      auction.seller,
      { reason: 'OFF_PLATFORM', messageId: offending.id, block: true },
    );
    expect(reported.statusCode, reported.body).toBe(201);
    const { id, blocked } = reported.json<{ id: string; blocked: boolean }>();
    expect(blocked).toBe(true);
    const { rows } = await pool.query<{
      target_type: string;
      target_id: string;
      reason: string;
      status: string;
      context: { reportedUserId: string; messages: { id: string; contactFlags: string[] }[] };
    }>('select * from reports where id = $1', [id]);
    expect(rows[0]).toMatchObject({
      target_type: 'MESSAGE',
      target_id: offending.id,
      reason: 'OFF_PLATFORM',
      status: 'OPEN',
      context: { reportedUserId: scammer.id },
    });
    expect(rows[0]?.context.messages.map((message) => message.id).at(-1)).toBe(offending.id);
    expect(rows[0]?.context.messages.at(-1)?.contactFlags).toEqual(['IBAN']);
    const { rows: events } = await pool.query(
      `select 1 from outbox where type = 'ReportCreated' and aggregate_id = $1`,
      [id],
    );
    expect(events).toHaveLength(1);
    expect(
      (
        await call('POST', `/v1/conversations/${conversation.id}/messages`, scammer, {
          body: 'Hej',
        })
      ).statusCode,
    ).toBe(403);

    const again = await call(
      'POST',
      `/v1/conversations/${conversation.id}/report`,
      auction.seller,
      {
        reason: 'SCAM',
        messageId: offending.id,
      },
    );
    expect(again.json()).toMatchObject({ id });

    const own = await call('POST', `/v1/conversations/${conversation.id}/report`, scammer, {
      reason: 'SPAM',
      messageId: offending.id,
    });
    expect(own.statusCode).toBe(400);
    const vague = await call('POST', `/v1/conversations/${conversation.id}/report`, scammer, {
      reason: 'OTHER',
    });
    expect(vague.statusCode).toBe(400);
  });
});

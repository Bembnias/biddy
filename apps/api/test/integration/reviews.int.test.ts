// Kryteria F-30 na prawdziwym Postgresie i Redisie z workerem (konsument powiadomień): ocena po
// zakończonym zamówieniu i po zwrocie ze sporem, ukrycie do ujawnienia, druga ocena odsłania obie,
// ujawnienie po 7 dniach przez job, brak oceny po ujawnieniu oceny drugiej strony, walidacja
// komentarza, reputacja i lista publiczna, powiadomienia REVIEW_REQUESTED i REVIEW_RECEIVED.
import type { LightMyRequestResponse } from 'fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId } from '../../src/infra/db/index.js';
import { ReviewPublisher } from '../../src/modules/reviews/application/review-publisher.js';
import { createUser, type TestUser, WEB_ORIGIN } from './support/accounts.js';
import { integrationConfig, problemOf, startTestApp, type TestApp } from './support/app.js';
import type { ScratchDatabase } from './support/database.js';
import { startS3, type TestS3 } from './support/s3.js';
import {
  createMigratedDatabase,
  redisUrl,
  startTestWorker,
  type TestWorker,
  uniqueQueuePrefix,
  waitFor,
  workerConfig,
} from './support/worker.js';

let database: ScratchDatabase;
let pool: Pool;
let s3: TestS3;
let api: TestApp;
let worker: TestWorker;
let ipCounter = 0;

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
  worker = await startTestWorker(workerConfig(database.url, shared));
}, 180_000);

afterAll(async () => {
  await worker.close();
  await api.close();
  await pool.end();
  await database.drop();
  await s3.stop();
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

interface Sale {
  readonly orderId: string;
  readonly publicId: string;
  readonly seller: TestUser;
  readonly buyer: TestUser;
}

/** Aukcja z Kup teraz i zamówienie AWAITING_PAYMENT. */
async function sale(sellerName = 'Ewa Sprzedająca', buyerName = 'Kasia Kupująca'): Promise<Sale> {
  const seller = await createUser(api, pool, { name: sellerName });
  const buyer = await createUser(api, pool, { name: buyerName });
  const created = await call('POST', '/v1/auctions', seller);
  expect(created.statusCode, created.body).toBe(201);
  const { id } = created.json<{ id: string }>();
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
  const bought = await call('POST', `/v1/auctions/${id}/buy-now`, buyer, undefined, {
    'idempotency-key': `review-${newId()}`,
  });
  expect(bought.statusCode, bought.body).toBe(201);
  const order = await pool.query<{ id: string; public_id: string }>(
    `select o.id, o.public_id from orders o join order_items i on i.order_id = o.id
     where i.auction_id = $1 and i.is_active`,
    [id],
  );
  const row = order.rows[0];
  if (row === undefined) {
    throw new Error('Brak zamówienia');
  }
  return { orderId: row.id, publicId: row.public_id, seller, buyer };
}

/** Przejścia zamówienia przez dozwolone stany (trigger §7.3) aż do odebranej paczki. */
async function delivered(orderId: string): Promise<void> {
  await pool.query(
    `update orders set status = 'PAID', paid_at = now(), ship_by = now() + interval '5 days'
     where id = $1`,
    [orderId],
  );
  await pool.query(`update orders set status = 'SHIPPED', shipped_at = now() where id = $1`, [
    orderId,
  ]);
  await pool.query(
    `update orders set status = 'DELIVERED', delivered_at = now(),
       inspection_ends_at = now() + interval '36 hours' where id = $1`,
    [orderId],
  );
}

async function completed(daysAgo = 0): Promise<Sale> {
  const order = await sale();
  await delivered(order.orderId);
  await pool.query(
    `update orders set status = 'COMPLETED', completed_at = now() - make_interval(days => $2)
     where id = $1`,
    [order.orderId, daysAgo],
  );
  return order;
}

interface ReviewView {
  readonly id: string;
  readonly rating: number;
  readonly comment: string | null;
  readonly authorRole: string;
  readonly visibleAt: string;
  readonly visible: boolean;
}

interface OrderReviews {
  readonly role: string;
  readonly counterpart: { readonly id: string; readonly name: string };
  readonly blocker: string | null;
  readonly rateUntil: string | null;
  readonly mine: ReviewView | null;
  readonly theirs: ReviewView | null;
  readonly counterpartReviewed: boolean;
}

async function state(order: Sale, user: TestUser): Promise<OrderReviews> {
  const response = await call('GET', `/v1/orders/${order.publicId}/reviews`, user);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<OrderReviews>();
}

async function review(
  order: Sale,
  user: TestUser,
  body: Record<string, unknown>,
): Promise<OrderReviews> {
  const response = await call('POST', `/v1/orders/${order.publicId}/review`, user, body);
  expect(response.statusCode, response.body).toBe(201);
  return response.json<OrderReviews>();
}

async function notificationsOf(user: TestUser, type: string) {
  const { rows } = await pool.query<{ payload: { review: Record<string, unknown> } }>(
    `select payload from notifications where user_id = $1 and type = $2`,
    [user.id, type],
  );
  return rows;
}

describe('ocena zakończonego zamówienia', () => {
  it('ukrywa pierwszą ocenę, a druga odsłania obie', async () => {
    const order = await completed();
    const publisher = api.app.get(ReviewPublisher);

    const before = await state(order, order.buyer);
    expect(before).toMatchObject({
      role: 'BUYER',
      counterpart: { id: order.seller.id, name: 'Ewa Sprzedająca' },
      blocker: null,
      mine: null,
      theirs: null,
      counterpartReviewed: false,
    });

    const afterBuyer = await review(order, order.buyer, {
      rating: 5,
      comment: '  Zgodnie z opisem, szybka wysyłka.  ',
    });
    expect(afterBuyer.blocker).toBe('ALREADY_REVIEWED');
    expect(afterBuyer.mine).toMatchObject({
      rating: 5,
      comment: 'Zgodnie z opisem, szybka wysyłka.',
      authorRole: 'BUYER',
      visible: false,
    });

    // Sprzedający wie, że kupujący ocenił, ale nie widzi oceny; profil też jej nie pokazuje.
    const sellerView = await state(order, order.seller);
    expect(sellerView).toMatchObject({ counterpartReviewed: true, theirs: null, blocker: null });
    expect(sellerView.rateUntil).toBe(afterBuyer.mine?.visibleAt);
    const hidden = await call('GET', `/v1/users/${order.seller.id}/rating`);
    expect(hidden.json()).toMatchObject({ count: 0, average: null });
    expect((await call('GET', `/v1/users/${order.seller.id}/reviews`)).json()).toEqual({
      items: [],
      nextBefore: null,
    });

    // Zaproszenie do oceny dla sprzedającego, bez gwiazdek.
    await waitFor(
      async () => (await notificationsOf(order.seller, 'REVIEW_REQUESTED')).length === 1,
      'REVIEW_REQUESTED',
    );
    const [requested] = await notificationsOf(order.seller, 'REVIEW_REQUESTED');
    expect(requested?.payload.review).toEqual({
      orderPublicId: order.publicId,
      title: 'Lampa biurkowa, lata 60.',
      authorRole: 'BUYER',
      rateUntil: afterBuyer.mine?.visibleAt,
    });

    const afterSeller = await review(order, order.seller, { rating: 4 });
    expect(afterSeller.mine).toMatchObject({ rating: 4, comment: null, visible: true });
    expect(afterSeller.theirs).toMatchObject({ rating: 5, authorRole: 'BUYER', visible: true });
    expect((await state(order, order.buyer)).theirs).toMatchObject({ rating: 4 });

    const rating = await call('GET', `/v1/users/${order.seller.id}/rating`);
    expect(rating.statusCode).toBe(200);
    expect(rating.headers['cache-control']).toBe('public, max-age=60');
    expect(rating.json()).toEqual({
      userId: order.seller.id,
      average: 5,
      count: 1,
      asSeller: { average: 5, count: 1 },
      asBuyer: { average: null, count: 0 },
    });
    const list = await call('GET', `/v1/users/${order.seller.id}/reviews`);
    expect(list.json()).toMatchObject({
      items: [
        {
          rating: 5,
          comment: 'Zgodnie z opisem, szybka wysyłka.',
          authorRole: 'BUYER',
          authorName: 'k***a',
          title: 'Lampa biurkowa, lata 60.',
        },
      ],
      nextBefore: null,
    });
    expect(JSON.stringify(list.json())).not.toContain(order.publicId);

    // Job ujawnień: po jednym powiadomieniu „nowa ocena” dla obu stron, bez zaproszenia dla kupującego.
    await publisher.publishDue(new Date());
    await waitFor(
      async () =>
        (await notificationsOf(order.buyer, 'REVIEW_RECEIVED')).length === 1 &&
        (await notificationsOf(order.seller, 'REVIEW_RECEIVED')).length === 1,
      'REVIEW_RECEIVED',
    );
    const [received] = await notificationsOf(order.seller, 'REVIEW_RECEIVED');
    expect(received?.payload.review).toMatchObject({ rating: 5, authorRole: 'BUYER' });
    expect(await notificationsOf(order.buyer, 'REVIEW_REQUESTED')).toHaveLength(0);
  });

  it('raz na stronę; obce zamówienie 404; komentarz bez danych kontaktowych', async () => {
    const order = await completed();
    const stranger = await createUser(api, pool);
    expect((await call('GET', `/v1/orders/${order.publicId}/reviews`, stranger)).statusCode).toBe(
      404,
    );
    expect(
      (await call('POST', `/v1/orders/${order.publicId}/review`, stranger, { rating: 1 }))
        .statusCode,
    ).toBe(404);

    const contact = await call('POST', `/v1/orders/${order.publicId}/review`, order.buyer, {
      rating: 2,
      comment: 'Zadzwoń 600 700 800',
    });
    expect(contact.statusCode).toBe(400);
    expect(contact.body).toContain('Komentarz jest publiczny');
    const noRating = await call('POST', `/v1/orders/${order.publicId}/review`, order.buyer, {
      comment: 'Bez gwiazdek',
    });
    expect(noRating.statusCode).toBe(400);
    const tooHigh = await call('POST', `/v1/orders/${order.publicId}/review`, order.buyer, {
      rating: 6,
    });
    expect(tooHigh.statusCode).toBe(400);

    await review(order, order.buyer, { rating: 3 });
    const again = await call('POST', `/v1/orders/${order.publicId}/review`, order.buyer, {
      rating: 5,
    });
    expect(again.statusCode).toBe(409);
    expect(problemOf(again)).toMatchObject({
      code: 'REVIEW_UNAVAILABLE',
      reason: 'ALREADY_REVIEWED',
    });
  });

  it('równoczesne oceny obu stron odsłaniają obie', async () => {
    const order = await completed();
    const [buyer, seller] = await Promise.all([
      call('POST', `/v1/orders/${order.publicId}/review`, order.buyer, { rating: 5 }),
      call('POST', `/v1/orders/${order.publicId}/review`, order.seller, { rating: 5 }),
    ]);
    expect([buyer.statusCode, seller.statusCode]).toEqual([201, 201]);
    expect((await state(order, order.buyer)).theirs).toMatchObject({ visible: true });
    expect((await state(order, order.seller)).theirs).toMatchObject({ visible: true });
  });
});

describe('okno i ujawnienie', () => {
  it('zamówienie w toku, zwrot bez sporu i po 14 dniach nie dają oceny', async () => {
    const inProgress = await sale();
    expect((await state(inProgress, inProgress.buyer)).blocker).toBe('NOT_FINISHED');
    const early = await call('POST', `/v1/orders/${inProgress.publicId}/review`, inProgress.buyer, {
      rating: 1,
    });
    expect(early.statusCode).toBe(409);
    expect(problemOf(early)).toMatchObject({ reason: 'NOT_FINISHED' });

    const notShipped = await sale();
    await pool.query(
      `update orders set status = 'PAID', paid_at = now(), ship_by = now() where id = $1`,
      [notShipped.orderId],
    );
    await pool.query(
      `update orders set status = 'CANCELLED_NOT_SHIPPED', cancelled_at = now() where id = $1`,
      [notShipped.orderId],
    );
    await pool.query(`update orders set status = 'REFUNDED', refunded_at = now() where id = $1`, [
      notShipped.orderId,
    ]);
    expect((await state(notShipped, notShipped.buyer)).blocker).toBe('NOT_FINISHED');

    const old = await completed(15);
    const late = await state(old, old.buyer);
    expect(late.blocker).toBe('WINDOW_CLOSED');
    const closed = await call('POST', `/v1/orders/${old.publicId}/review`, old.buyer, {
      rating: 5,
    });
    expect(problemOf(closed)).toMatchObject({
      code: 'REVIEW_UNAVAILABLE',
      reason: 'WINDOW_CLOSED',
    });
  });

  it('zwrot po sporze daje się ocenić', async () => {
    const order = await sale();
    await delivered(order.orderId);
    await pool.query(`update orders set status = 'DISPUTED', disputed_at = now() where id = $1`, [
      order.orderId,
    ]);
    await pool.query(`update orders set status = 'REFUNDED', refunded_at = now() where id = $1`, [
      order.orderId,
    ]);
    expect((await state(order, order.seller)).blocker).toBeNull();
    const reviewed = await review(order, order.seller, { rating: 2, comment: 'Długi kontakt.' });
    expect(reviewed.mine).toMatchObject({ authorRole: 'SELLER', visible: false });
  });

  it('pierwsza ocena odsłania się po 7 dniach, a druga strona traci możliwość oceny', async () => {
    const order = await completed(1);
    const publisher = api.app.get(ReviewPublisher);
    await review(order, order.seller, { rating: 1, comment: 'Brak kontaktu po zakupie.' });
    const published = async () =>
      (
        await pool.query<{ published_at: Date | null }>(
          'select published_at from reviews where order_id = $1',
          [order.orderId],
        )
      ).rows[0]?.published_at ?? null;
    await publisher.publishDue(new Date());
    expect(await published()).toBeNull();

    // Upływ 7 dni: ocena widoczna od chwili w przeszłości.
    await pool.query(
      `update reviews set created_at = now() - interval '8 days',
         visible_at = now() - interval '1 day' where order_id = $1`,
      [order.orderId],
    );
    const buyerView = await state(order, order.buyer);
    expect(buyerView.blocker).toBe('WINDOW_CLOSED');
    expect(buyerView.theirs).toMatchObject({ rating: 1, authorRole: 'SELLER' });
    const late = await call('POST', `/v1/orders/${order.publicId}/review`, order.buyer, {
      rating: 1,
    });
    expect(problemOf(late)).toMatchObject({ reason: 'WINDOW_CLOSED' });

    await publisher.publishDue(new Date());
    expect(await published()).not.toBeNull();
    await waitFor(
      async () => (await notificationsOf(order.buyer, 'REVIEW_RECEIVED')).length === 1,
      'REVIEW_RECEIVED',
    );
    const rating = await call('GET', `/v1/users/${order.buyer.id}/rating`);
    expect(rating.json()).toMatchObject({
      count: 1,
      average: 1,
      asBuyer: { count: 1, average: 1 },
    });
  });
});

describe('profil publiczny', () => {
  it('stronicuje oceny i ukrywa zablokowane konto', async () => {
    const seller = await createUser(api, pool, { name: 'Marek Wielu Ocen' });
    for (let index = 0; index < 22; index += 1) {
      await pool.query(
        `insert into reviews (id, order_id, order_public_id, title, author_id, target_id, role,
           rating, created_at, visible_at)
         values ($1, $2, $3, 'Przedmiot', $4, $5, 'BUYER', $6, now() - make_interval(mins => $7),
           now() - make_interval(mins => $7))`,
        [newId(), newId(), `TEST${String(index)}`, newId(), seller.id, (index % 5) + 1, index],
      );
    }
    const first = await call('GET', `/v1/users/${seller.id}/reviews`);
    const page = first.json<{ items: { id: string }[]; nextBefore: string | null }>();
    expect(page.items).toHaveLength(20);
    expect(page.nextBefore).toBe(page.items.at(-1)?.id);
    const second = await call(
      'GET',
      `/v1/users/${seller.id}/reviews?before=${page.nextBefore ?? ''}`,
    );
    expect(second.json<{ items: unknown[] }>().items).toHaveLength(2);
    expect((await call('GET', `/v1/users/${seller.id}/rating`)).json()).toMatchObject({
      count: 22,
      average: 2.86,
    });

    await pool.query(`update users set status = 'BANNED' where id = $1`, [seller.id]);
    expect((await call('GET', `/v1/users/${seller.id}/rating`)).statusCode).toBe(404);
    expect((await call('GET', `/v1/users/${seller.id}/reviews`)).statusCode).toBe(404);
    expect((await call('GET', '/v1/users/nie-uuid/rating')).statusCode).toBe(404);
  });
});

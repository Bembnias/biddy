// Kryteria F-28 na prawdziwym Postgresie, Redisie i magazynie S3: API nasłuchuje na porcie, a worker
// w procesie testu rozlicza płatności i zwroty FakeGateway (webhooki HTTP), tworzy przesyłki
// u FakeShipping i wykonuje konsumentów eventów. Statusy przesyłek (do kupującego i zwrotnej) test
// prowadzi ręcznie przez symulator, a terminy sporu wywołuje wprost z przesuniętym „teraz”.
import { PutObjectCommand } from '@aws-sdk/client-s3';
import type { LightMyRequestResponse } from 'fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId } from '../../src/infra/db/index.js';
import { canDisputeTransition, DisputeDeadlines } from '../../src/modules/disputes/index.js';
import { LedgerService } from '../../src/modules/ledger/index.js';
import { OrderLifecycle } from '../../src/modules/orders/index.js';
import { FAKE_BLIK_CODES } from '../../src/modules/payments/index.js';
import { FakeShippingSimulator } from '../../src/modules/shipping/adapters/fake/fake-shipping-simulator.js';
import type { FakeParcelStatus } from '../../src/modules/shipping/db/fake-shipping.schema.js';
import { CarrierClaimService } from '../../src/modules/shipping/index.js';
import { DISPUTE_STATUSES } from '@biddy/shared';
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

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let database: ScratchDatabase;
let pool: Pool;
let s3: TestS3;
let api: TestApp;
let worker: TestWorker;
let deadlines: DisputeDeadlines;
let simulator: FakeShippingSimulator;
let staff: TestUser;
let ipCounter = 0;

beforeAll(async () => {
  s3 = await startS3();
  database = await createMigratedDatabase();
  pool = new Pool({ connectionString: database.url, max: 8 });
  const shared = {
    DATABASE_URL: database.url,
    REDIS_QUEUE_URL: redisUrl(),
    QUEUE_PREFIX: uniqueQueuePrefix(),
    TRUST_PROXY: 'loopback',
    CORS_ORIGINS: WEB_ORIGIN,
    PAYMENTS_FAKE_WEBHOOK_DELAY_MS: '200',
    SHIPPING_FAKE_STEP_DELAY_MS: String(60 * 60 * 1000),
    ...s3.env,
  };
  api = await startTestApp(integrationConfig(shared));
  await api.app.listen(0, '127.0.0.1');
  const base = (await api.app.getUrl()).replace('[::1]', '127.0.0.1');
  worker = await startTestWorker(
    workerConfig(database.url, {
      ...shared,
      PAYMENTS_FAKE_WEBHOOK_URL: `${base}/v1/webhooks/payments/fake`,
      SHIPPING_FAKE_WEBHOOK_URL: `${base}/v1/webhooks/shipping/fake`,
    }),
  );
  deadlines = api.app.get(DisputeDeadlines);
  simulator = api.app.get(FakeShippingSimulator);
  staff = await createUser(api, pool, { name: 'Moderator Sporów' });
  await pool.query(`update users set staff_role = 'moderator' where id = $1`, [staff.id]);
}, 180_000);

afterAll(async () => {
  await worker.close();
  await api.close();
  await pool.end();
  await database.drop();
  await s3.stop();
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

const count = async (sql: string, params: unknown[]) =>
  Number((await pool.query<{ count: string }>(sql, params)).rows[0]?.count ?? 0);

async function readyPhoto(owner: TestUser, purpose = 'ITEM_PHOTO'): Promise<string> {
  const id = newId();
  await pool.query(
    `insert into media (id, owner_id, purpose, status, content_type, size_bytes, width, height)
     values ($1, $2, $3, 'READY', 'image/jpeg', 1000, 1600, 1200)`,
    [id, owner.id, purpose],
  );
  return id;
}

/** Zdjęcie ze sporu: rekord READY i warianty w prywatnym kubełku (jak po przetworzeniu). */
async function evidencePhoto(owner: TestUser): Promise<string> {
  const id = await readyPhoto(owner, 'DISPUTE_EVIDENCE');
  for (const variant of ['thumb', 'large']) {
    await s3.client.send(
      new PutObjectCommand({
        Bucket: UPLOADS_BUCKET,
        Key: `evidence/${id}/${variant}.webp`,
        Body: Buffer.from(`webp-${variant}`),
        ContentType: 'image/webp',
      }),
    );
  }
  return id;
}

interface Sale {
  readonly orderId: string;
  readonly publicId: string;
  readonly seller: TestUser;
  readonly buyer: TestUser;
  readonly parcelId: string;
}

/** Odebrane zamówienie (Kup teraz 120 zł, paczkomat, BLIK) z przesyłką odebraną u przewoźnika. */
async function deliveredSale(): Promise<Sale> {
  const seller = await createUser(api, pool, { name: 'Sprzedawca Sporu' });
  const buyer = await createUser(api, pool, { name: 'Kupujący Sporu' });
  const created = await call('POST', '/v1/auctions', seller);
  expect(created.statusCode, created.body).toBe(201);
  const { id: auctionId } = created.json<{ id: string }>();
  const { rows } = await pool.query<{ id: string }>(
    `select id from categories where slug = 'dekoracje'`,
  );
  const patched = await call('PATCH', `/v1/auctions/${auctionId}`, seller, {
    mediaIds: [await readyPhoto(seller)],
    categoryId: rows[0]?.id,
    title: 'Lampa biurkowa, lata 60.',
    description: 'Mosiężna lampa biurkowa, działa, nowy przewód. Wysokość 40 cm.',
    condition: 'VERY_GOOD',
    packageSize: 'M',
    allowedCarriers: ['inpost-paczkomat', 'inpost-kurier'],
    startPrice: 2_000,
    buyNowPrice: 12_000,
    durationDays: 7,
  });
  expect(patched.statusCode, patched.body).toBe(200);
  const published = await call('POST', `/v1/auctions/${auctionId}/publish`, seller, {
    kycNoticeAccepted: true,
  });
  expect(published.statusCode, published.body).toBe(200);
  const bought = await call('POST', `/v1/auctions/${auctionId}/buy-now`, buyer, undefined, {
    'idempotency-key': `dispute-${newId()}`,
  });
  expect(bought.statusCode, bought.body).toBe(201);
  const { rows: orders } = await pool.query<{ id: string; public_id: string }>(
    `select o.id, o.public_id from orders o join order_items i on i.order_id = o.id
     where i.auction_id = $1 and i.is_active`,
    [auctionId],
  );
  const order = { orderId: orders[0]?.id ?? '', publicId: orders[0]?.public_id ?? '' };
  const chosen = await call('PUT', `/v1/orders/${order.publicId}/delivery`, buyer, {
    carrierId: 'inpost-paczkomat',
    pickupPointId: 'inpost-paczkomat-01',
    recipient: { name: 'Jan Kupujący', phone: '600 700 800' },
  });
  expect(chosen.statusCode, chosen.body).toBe(200);
  const total = chosen.json<{ order: { total: number } }>().order.total;
  const paid = await call(
    'POST',
    `/v1/orders/${order.publicId}/payments`,
    buyer,
    { method: 'BLIK', blikCode: FAKE_BLIK_CODES.SUCCEED, expectedTotal: total },
    { 'idempotency-key': newId() },
  );
  expect(paid.statusCode, paid.body).toBe(201);
  await waitForOrder(order.publicId, buyer, 'PAID');
  const dispatched = await call('POST', `/v1/orders/${order.publicId}/shipment`, seller, {
    sender: {
      name: 'Anna Sprzedająca',
      phone: '500 600 700',
      address: { street: 'ul. Prosta 1', postalCode: '00-001', city: 'Warszawa' },
    },
    dispatchMethod: 'DROP_OFF',
  });
  expect(dispatched.statusCode, dispatched.body).toBe(202);
  const parcelId = await createdParcel(order.orderId, 'OUTBOUND');
  await advance(parcelId, 'posted', 'in_transit', 'awaiting_pickup', 'delivered');
  await waitForOrder(order.publicId, buyer, 'DELIVERED');
  return { ...order, seller, buyer, parcelId };
}

/** Przesyłka zamówienia utworzona u FakeShipping; zwraca ID paczki w symulatorze. */
function createdParcel(orderId: string, direction: 'OUTBOUND' | 'RETURN'): Promise<string> {
  return waitFor(async () => {
    const { rows } = await pool.query<{ status: string; provider_shipment_id: string | null }>(
      `select status, provider_shipment_id from shipments
       where order_id = $1 and direction = $2 and status <> 'CANCELLED'`,
      [orderId, direction],
    );
    const row = rows[0];
    return row?.status === 'CREATED' && row.provider_shipment_id !== null
      ? row.provider_shipment_id
      : undefined;
  }, `przesyłka ${direction} utworzona u FakeShipping`);
}

async function advance(parcelId: string, ...statuses: FakeParcelStatus[]): Promise<void> {
  for (const status of statuses) {
    await simulator.advance(parcelId, { status });
  }
}

interface OrderView {
  status: string;
  itemsTotal: number;
  shippingFee: number | null;
  total: number;
  disputedAt: string | null;
  actions: { openDispute: { until: string; allowed: boolean } | null };
}

async function orderView(publicId: string, user: TestUser): Promise<OrderView> {
  const response = await call('GET', `/v1/orders/${publicId}`, user);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<OrderView>();
}

function waitForOrder(publicId: string, user: TestUser, status: string) {
  return waitFor(
    async () => {
      const current = await orderView(publicId, user);
      return current.status === status ? current : undefined;
    },
    `zamówienie ${publicId} w stanie ${status}`,
    20_000,
  );
}

interface DisputeView {
  id: string;
  status: string;
  role: string;
  responseDueAt: string | null;
  decisionDueAt: string | null;
  partialOffer: number | null;
  resolution: {
    outcome: string;
    fault: string | null;
    refundAmount: number | null;
    decidedBy: string;
    statement: string;
    resolvedAt: string | null;
    sellerCosts: number | null;
    refund: { status: string } | null;
  } | null;
  return: {
    shipBy: string | null;
    inspectionEndsAt: string | null;
    shipment: { status: string; carrier: { id: string; kind: string }; price: number } | null;
  } | null;
  returnQuote: { carrierId: string; price: number } | null;
  events: { type: string; actor: string; note: string | null; photos: { thumbUrl: string }[] }[];
  actions: Record<string, boolean>;
}

async function disputeView(sale: Sale, user: TestUser): Promise<DisputeView> {
  const response = await call('GET', `/v1/orders/${sale.publicId}/dispute`, user);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<DisputeView>();
}

async function openDispute(sale: Sale, body: Record<string, unknown> = {}): Promise<DisputeView> {
  const response = await call('POST', `/v1/orders/${sale.publicId}/dispute`, sale.buyer, {
    reason: 'NOT_AS_DESCRIBED',
    description: 'Lampa nie działa, a w opisie było, że jest sprawna.',
    mediaIds: [await evidencePhoto(sale.buyer)],
    ...body,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<DisputeView>();
}

async function escalated(sale: Sale, dispute: DisputeView): Promise<void> {
  const rejected = await call('POST', `/v1/disputes/${dispute.id}/seller-response`, sale.seller, {
    action: 'REJECT',
    note: 'Lampa była sprawdzona przed wysyłką i działała.',
  });
  expect(rejected.statusCode, rejected.body).toBe(200);
  expect(rejected.json<DisputeView>().status).toBe('ESCALATED');
}

async function balance(code: string, subject: string | null): Promise<number> {
  const { rows } = await pool.query<{ balance: string }>(
    `select balance from ledger_accounts where code = $1 and subject is not distinct from $2`,
    [code, subject],
  );
  return Number(rows[0]?.balance ?? 0);
}

async function sellerBalances(seller: TestUser) {
  return api.app.get(LedgerService).sellerBalances(seller.id);
}

function waitForNotifications(user: TestUser, types: readonly string[]) {
  return waitFor(
    async () => {
      const { rows } = await pool.query<{ type: string }>(
        `select type from notifications where user_id = $1`,
        [user.id],
      );
      const current = rows.map((row) => row.type);
      return types.every((type) => current.includes(type)) ? current : undefined;
    },
    `powiadomienia ${types.join(', ')}`,
  );
}

describe('maszyna stanów sporu', () => {
  it('trigger w bazie przepuszcza dokładnie pary z §7.5', async () => {
    const mismatches: string[] = [];
    for (const from of DISPUTE_STATUSES) {
      for (const to of DISPUTE_STATUSES) {
        if (from === to) {
          continue;
        }
        const id = newId();
        await pool.query(
          `insert into disputes (id, order_id, order_public_id, title, buyer_id, seller_id,
             currency, items_total, shipping_fee, order_total, reason, description, status,
             outcome, decided_by, statement, decided_at, resolved_at)
           values ($1, $2, 'B-0000', 'Test', $3, $4, 'PLN', 1000, 0, 1100, 'OTHER', 'opis', $5,
             'SELLER_FAVOR', 'SYSTEM', 'test', now(), $6)`,
          [id, newId(), newId(), newId(), from, from === 'RESOLVED' ? new Date() : null],
        );
        const allowed = await pool
          .query(
            `update disputes set status = $2,
               resolved_at = case when $2 = 'RESOLVED' then now() else null end
             where id = $1`,
            [id, to],
          )
          .then(
            () => true,
            (error: unknown) => {
              expect(String(error)).toContain('Niedozwolone przejście sporu');
              return false;
            },
          );
        if (allowed !== canDisputeTransition(from, to)) {
          mismatches.push(`${from} → ${to}: baza ${String(allowed)}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe('zgłoszenie (kryterium 1)', () => {
  it('tylko kupujący odebranego zamówienia w oknie 36 h; środki zamrożone; zdjęcia prywatne', async () => {
    const sale = await deliveredSale();
    const stranger = await createUser(api, pool);
    const before = await orderView(sale.publicId, sale.buyer);
    expect(before.actions.openDispute).toMatchObject({ allowed: true });

    const noPhoto = await call('POST', `/v1/orders/${sale.publicId}/dispute`, sale.buyer, {
      reason: 'DAMAGED',
      description: 'Klosz jest pęknięty w dwóch miejscach.',
      mediaIds: [],
    });
    expect(noPhoto.statusCode).toBe(400);
    const asSeller = await call('POST', `/v1/orders/${sale.publicId}/dispute`, sale.seller, {
      reason: 'OTHER',
      description: 'Sprzedający próbuje otworzyć spór.',
    });
    expect(asSeller.statusCode).toBe(404);

    const opened = await openDispute(sale);
    expect(opened).toMatchObject({ status: 'AWAITING_SELLER', role: 'BUYER' });
    const due = Date.parse(opened.responseDueAt ?? '') - Date.now();
    expect(due).toBeGreaterThan(47 * HOUR);
    expect(due).toBeLessThanOrEqual(48 * HOUR);
    const again = await call('POST', `/v1/orders/${sale.publicId}/dispute`, sale.buyer, {
      reason: 'OTHER',
      description: 'Drugie zgłoszenie tego samego zamówienia.',
    });
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json<DisputeView>().id).toBe(opened.id);

    const order = await orderView(sale.publicId, sale.seller);
    expect(order.status).toBe('DISPUTED');
    expect(order.disputedAt).not.toBeNull();
    const lifecycle = api.app.get(OrderLifecycle);
    expect(await lifecycle.completeInspected(new Date(Date.now() + 3 * DAY))).toMatchObject({
      changed: 0,
    });
    expect(await balance('buyer_funds_held', sale.orderId)).toBeLessThan(0);

    const sellerView = await disputeView(sale, sale.seller);
    expect(sellerView).toMatchObject({ role: 'SELLER', actions: { respond: true } });
    expect(sellerView.returnQuote).toMatchObject({ carrierId: 'inpost-kurier' });
    expect((await call('GET', `/v1/orders/${sale.publicId}/dispute`, stranger)).statusCode).toBe(
      404,
    );
    const photoUrl = new URL(sellerView.events[0]?.photos[0]?.thumbUrl ?? '');
    for (const user of [sale.buyer, sale.seller, staff]) {
      const photo = await call('GET', photoUrl.pathname, user);
      expect(photo.statusCode, photo.body).toBe(200);
      expect(photo.headers['content-type']).toBe('image/webp');
    }
    expect((await call('GET', photoUrl.pathname, stranger)).statusCode).toBe(404);
    const foreign = await evidencePhoto(stranger);
    expect(
      (await call('GET', `/v1/disputes/${opened.id}/photos/${foreign}/thumb`, sale.buyer))
        .statusCode,
    ).toBe(404);
    expect(
      await count(`select count(*) from media where id = $1 and attached_at is not null`, [
        new URL(photoUrl).pathname.split('/')[5],
      ]),
    ).toBe(1);
    await waitForNotifications(sale.seller, ['DISPUTE_OPENED']);
  });

  it('po oknie 36 h i w innym stanie: 409', async () => {
    const sale = await deliveredSale();
    await pool.query(
      `update orders set inspection_ends_at = now() - interval '1 minute' where id = $1`,
      [sale.orderId],
    );
    const late = await call('POST', `/v1/orders/${sale.publicId}/dispute`, sale.buyer, {
      reason: 'OTHER',
      description: 'Zgłoszenie po upływie okna na sprawdzenie.',
    });
    expect(late.statusCode).toBe(409);
    expect(problemOf(late).code).toBe('DISPUTE_WINDOW_CLOSED');
    await lifecycle().completeInspected(new Date());
    await waitForOrder(sale.publicId, sale.buyer, 'COMPLETED');
    const completed = await call('POST', `/v1/orders/${sale.publicId}/dispute`, sale.buyer, {
      reason: 'OTHER',
      description: 'Zgłoszenie po zakończeniu zamówienia.',
    });
    expect(problemOf(completed).code).toBe('DISPUTE_UNAVAILABLE');
  });
});

function lifecycle(): OrderLifecycle {
  return api.app.get(OrderLifecycle);
}

describe('eskalacja i decyzja (kryteria 2, 4, 7)', () => {
  it('brak odpowiedzi w 48 h eskaluje; decyzja z winy sprzedającego: zwrot, koszty i strike', async () => {
    const sale = await deliveredSale();
    const dispute = await openDispute(sale);
    expect(await deadlines.escalateOverdue(new Date(Date.now() + 47 * HOUR))).toMatchObject({
      changed: 0,
    });
    await deadlines.escalateOverdue(new Date(Date.now() + 49 * HOUR));
    const escalatedView = await disputeView(sale, sale.buyer);
    expect(escalatedView.status).toBe('ESCALATED');
    expect(escalatedView.decisionDueAt).not.toBeNull();
    await waitForNotifications(sale.buyer, ['DISPUTE_ESCALATED']);
    await waitForNotifications(sale.seller, ['DISPUTE_OPENED', 'DISPUTE_ESCALATED']);

    const comment = await call('POST', `/v1/disputes/${dispute.id}/comments`, sale.seller, {
      note: 'Przed wysyłką lampa działała, mam nagranie.',
      mediaIds: [await evidencePhoto(sale.seller)],
    });
    expect(comment.statusCode, comment.body).toBe(200);
    const commentEntry = comment
      .json<DisputeView>()
      .events.find((event) => event.type === 'COMMENT');
    expect(commentEntry).toMatchObject({ actor: 'SELLER' });
    expect(commentEntry?.photos).toHaveLength(1);

    const queue = await call('GET', '/v1/admin/disputes', staff);
    expect(queue.statusCode, queue.body).toBe(200);
    expect(queue.json<{ items: { id: string }[] }>().items.map((item) => item.id)).toContain(
      dispute.id,
    );
    expect((await call('GET', '/v1/admin/disputes', sale.buyer)).statusCode).toBe(403);
    const withoutFault = await call('POST', `/v1/admin/disputes/${dispute.id}/decision`, staff, {
      outcome: 'FULL_REFUND',
      statement: 'Przedmiot niezgodny z opisem na podstawie zdjęć.',
    });
    expect(withoutFault.statusCode).toBe(400);

    const order = await orderView(sale.publicId, sale.buyer);
    const statement = 'Zdjęcia pokazują, że lampa nie działa, choć opis mówił o sprawnej.';
    const decided = await call('POST', `/v1/admin/disputes/${dispute.id}/decision`, staff, {
      outcome: 'FULL_REFUND',
      fault: 'SELLER',
      statement,
    });
    expect(decided.statusCode, decided.body).toBe(200);
    expect(decided.json<DisputeView>()).toMatchObject({
      status: 'RESOLVED',
      resolution: { outcome: 'FULL_REFUND', fault: 'SELLER', decidedBy: 'STAFF', statement },
    });
    const again = await call('POST', `/v1/admin/disputes/${dispute.id}/decision`, staff, {
      outcome: 'SELLER_FAVOR',
      statement: 'Druga decyzja w tym samym sporze.',
    });
    expect(problemOf(again).code).toBe('DISPUTE_NOT_ESCALATED');

    await waitForOrder(sale.publicId, sale.buyer, 'REFUNDED');
    expect(await balance('buyer_funds_held', sale.orderId)).toBe(0);
    const balances = await sellerBalances(sale.seller);
    expect(balances.available.amount).toBe(0);
    expect(balances.receivable.amount).toBe(order.shippingFee);
    expect(
      await count(
        `select count(*) from ledger_transactions where type = 'DISPUTE_COSTS_CHARGED' and order_id = $1`,
        [sale.orderId],
      ),
    ).toBe(1);
    expect(
      await count(`select count(*) from strikes where user_id = $1 and reason = 'DISPUTE_LOST'`, [
        sale.seller.id,
      ]),
    ).toBe(1);
    expect(
      await count(
        `select count(*) from trade_records where order_id = $1 and seller_dispute_lost_at is not null`,
        [sale.orderId],
      ),
    ).toBe(1);
    const buyerView = await disputeView(sale, sale.buyer);
    expect(buyerView.resolution).toMatchObject({
      statement,
      refundAmount: order.total,
      sellerCosts: null,
    });
    expect((await disputeView(sale, sale.seller)).resolution?.sellerCosts).toBe(order.shippingFee);
    await waitForNotifications(sale.buyer, ['DISPUTE_RESOLVED', 'ORDER_REFUNDED']);
    await waitForNotifications(sale.seller, ['DISPUTE_RESOLVED', 'STRIKE_ISSUED']);
  });

  it('wina przewoźnika: pełny zwrot, rekompensata równa cenie i reklamacja', async () => {
    const sale = await deliveredSale();
    const dispute = await openDispute(sale, { reason: 'DAMAGED' });
    await escalated(sale, dispute);
    const decided = await call('POST', `/v1/admin/disputes/${dispute.id}/decision`, staff, {
      outcome: 'FULL_REFUND',
      fault: 'CARRIER',
      statement: 'Zdjęcia zgniecionego kartonu wskazują na uszkodzenie w transporcie.',
    });
    expect(decided.statusCode, decided.body).toBe(200);
    const order = await waitForOrder(sale.publicId, sale.buyer, 'REFUNDED');
    expect(await balance('buyer_funds_held', sale.orderId)).toBe(0);
    expect((await sellerBalances(sale.seller)).available.amount).toBe(order.itemsTotal);
    expect(await count(`select count(*) from strikes where user_id = $1`, [sale.seller.id])).toBe(
      0,
    );
    const { rows } = await pool.query<{ id: string; type: string; claimed_amount: string }>(
      `select c.id, c.type, c.claimed_amount from carrier_claims c
       join shipments s on s.id = c.shipment_id where s.order_id = $1`,
      [sale.orderId],
    );
    expect(rows[0]).toMatchObject({ type: 'DAMAGED', claimed_amount: String(order.itemsTotal) });
    const claims = api.app.get(CarrierClaimService);
    await claims.submit(rows[0]?.id ?? '', 'FG-SZKODA-1');
    await claims.resolve(rows[0]?.id ?? '', { status: 'ACCEPTED', recoveredAmount: 5_000 });
    await waitFor(
      async () =>
        (await count(
          `select count(*) from ledger_transactions where type = 'CARRIER_CLAIM_SETTLED' and order_id = $1`,
          [sale.orderId],
        )) === 1 || undefined,
      'rozliczenie reklamacji',
    );
  });
});

describe('zwrot częściowy (kryteria 3, 8)', () => {
  it('propozycja do ceny; przyjęta: zwrot kwoty, reszta ceny na saldo, środki zamówienia 0', async () => {
    const sale = await deliveredSale();
    const dispute = await openDispute(sale);
    const order = await orderView(sale.publicId, sale.buyer);
    const tooMuch = await call('POST', `/v1/disputes/${dispute.id}/seller-response`, sale.seller, {
      action: 'OFFER_PARTIAL',
      amount: order.itemsTotal + 1,
    });
    expect(tooMuch.statusCode).toBe(400);
    const offered = await call('POST', `/v1/disputes/${dispute.id}/seller-response`, sale.seller, {
      action: 'OFFER_PARTIAL',
      amount: 3_000,
      note: 'Proponuję zwrot części ceny na naprawę.',
    });
    expect(offered.statusCode, offered.body).toBe(200);
    expect(offered.json<DisputeView>()).toMatchObject({
      status: 'PARTIAL_OFFERED',
      partialOffer: 3_000,
    });
    await waitForNotifications(sale.buyer, ['DISPUTE_PARTIAL_OFFERED']);
    const sellerAnswer = await call(
      'POST',
      `/v1/disputes/${dispute.id}/offer-response`,
      sale.seller,
      { accept: true },
    );
    expect(sellerAnswer.statusCode).toBe(404);

    const accepted = await call('POST', `/v1/disputes/${dispute.id}/offer-response`, sale.buyer, {
      accept: true,
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json<DisputeView>()).toMatchObject({
      status: 'RESOLVED',
      resolution: { outcome: 'PARTIAL_REFUND', refundAmount: 3_000, decidedBy: 'PARTIES' },
    });
    await waitForOrder(sale.publicId, sale.buyer, 'PARTIALLY_REFUNDED');
    expect(await balance('buyer_funds_held', sale.orderId)).toBe(0);
    expect((await sellerBalances(sale.seller)).available.amount).toBe(order.itemsTotal - 3_000);
    await waitFor(async () => {
      const { rows } = await pool.query<{ amount: string; status: string }>(
        `select amount, status from fund_releases where order_id = $1`,
        [sale.orderId],
      );
      return rows[0]?.status === 'NOT_REQUIRED' ? rows[0] : undefined;
    }, 'zwolnienie reszty ceny');
    expect(
      await count(`select count(*) from fund_releases where order_id = $1 and amount = $2`, [
        sale.orderId,
        order.itemsTotal - 3_000,
      ]),
    ).toBe(1);
    await waitForNotifications(sale.buyer, ['ORDER_REFUNDED', 'DISPUTE_RESOLVED']);
  });
});

describe('zwrot z odesłaniem (kryterium 5)', () => {
  it('etykieta zwrotna, tracking zwrotu i zwrot pieniędzy 36 h po odbiorze; koszty bez strike’a', async () => {
    const sale = await deliveredSale();
    const dispute = await openDispute(sale);
    const accepted = await call('POST', `/v1/disputes/${dispute.id}/seller-response`, sale.seller, {
      action: 'ACCEPT',
      returnRequired: true,
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const awaiting = await disputeView(sale, sale.buyer);
    expect(awaiting).toMatchObject({
      status: 'AWAITING_RETURN',
      actions: { shipReturn: true },
      resolution: { outcome: 'FULL_REFUND', decidedBy: 'PARTIES', resolvedAt: null },
      return: {
        shipment: { status: 'PENDING', carrier: { id: 'inpost-kurier', kind: 'COURIER' } },
      },
    });
    await waitForNotifications(sale.buyer, ['DISPUTE_RETURN_REQUESTED']);

    const shipped = await call('POST', `/v1/disputes/${dispute.id}/return-shipment`, sale.buyer, {
      sender: {
        name: 'Jan Kupujący',
        phone: '600 700 800',
        address: { street: 'ul. Długa 5', postalCode: '30-001', city: 'Kraków' },
      },
      dispatchMethod: 'DROP_OFF',
    });
    expect(shipped.statusCode, shipped.body).toBe(200);
    const parcelId = await createdParcel(sale.orderId, 'RETURN');
    const label = await waitFor(async () => {
      const response = await call('GET', `/v1/disputes/${dispute.id}/return-label`, sale.buyer);
      return response.statusCode === 200 ? response : undefined;
    }, 'etykieta zwrotna');
    expect(label.headers['content-type']).toBe('application/pdf');
    expect(
      (await call('GET', `/v1/disputes/${dispute.id}/return-label`, sale.seller)).statusCode,
    ).toBe(404);

    await advance(parcelId, 'posted');
    await waitFor(
      async () => (await disputeView(sale, sale.buyer)).status === 'RETURN_IN_TRANSIT' || undefined,
      'zwrot w drodze',
    );
    await advance(parcelId, 'in_transit', 'out_for_delivery', 'delivered');
    const delivered = await waitFor(async () => {
      const current = await disputeView(sale, sale.seller);
      return current.status === 'RETURN_DELIVERED' ? current : undefined;
    }, 'zwrot dostarczony');
    expect(delivered.actions['reviewReturn']).toBe(true);
    const window = Date.parse(delivered.return?.inspectionEndsAt ?? '') - Date.now();
    expect(window).toBeGreaterThan(35 * HOUR);
    await waitForNotifications(sale.seller, ['DISPUTE_RETURN_DELIVERED']);

    expect(await deadlines.settleReturns(new Date(Date.now() + 35 * HOUR))).toMatchObject({
      changed: 0,
    });
    await deadlines.settleReturns(new Date(Date.now() + 37 * HOUR));
    await waitForOrder(sale.publicId, sale.buyer, 'REFUNDED');
    expect(await balance('buyer_funds_held', sale.orderId)).toBe(0);
    const order = await orderView(sale.publicId, sale.buyer);
    const returnPrice = delivered.return?.shipment?.price ?? 0;
    expect(returnPrice).toBeGreaterThan(0);
    expect((await sellerBalances(sale.seller)).receivable.amount).toBe(
      (order.shippingFee ?? 0) + returnPrice,
    );
    expect(await count(`select count(*) from strikes where user_id = $1`, [sale.seller.id])).toBe(
      0,
    );
  });

  it('zwrot nienadany w 5 dni roboczych kończy spór na korzyść sprzedającego', async () => {
    const sale = await deliveredSale();
    const dispute = await openDispute(sale);
    await call('POST', `/v1/disputes/${dispute.id}/seller-response`, sale.seller, {
      action: 'ACCEPT',
      returnRequired: true,
    });
    expect(await deadlines.expireReturns(new Date(Date.now() + DAY))).toMatchObject({
      changed: 0,
    });
    await deadlines.expireReturns(new Date(Date.now() + 10 * DAY));
    const resolved = await disputeView(sale, sale.seller);
    expect(resolved).toMatchObject({
      status: 'RESOLVED',
      resolution: { outcome: 'SELLER_FAVOR', decidedBy: 'SYSTEM' },
    });
    const order = await waitForOrder(sale.publicId, sale.buyer, 'COMPLETED');
    expect((await sellerBalances(sale.seller)).available.amount).toBe(order.itemsTotal);
    expect(
      await count(
        `select count(*) from shipments where order_id = $1 and direction = 'RETURN' and status = 'CANCELLED'`,
        [sale.orderId],
      ),
    ).toBe(1);
  });

  it('zakwestionowany zwrot wraca do Biddy, a decyzja nie może żądać drugiego odesłania', async () => {
    const sale = await deliveredSale();
    const dispute = await openDispute(sale);
    await escalated(sale, dispute);
    const decided = await call('POST', `/v1/admin/disputes/${dispute.id}/decision`, staff, {
      outcome: 'FULL_REFUND',
      fault: 'SELLER',
      returnRequired: true,
      statement: 'Przedmiot niezgodny z opisem; zwrot pieniędzy po odesłaniu lampy.',
    });
    expect(decided.statusCode, decided.body).toBe(200);
    expect(decided.json<DisputeView>().status).toBe('AWAITING_RETURN');
    await waitForNotifications(sale.seller, ['DISPUTE_RETURN_REQUESTED']);
    await call('POST', `/v1/disputes/${dispute.id}/return-shipment`, sale.buyer, {
      sender: {
        name: 'Jan Kupujący',
        phone: '600 700 800',
        address: { street: 'ul. Długa 5', postalCode: '30-001', city: 'Kraków' },
      },
      dispatchMethod: 'DROP_OFF',
    });
    const parcelId = await createdParcel(sale.orderId, 'RETURN');
    await advance(parcelId, 'posted', 'delivered');
    await waitFor(
      async () => (await disputeView(sale, sale.seller)).status === 'RETURN_DELIVERED' || undefined,
      'zwrot dostarczony',
    );
    const short = await call('POST', `/v1/disputes/${dispute.id}/return-review`, sale.seller, {
      accept: false,
      note: 'Zła',
    });
    expect(short.statusCode).toBe(400);
    const contested = await call('POST', `/v1/disputes/${dispute.id}/return-review`, sale.seller, {
      accept: false,
      note: 'W paczce przyszła inna lampa niż wysłana.',
      mediaIds: [await evidencePhoto(sale.seller)],
    });
    expect(contested.statusCode, contested.body).toBe(200);
    expect(contested.json<DisputeView>().status).toBe('ESCALATED');

    const secondReturn = await call('POST', `/v1/admin/disputes/${dispute.id}/decision`, staff, {
      outcome: 'FULL_REFUND',
      fault: 'SELLER',
      returnRequired: true,
      statement: 'Ponowne odesłanie przedmiotu po zakwestionowaniu zwrotu.',
    });
    expect(secondReturn.statusCode).toBe(400);
    const sellerFavor = await call('POST', `/v1/admin/disputes/${dispute.id}/decision`, staff, {
      outcome: 'SELLER_FAVOR',
      statement: 'Numer seryjny odesłanej lampy jest inny niż na zdjęciach z aukcji.',
    });
    expect(sellerFavor.statusCode, sellerFavor.body).toBe(200);
    await waitForOrder(sale.publicId, sale.buyer, 'COMPLETED');
    expect(await balance('buyer_funds_held', sale.orderId)).toBe(0);
    expect(await count(`select count(*) from strikes where user_id = $1`, [sale.seller.id])).toBe(
      0,
    );
  });
});

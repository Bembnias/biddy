// Kryteria F-26 na prawdziwym Postgresie, Redisie i magazynie S3: API nasłuchuje na porcie,
// a worker w procesie testu rozlicza płatności i zwroty FakeGateway (webhooki HTTP), tworzy
// przesyłki u FakeShipping i wykonuje konsumentów eventów. Automat FakeShipping stoi (długie
// opóźnienie), a test prowadzi statusy przesyłki ręcznie przez symulator: każdy status idzie
// prawdziwą ścieżką webhook → synchronizacja → ShipmentStatusChanged → cykl zamówienia.
import type { LightMyRequestResponse } from 'fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId } from '../../src/infra/db/index.js';
import { JobQueues } from '../../src/infra/queues/index.js';
import { OrderNotificationSources } from '../../src/modules/notifications/notifications/order-notification-sources.js';
import { AuctionClosingService } from '../../src/modules/auctions/index.js';
import {
  canTransition,
  ORDER_STATUSES,
  OrderLifecycle,
  OrderPaymentLifecycle,
  SecondChanceService,
} from '../../src/modules/orders/index.js';
import { LedgerService } from '../../src/modules/ledger/index.js';
import { FAKE_BLIK_CODES } from '../../src/modules/payments/index.js';
import { FakeShippingSimulator } from '../../src/modules/shipping/adapters/fake/fake-shipping-simulator.js';
import type { FakeParcelStatus } from '../../src/modules/shipping/db/fake-shipping.schema.js';
import { CarrierClaimService } from '../../src/modules/shipping/index.js';
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

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

let database: ScratchDatabase;
let pool: Pool;
let s3: TestS3;
let api: TestApp;
let worker: TestWorker;
let lifecycle: OrderLifecycle;
let simulator: FakeShippingSimulator;
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
    // Automat FakeShipping nie rusza sam: statusy prowadzi test (symulator).
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
  lifecycle = api.app.get(OrderLifecycle);
  simulator = api.app.get(FakeShippingSimulator);
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
  readonly auctionId: string;
  readonly orderId: string;
  readonly publicId: string;
  readonly seller: TestUser;
  readonly buyer: TestUser;
}

/** Opublikowana aukcja (Kup teraz 120 zł) z przedmiotem gotowym do wysyłki. */
async function publishedAuction(seller: TestUser, buyNowPrice: number | null): Promise<string> {
  const created = await call('POST', '/v1/auctions', seller);
  expect(created.statusCode, created.body).toBe(201);
  const { id } = created.json<{ id: string }>();
  const { rows } = await pool.query<{ id: string }>(
    `select id from categories where slug = 'dekoracje'`,
  );
  const patched = await call('PATCH', `/v1/auctions/${id}`, seller, {
    mediaIds: [await readyPhoto(seller)],
    categoryId: rows[0]?.id,
    title: 'Wazon ceramiczny, lata 70.',
    description: 'Ręcznie malowany wazon, bez pęknięć i odprysków. Wysokość 30 cm.',
    condition: 'VERY_GOOD',
    packageSize: 'M',
    allowedCarriers: ['inpost-paczkomat', 'inpost-kurier'],
    startPrice: 2_000,
    buyNowPrice,
    durationDays: 7,
  });
  expect(patched.statusCode, patched.body).toBe(200);
  const published = await call('POST', `/v1/auctions/${id}/publish`, seller, {
    kycNoticeAccepted: true,
  });
  expect(published.statusCode, published.body).toBe(200);
  return id;
}

async function activeOrder(auctionId: string): Promise<{ id: string; publicId: string }> {
  const { rows } = await pool.query<{ id: string; public_id: string }>(
    `select o.id, o.public_id from orders o join order_items i on i.order_id = o.id
     where i.auction_id = $1 and i.is_active`,
    [auctionId],
  );
  return { id: rows[0]?.id ?? '', publicId: rows[0]?.public_id ?? '' };
}

/** Zamówienie z Kup teraz (AWAITING_PAYMENT). */
async function sale(): Promise<Sale> {
  const seller = await createUser(api, pool, { name: 'Sprzedawca Cyklu' });
  const buyer = await createUser(api, pool, { name: 'Kupujący Cyklu' });
  const auctionId = await publishedAuction(seller, 12_000);
  const bought = await call('POST', `/v1/auctions/${auctionId}/buy-now`, buyer, undefined, {
    'idempotency-key': `lifecycle-${newId()}`,
  });
  expect(bought.statusCode, bought.body).toBe(201);
  const order = await activeOrder(auctionId);
  return { auctionId, orderId: order.id, publicId: order.publicId, seller, buyer };
}

interface OrderView {
  status: string;
  role: string;
  title: string;
  itemsTotal: number;
  pokFee: number;
  shippingFee: number | null;
  total: number;
  paymentDueAt: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  inspectionEndsAt: string | null;
  buyerConfirmedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  lostAt: string | null;
  refundedAt: string | null;
  compensation: { dueAt: string; paidAt: string | null } | null;
  onHold: boolean;
  fromSecondChance: boolean;
  counterpart: { name: string };
  shipment: { status: string; trackingNumber: string | null; events: unknown[] } | null;
  refund: { amount: number; reason: string; status: string } | null;
  actions: {
    confirmReceipt: boolean;
    reportNotReceived: { availableAt: string; allowed: boolean } | null;
  };
  secondChance: {
    next: { bidder: string; amount: number } | null;
    offers: {
      id: string;
      bidder: string;
      amount: number;
      status: string;
      orderPublicId: string | null;
    }[];
    unavailableReason: string | null;
    sendBy: string | null;
  } | null;
}

async function view(order: { publicId: string }, user: TestUser): Promise<OrderView> {
  const response = await call('GET', `/v1/orders/${order.publicId}`, user);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<OrderView>();
}

function waitForOrder(order: Sale, status: string, timeoutMs = 20_000) {
  return waitFor(
    async () => {
      const current = await view(order, order.buyer);
      return current.status === status ? current : undefined;
    },
    `zamówienie ${order.publicId} w stanie ${status}`,
    timeoutMs,
  );
}

/** Opłacone zamówienie: paczkomat (punkt decyduje o scenariuszu FakeShipping) i BLIK 777123. */
async function paidSale(pickupPointId = 'inpost-paczkomat-01'): Promise<Sale> {
  const order = await sale();
  const chosen = await call('PUT', `/v1/orders/${order.publicId}/delivery`, order.buyer, {
    carrierId: 'inpost-paczkomat',
    pickupPointId,
    recipient: { name: 'Jan Kupujący', phone: '600 700 800' },
  });
  expect(chosen.statusCode, chosen.body).toBe(200);
  const total = chosen.json<{ order: { total: number } }>().order.total;
  const paid = await call(
    'POST',
    `/v1/orders/${order.publicId}/payments`,
    order.buyer,
    { method: 'BLIK', blikCode: FAKE_BLIK_CODES.SUCCEED, expectedTotal: total },
    { 'idempotency-key': newId() },
  );
  expect(paid.statusCode, paid.body).toBe(201);
  await waitForOrder(order, 'PAID');
  return order;
}

/** „Nadaj” i przesyłka CREATED u FakeShipping; zwraca ID paczki w symulatorze. */
async function dispatched(order: Sale): Promise<string> {
  const response = await call('POST', `/v1/orders/${order.publicId}/shipment`, order.seller, {
    sender: {
      name: 'Anna Sprzedająca',
      phone: '500 600 700',
      address: { street: 'ul. Prosta 1', postalCode: '00-001', city: 'Warszawa' },
    },
    dispatchMethod: 'DROP_OFF',
  });
  expect(response.statusCode, response.body).toBe(202);
  return waitFor(async () => {
    const { rows } = await pool.query<{ status: string; provider_shipment_id: string | null }>(
      `select status, provider_shipment_id from shipments where order_id = $1 and status <> 'CANCELLED'`,
      [order.orderId],
    );
    const row = rows[0];
    return row?.status === 'CREATED' && row.provider_shipment_id !== null
      ? row.provider_shipment_id
      : undefined;
  }, 'przesyłka utworzona u FakeShipping');
}

/** Status paczki w symulatorze: webhook, synchronizacja i event jak u dostawcy. */
async function advance(parcelId: string, ...statuses: FakeParcelStatus[]): Promise<void> {
  for (const status of statuses) {
    await simulator.advance(parcelId, { status });
  }
}

/** Saldo dostępne sprzedającego w ledgerze (kwota nieujemna). */
async function available(seller: TestUser): Promise<number> {
  return (await api.app.get(LedgerService).sellerBalances(seller.id)).available.amount;
}

/** Saldo konta ledgera ze znakiem (`subject` null: konto platformy). */
async function balance(code: string, subject: string | null): Promise<number> {
  const { rows } = await pool.query<{ balance: string }>(
    `select balance from ledger_accounts where code = $1 and subject is not distinct from $2`,
    [code, subject],
  );
  return Number(rows[0]?.balance ?? 0);
}

async function notificationTypes(user: TestUser): Promise<string[]> {
  const { rows } = await pool.query<{ type: string }>(
    `select type from notifications where user_id = $1 order by created_at`,
    [user.id],
  );
  return rows.map((row) => row.type);
}

function waitForNotifications(user: TestUser, types: readonly string[]) {
  return waitFor(
    async () => {
      const current = await notificationTypes(user);
      return types.every((type) => current.includes(type)) ? current : undefined;
    },
    `powiadomienia ${types.join(', ')}`,
  );
}

describe('maszyna stanów (kryterium 1)', () => {
  it('trigger w bazie przepuszcza dokładnie pary z §7.3', async () => {
    const results: string[] = [];
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        if (from === to) {
          continue;
        }
        const id = newId();
        await pool.query(
          `insert into orders (id, public_id, buyer_id, seller_id, status, currency, items_total,
             pok_fee, pok_vat, total, fee_schedule_id, payment_due_at)
           values ($1, $2, $3, $4, $5, 'PLN', 1000, 100, 19, 1100, $6, now())`,
          [id, id.slice(-8).toUpperCase(), newId(), newId(), from, newId()],
        );
        const allowed = await pool
          .query(`update orders set status = $2 where id = $1`, [id, to])
          .then(
            () => true,
            (error: unknown) => {
              expect(String(error)).toContain('Niedozwolone przejście zamówienia');
              return false;
            },
          );
        if (allowed !== canTransition(from, to)) {
          results.push(`${from} → ${to}: baza ${String(allowed)}`);
        }
      }
    }
    expect(results).toEqual([]);
  });
});

describe('nadanie, odbiór i zakończenie (kryteria 2–4)', () => {
  it('nadanie i odbiór z trackingu; „Wszystko OK” zwalnia środki raz; strony widzą zamówienie', async () => {
    const order = await paidSale();
    const stranger = await createUser(api, pool);
    expect((await call('GET', `/v1/orders/${order.publicId}`, stranger)).statusCode).toBe(404);
    const parcelId = await dispatched(order);

    await advance(parcelId, 'posted');
    const shipped = await waitForOrder(order, 'SHIPPED');
    expect(shipped.shippedAt).not.toBeNull();
    expect(shipped.actions.reportNotReceived).toMatchObject({ allowed: false });

    await advance(parcelId, 'in_transit', 'awaiting_pickup', 'delivered');
    const delivered = await waitForOrder(order, 'DELIVERED');
    const window = Date.parse(delivered.inspectionEndsAt ?? '') - Date.now();
    expect(window).toBeGreaterThan(35 * HOUR);
    expect(window).toBeLessThanOrEqual(36 * HOUR);
    expect(delivered.actions.confirmReceipt).toBe(true);
    expect(delivered.counterpart.name).toBe('Sprzedawca Cyklu');

    const asSeller = await view(order, order.seller);
    expect(asSeller).toMatchObject({ role: 'SELLER', actions: { confirmReceipt: false } });
    const sellerConfirm = await call(
      'POST',
      `/v1/orders/${order.publicId}/confirm-receipt`,
      order.seller,
    );
    expect(sellerConfirm.statusCode).toBe(404);

    const [first, second] = await Promise.all([
      call('POST', `/v1/orders/${order.publicId}/confirm-receipt`, order.buyer),
      call('POST', `/v1/orders/${order.publicId}/confirm-receipt`, order.buyer),
    ]);
    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    const completed = first.json<OrderView>();
    expect(completed.status).toBe('COMPLETED');
    expect(completed.buyerConfirmedAt).not.toBeNull();
    expect(await lifecycle.completeInspected(new Date(Date.now() + 2 * DAY))).toMatchObject({
      changed: 0,
    });

    expect(await balance('buyer_funds_held', order.orderId)).toBe(0);
    expect(await available(order.seller)).toBe(completed.itemsTotal);
    expect(
      await count(
        `select count(*) from ledger_transactions where type = 'ORDER_COMPLETED' and order_id = $1`,
        [order.orderId],
      ),
    ).toBe(1);
    await waitFor(async () => {
      const { rows } = await pool.query<{ status: string }>(
        `select status from fund_releases where order_id = $1`,
        [order.orderId],
      );
      return rows[0]?.status === 'NOT_REQUIRED' ? rows[0] : undefined;
    }, 'zwolnienie środków u operatora');
    await waitFor(async () => {
      const { rows } = await pool.query<{ completed_at: Date | null }>(
        `select completed_at from trade_records where order_id = $1`,
        [order.orderId],
      );
      return rows[0]?.completed_at ?? undefined;
    }, 'historia zakończonych zamówień');
    await waitForNotifications(order.buyer, ['ORDER_SHIPPED', 'ORDER_DELIVERED']);
    await waitForNotifications(order.seller, ['ORDER_PAID', 'ORDER_COMPLETED']);
  });

  it('auto-zakończenie po 36 h; otwarty chargeback wstrzymuje zakończenie i „Wszystko OK”', async () => {
    const order = await paidSale();
    const parcelId = await dispatched(order);
    await advance(parcelId, 'posted', 'in_transit', 'awaiting_pickup', 'delivered');
    await waitForOrder(order, 'DELIVERED');

    await pool.query(`update orders set chargeback_status = 'OPEN' where id = $1`, [order.orderId]);
    const onHold = await call('POST', `/v1/orders/${order.publicId}/confirm-receipt`, order.buyer);
    expect(problemOf(onHold).code).toBe('ORDER_ON_HOLD');
    const later = new Date(Date.now() + 37 * HOUR);
    await lifecycle.completeInspected(later);
    expect((await view(order, order.buyer)).status).toBe('DELIVERED');
    expect((await view(order, order.buyer)).onHold).toBe(true);

    await pool.query(`update orders set chargeback_status = 'WON' where id = $1`, [order.orderId]);
    expect(await lifecycle.completeInspected(new Date())).toMatchObject({ changed: 0 });
    expect(await lifecycle.completeInspected(later)).toMatchObject({ changed: 1 });
    const completed = await view(order, order.buyer);
    expect(completed).toMatchObject({ status: 'COMPLETED', buyerConfirmedAt: null });
    expect(await balance('buyer_funds_held', order.orderId)).toBe(0);
    expect(await available(order.seller)).toBe(completed.itemsTotal);
  });
});

describe('nienadane w terminie (kryterium 7)', () => {
  it('anulowanie z pełnym zwrotem, strike sprzedającego i REFUNDED po potwierdzeniu operatora', async () => {
    const order = await paidSale();
    const notYet = await call(
      'POST',
      `/v1/orders/${order.publicId}/report-not-received`,
      order.buyer,
    );
    expect(problemOf(notYet).code).toBe('ORDER_NOT_SHIPPED_YET');
    expect(await lifecycle.expireUnshipped(new Date())).toMatchObject({ changed: 0 });

    await pool.query(`update orders set ship_by = now() - interval '1 minute' where id = $1`, [
      order.orderId,
    ]);
    expect(await lifecycle.expireUnshipped(new Date())).toMatchObject({ changed: 1 });
    const cancelled = await view(order, order.buyer);
    expect(cancelled).toMatchObject({
      status: 'CANCELLED_NOT_SHIPPED',
      refund: { reason: 'NOT_SHIPPED' },
    });
    expect(
      await count(`select count(*) from shipments where order_id = $1 and status = 'CANCELLED'`, [
        order.orderId,
      ]),
    ).toBe(1);

    const refunded = await waitForOrder(order, 'REFUNDED');
    expect(refunded.refund).toMatchObject({ status: 'SUCCEEDED', amount: refunded.total });
    expect(refunded.cancelledAt).not.toBeNull();
    expect(await balance('buyer_funds_held', order.orderId)).toBe(0);
    await waitFor(
      async () =>
        (
          await pool.query(`select 1 from strikes where source_key = $1 and user_id = $2`, [
            `NOT_SHIPPED:${order.orderId}`,
            order.seller.id,
          ])
        ).rowCount === 1,
      'strike NOT_SHIPPED sprzedającego',
    );
    await waitForNotifications(order.buyer, ['ORDER_CANCELLED', 'ORDER_REFUNDED']);
    await waitForNotifications(order.seller, ['ORDER_CANCELLED', 'STRIKE_ISSUED']);
  });

  it('przesyłka utworzona u dostawcy: najpierw tracking; nadana przed chwilą nie jest anulowana', async () => {
    const order = await paidSale();
    const parcelId = await dispatched(order);
    // Paczka nadana, ale webhook nie dotarł: job sprawdza stan u dostawcy przed anulowaniem.
    await simulator.advance(parcelId, { status: 'posted', deliverWebhook: false });
    await pool.query(`update orders set ship_by = now() - interval '1 minute' where id = $1`, [
      order.orderId,
    ]);
    expect(await lifecycle.expireUnshipped(new Date())).toMatchObject({ changed: 0 });
    await waitForOrder(order, 'SHIPPED');

    const unsent = await paidSale();
    await dispatched(unsent);
    await pool.query(`update orders set ship_by = now() - interval '1 minute' where id = $1`, [
      unsent.orderId,
    ]);
    expect(await lifecycle.expireUnshipped(new Date())).toMatchObject({ changed: 1 });
    expect((await view(unsent, unsent.seller)).shipment).toBeNull();
    await waitForOrder(unsent, 'REFUNDED');
  });
});

describe('nieodebrana paczka (kryterium 8)', () => {
  it('NOT_PICKED_UP bez zwrotu; po RETURNED zwrot ceny i POK bez dostawy, potem REFUNDED', async () => {
    const order = await paidSale('inpost-paczkomat-NOPICKUP');
    const parcelId = await dispatched(order);
    await advance(parcelId, 'posted', 'in_transit', 'awaiting_pickup', 'return_expired');
    const waiting = await waitForOrder(order, 'NOT_PICKED_UP');
    expect(waiting.refund).toBeNull();
    await waitForNotifications(order.seller, ['ORDER_NOT_PICKED_UP']);

    await advance(parcelId, 'returned');
    const refunded = await waitForOrder(order, 'REFUNDED');
    const shipping = refunded.shippingFee ?? 0;
    expect(shipping).toBeGreaterThan(0);
    expect(refunded.refund).toMatchObject({
      reason: 'NOT_PICKED_UP',
      status: 'SUCCEEDED',
      amount: refunded.itemsTotal + refunded.pokFee,
    });
    expect(await balance('buyer_funds_held', order.orderId)).toBe(0);
    expect(
      await count(
        `select count(*) from ledger_transactions where type = 'NOT_PICKED_UP_REFUNDED' and order_id = $1`,
        [order.orderId],
      ),
    ).toBe(1);
    await waitFor(
      async () =>
        (
          await pool.query(`select 1 from strikes where source_key = $1`, [
            `NOT_COLLECTED:${order.orderId}`,
          ])
        ).rowCount === 1,
      'strike za nieodebraną paczkę',
    );
  });
});

describe('zaginiona paczka (kryterium 9)', () => {
  it('zgłoszenie braku paczki po 14 dniach: LOST, reklamacja, pełny zwrot i rekompensata po rozstrzygnięciu', async () => {
    const order = await paidSale('inpost-paczkomat-LOST');
    const parcelId = await dispatched(order);
    await advance(parcelId, 'posted', 'in_transit');
    await waitForOrder(order, 'SHIPPED');

    const early = await call(
      'POST',
      `/v1/orders/${order.publicId}/report-not-received`,
      order.buyer,
    );
    expect(problemOf(early)).toMatchObject({ code: 'NOT_RECEIVED_TOO_EARLY' });
    expect(problemOf(early)).toHaveProperty('availableAt');

    await pool.query(`update orders set shipped_at = now() - interval '15 days' where id = $1`, [
      order.orderId,
    ]);
    expect((await view(order, order.buyer)).actions.reportNotReceived).toMatchObject({
      allowed: true,
    });
    const asSeller = await call(
      'POST',
      `/v1/orders/${order.publicId}/report-not-received`,
      order.seller,
    );
    expect(asSeller.statusCode).toBe(404);
    const reported = await call(
      'POST',
      `/v1/orders/${order.publicId}/report-not-received`,
      order.buyer,
    );
    expect(reported.statusCode, reported.body).toBe(200);
    expect(reported.json<OrderView>()).toMatchObject({
      status: 'LOST',
      refund: { reason: 'LOST' },
    });
    const again = await call(
      'POST',
      `/v1/orders/${order.publicId}/report-not-received`,
      order.buyer,
    );
    expect(again.statusCode).toBe(200);

    const { rows: claims } = await pool.query<{ id: string; claimed_amount: string }>(
      `select c.id, c.claimed_amount from carrier_claims c join shipments s on s.id = c.shipment_id
       where s.order_id = $1`,
      [order.orderId],
    );
    expect(claims).toHaveLength(1);
    const refunded = await waitForOrder(order, 'REFUNDED');
    expect(Number(claims[0]?.claimed_amount)).toBe(refunded.itemsTotal);
    expect(refunded.refund).toMatchObject({ amount: refunded.total, status: 'SUCCEEDED' });
    expect(await balance('buyer_funds_held', order.orderId)).toBe(0);
    expect((await view(order, order.seller)).compensation).toMatchObject({ paidAt: null });

    const recovered = Math.floor(refunded.itemsTotal / 2);
    await api.app
      .get(CarrierClaimService)
      .resolve(claims[0]?.id ?? '', { status: 'ACCEPTED', recoveredAmount: recovered });
    const compensated = await waitFor(async () => {
      const current = await view(order, order.seller);
      return current.compensation?.paidAt === null ? undefined : current;
    }, 'rekompensata po rozstrzygnięciu reklamacji');
    expect(compensated.compensation?.paidAt).not.toBeNull();
    expect(await available(order.seller)).toBe(refunded.itemsTotal);
    expect(await balance('carrier_claims_receivable', null)).toBe(0);
    expect(
      await count(
        `select count(*) from ledger_transactions where type = 'CARRIER_CLAIM_SETTLED' and order_id = $1`,
        [order.orderId],
      ),
    ).toBe(1);
    await waitForNotifications(order.seller, ['ORDER_LOST']);
  });

  it('bez rozstrzygnięcia reklamacji rekompensata po 30 dniach (job); po odbiorze zgłoszenie 409', async () => {
    const order = await paidSale('inpost-paczkomat-LOST');
    const parcelId = await dispatched(order);
    await advance(parcelId, 'posted');
    await waitForOrder(order, 'SHIPPED');
    await pool.query(`update orders set shipped_at = now() - interval '15 days' where id = $1`, [
      order.orderId,
    ]);
    const reported = await call(
      'POST',
      `/v1/orders/${order.publicId}/report-not-received`,
      order.buyer,
    );
    expect(reported.statusCode, reported.body).toBe(200);
    expect(await lifecycle.compensateLost(new Date())).toMatchObject({ changed: 0 });
    expect(await lifecycle.compensateLost(new Date(Date.now() + 31 * DAY))).toMatchObject({
      changed: 1,
    });
    expect((await view(order, order.seller)).compensation?.paidAt).not.toBeNull();
    expect(await available(order.seller)).toBe(reported.json<OrderView>().itemsTotal);

    const delivered = await paidSale();
    const deliveredParcel = await dispatched(delivered);
    await advance(deliveredParcel, 'posted', 'in_transit', 'awaiting_pickup', 'delivered');
    await waitForOrder(delivered, 'DELIVERED');
    const finished = await call(
      'POST',
      `/v1/orders/${delivered.publicId}/report-not-received`,
      delivered.buyer,
    );
    expect(problemOf(finished).code).toBe('SHIPMENT_FINISHED');
  });
});

describe('druga szansa i przypomnienia (kryteria 5, 6)', () => {
  /** Aukcja zakończona licytacją trzech osób: zwycięzca i dwóch kandydatów. */
  async function contested() {
    const seller = await createUser(api, pool, { name: 'Sprzedawca Drugiej Szansy' });
    const winner = await createUser(api, pool, { name: 'Zwycięzca Niepłacący' });
    const second = await createUser(api, pool, { name: 'Karolina Druga' });
    const third = await createUser(api, pool, { name: 'Tomasz Trzeci' });
    const auctionId = await publishedAuction(seller, null);
    let key = 0;
    for (const [user, maxAmount] of [
      [third, 3_000],
      [second, 4_500],
      [winner, 6_000],
    ] as const) {
      key += 1;
      const placed = await call(
        'POST',
        `/v1/auctions/${auctionId}/bids`,
        user,
        { maxAmount },
        {
          'idempotency-key': `sc-${auctionId}-${String(key)}`,
        },
      );
      expect(placed.statusCode, placed.body).toBe(201);
    }
    await pool.query(`update auctions set ends_at = now() - interval '1 second' where id = $1`, [
      auctionId,
    ]);
    await api.app.get(AuctionClosingService).close(auctionId);
    const order = await activeOrder(auctionId);
    const sale: Sale = {
      auctionId,
      orderId: order.id,
      publicId: order.publicId,
      seller,
      buyer: winner,
    };
    return { sale, seller, winner, second, third };
  }

  it('przypomnienia o płatności tylko dla nieopłaconego; po anulowaniu oferta do kolejnych licytujących', async () => {
    const { sale: order, seller, winner, second, third } = await contested();
    const { rows: candidates } = await pool.query<{ runner_ups: unknown }>(
      `select runner_ups from order_items where order_id = $1`,
      [order.orderId],
    );
    expect(candidates[0]?.runner_ups).toEqual([
      { bidderId: second.id, maxAmount: 4_500 },
      { bidderId: third.id, maxAmount: 3_000 },
    ]);

    // Konsument OrderCreated planuje trzy przypomnienia: 1 h, 12 h i 20 h po utworzeniu.
    const queue = api.app.get(JobQueues).queue('notifications');
    const scheduled = await waitFor(async () => {
      const jobs = await queue.getJobs(['delayed']);
      const mine = jobs.filter(
        (job) => (job.data as { orderId?: string }).orderId === order.orderId,
      );
      return mine.length === 3 ? mine : undefined;
    }, 'trzy przypomnienia o płatności');
    const { rows: orderRows } = await pool.query<{ created_at: Date }>(
      `select created_at from orders where id = $1`,
      [order.orderId],
    );
    const createdAt = orderRows[0]?.created_at.getTime() ?? 0;
    expect(
      scheduled
        .map((job) => Math.round((job.timestamp + (job.opts.delay ?? 0) - createdAt) / HOUR))
        .sort((a, b) => a - b),
    ).toEqual([1, 12, 20]);

    const reminders = api.app.get(OrderNotificationSources);
    expect(
      await reminders.paymentReminder({ data: { orderId: order.orderId, n: 1 } } as never),
    ).toBe(true);
    expect(await notificationTypes(winner)).toContain('PAYMENT_REMINDER');

    const send = () => call('POST', `/v1/orders/${order.publicId}/second-chance-offers`, seller);
    expect(problemOf(await send())).toMatchObject({
      code: 'SECOND_CHANCE_UNAVAILABLE',
      reason: 'NOT_CANCELLED_UNPAID',
    });
    await pool.query(
      `update orders set payment_due_at = now() - interval '1 minute' where id = $1`,
      [order.orderId],
    );
    await api.app.get(OrderPaymentLifecycle).expireUnpaid(new Date());
    expect(
      await reminders.paymentReminder({ data: { orderId: order.orderId, n: 2 } } as never),
    ).toBe(false);

    const before = await view(order, seller);
    expect(before.secondChance).toMatchObject({
      next: { bidder: 'k***a', amount: 4_500 },
      offers: [],
      unavailableReason: null,
    });
    expect((await view(order, winner)).secondChance).toBeNull();

    const sent = await send();
    expect(sent.statusCode, sent.body).toBe(201);
    const offerToSecond = sent.json<OrderView>().secondChance?.offers[0];
    expect(offerToSecond).toMatchObject({ bidder: 'k***a', amount: 4_500, status: 'PENDING' });
    expect(problemOf(await send())).toMatchObject({ reason: 'OFFER_PENDING' });

    const offerUrl = `/v1/second-chance-offers/${offerToSecond?.id ?? ''}`;
    expect((await call('GET', offerUrl, third)).statusCode).toBe(404);
    const shown = await call('GET', offerUrl, second);
    expect(shown.json()).toMatchObject({
      status: 'PENDING',
      amount: 4_500,
      title: 'Wazon ceramiczny, lata 70.',
    });
    const declined = await call('POST', `${offerUrl}/decline`, second);
    expect(declined.json()).toMatchObject({ status: 'DECLINED' });
    expect(problemOf(await call('POST', `${offerUrl}/accept`, second)).code).toBe(
      'SECOND_CHANCE_CLOSED',
    );

    const toThird = await send();
    expect(toThird.statusCode, toThird.body).toBe(201);
    const offerToThird = toThird
      .json<OrderView>()
      .secondChance?.offers.find((offer) => offer.status === 'PENDING');
    expect(offerToThird).toMatchObject({ bidder: 't***i', amount: 3_000 });
    const thirdUrl = `/v1/second-chance-offers/${offerToThird?.id ?? ''}`;
    const [accepted, repeated] = await Promise.all([
      call('POST', `${thirdUrl}/accept`, third),
      call('POST', `${thirdUrl}/accept`, third),
    ]);
    expect([accepted.statusCode, repeated.statusCode]).toEqual([200, 200]);
    const acceptedOffer = accepted.json<{ status: string; orderPublicId: string }>();
    expect(acceptedOffer.status).toBe('ACCEPTED');
    expect(repeated.json()).toMatchObject({ orderPublicId: acceptedOffer.orderPublicId });

    const newOrder = { publicId: acceptedOffer.orderPublicId };
    const created = await view(newOrder, third);
    expect(created).toMatchObject({
      status: 'AWAITING_PAYMENT',
      itemsTotal: 3_000,
      fromSecondChance: true,
    });
    expect(Math.abs(Date.parse(created.paymentDueAt) - (Date.now() + DAY))).toBeLessThan(60_000);
    expect((await activeOrder(order.auctionId)).publicId).toBe(newOrder.publicId);
    expect((await view(order, seller)).secondChance).toMatchObject({
      unavailableReason: 'NOT_LATEST_ORDER',
    });

    type WonList = { items: { order: { publicId: string; status: string } | null }[] };
    const won = (await call('GET', '/v1/me/bids?status=WON', third)).json<WonList>();
    expect(won.items.map((item) => item.order?.publicId)).toEqual([newOrder.publicId]);
    const winnerWon = (await call('GET', '/v1/me/bids?status=WON', winner)).json<WonList>();
    expect(winnerWon.items.map((item) => [item.order?.publicId, item.order?.status])).toEqual([
      [order.publicId, 'CANCELLED_UNPAID'],
    ]);

    await waitForNotifications(second, ['SECOND_CHANCE_OFFER']);
    await waitForNotifications(seller, ['ORDER_CANCELLED', 'SECOND_CHANCE_ANSWERED']);
    const sellerTypes = await waitFor(async () => {
      const types = await notificationTypes(seller);
      return types.filter((type) => type === 'SECOND_CHANCE_ANSWERED').length === 2
        ? types
        : undefined;
    }, 'dwie odpowiedzi na oferty');
    expect(sellerTypes.filter((type) => type === 'SOLD')).toHaveLength(1);
    expect(await notificationTypes(third)).not.toContain('WON');
  });

  it('oferta wygasa po 24 h; blokada licytowania uniemożliwia akceptację', async () => {
    const { sale: order, seller, second } = await contested();
    await pool.query(
      `update orders set payment_due_at = now() - interval '1 minute' where id = $1`,
      [order.orderId],
    );
    await api.app.get(OrderPaymentLifecycle).expireUnpaid(new Date());
    const sent = await call('POST', `/v1/orders/${order.publicId}/second-chance-offers`, seller);
    const offerId = sent.json<OrderView>().secondChance?.offers[0]?.id ?? '';

    await pool.query(
      `insert into account_blocks (id, user_id, kind, cause, strike_ids, starts_at, ends_at, statement)
       values ($1, $2, 'BIDDING', 'STRIKES', '{}', now(), now() + interval '1 day', 'Test blokady')`,
      [newId(), second.id],
    );
    const blocked = await call('POST', `/v1/second-chance-offers/${offerId}/accept`, second);
    expect(problemOf(blocked).code).toBe('BIDDING_BLOCKED');

    const service = api.app.get(SecondChanceService);
    expect(await service.expire(new Date())).toBe(0);
    expect(await service.expire(new Date(Date.now() + DAY + 60_000))).toBe(1);
    const after = await view(order, seller);
    expect(after.secondChance?.offers[0]?.status).toBe('EXPIRED');
    expect(after.secondChance).toMatchObject({ next: { amount: 3_000 }, unavailableReason: null });
  });
});

// Kryteria F-25 na prawdziwym Postgresie i Redisie: API nasłuchuje na porcie, a worker w procesie
// testu rozlicza płatności FakeGateway, wysyła podpisane webhooki HTTP na endpoint API i wykonuje
// konsumentów eventów (opłacenie zamówienia, zwrot spóźnionej płatności). Zamówienia powstają
// przez Kup teraz (F-16); dostawa i płatność idą przez trasy checkoutu.
import { businessDayDeadline } from '@biddy/shared';
import type { LightMyRequestResponse } from 'fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId } from '../../src/infra/db/index.js';
import { OrderPaymentLifecycle } from '../../src/modules/orders/index.js';
import { FAKE_BLIK_CODES } from '../../src/modules/payments/index.js';
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
let lifecycle: OrderPaymentLifecycle;
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
    // Krótkie, ale niezerowe opóźnienie: webhook nie wyprzedza zapisu odpowiedzi operatora.
    PAYMENTS_FAKE_WEBHOOK_DELAY_MS: '300',
    ...s3.env,
  };
  api = await startTestApp(integrationConfig(shared));
  await api.app.listen(0, '127.0.0.1');
  const webhookUrl = `${await api.app.getUrl()}/v1/webhooks/payments/fake`.replace(
    '[::1]',
    '127.0.0.1',
  );
  worker = await startTestWorker(
    workerConfig(database.url, { ...shared, PAYMENTS_FAKE_WEBHOOK_URL: webhookUrl }),
  );
  lifecycle = api.app.get(OrderPaymentLifecycle);
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

/** Aukcja z Kup teraz (120 zł) kupiona przez nowe konto: zamówienie AWAITING_PAYMENT. */
async function sale(): Promise<Sale> {
  const seller = await createUser(api, pool, { name: 'Sprzedawca Checkoutu' });
  const buyer = await createUser(api, pool, { name: 'Kupujący Checkoutu' });
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
    buyNowPrice: 12_000,
    durationDays: 7,
  });
  expect(patched.statusCode, patched.body).toBe(200);
  const published = await call('POST', `/v1/auctions/${id}/publish`, seller, {
    kycNoticeAccepted: true,
  });
  expect(published.statusCode, published.body).toBe(200);
  const bought = await call('POST', `/v1/auctions/${id}/buy-now`, buyer, undefined, {
    'idempotency-key': `checkout-${newId()}`,
  });
  expect(bought.statusCode, bought.body).toBe(201);
  const order = await pool.query<{ id: string; public_id: string }>(
    `select o.id, o.public_id from orders o join order_items i on i.order_id = o.id
     where i.auction_id = $1 and i.is_active`,
    [id],
  );
  return {
    auctionId: id,
    orderId: order.rows[0]?.id ?? '',
    publicId: order.rows[0]?.public_id ?? '',
    seller,
    buyer,
  };
}

interface Checkout {
  order: {
    status: string;
    itemsTotal: number;
    pokFee: number;
    shippingFee: number | null;
    total: number;
    paymentDueAt: string;
    effectiveDueAt: string;
    paidAt: string | null;
    shipBy: string | null;
  };
  blocker: string | null;
  options: { carrierId: string; price: number; requiresPickupPoint: boolean }[];
  delivery: { carrierId: string; price: number; pickupPoint: { id: string } | null } | null;
  payment: {
    id: string;
    status: string;
    method: string;
    failureReason: string | null;
    redirectUrl: string | null;
    amount: number;
  } | null;
}

async function checkout(order: Sale): Promise<Checkout> {
  const response = await call('GET', `/v1/orders/${order.publicId}/checkout`, order.buyer);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<Checkout>();
}

const recipient = { name: 'Jan Kupujący', phone: '600 700 800' };

function chooseLocker(order: Sale, pickupPointId = 'inpost-paczkomat-01') {
  return call('PUT', `/v1/orders/${order.publicId}/delivery`, order.buyer, {
    carrierId: 'inpost-paczkomat',
    pickupPointId,
    recipient,
  });
}

function pay(
  order: Sale,
  body: Record<string, unknown>,
  key: string = newId(),
): Promise<LightMyRequestResponse> {
  return call('POST', `/v1/orders/${order.publicId}/payments`, order.buyer, body, {
    'idempotency-key': key,
  });
}

function waitForPayment(order: Sale, status: string) {
  return waitFor(async () => {
    const view = await checkout(order);
    return view.payment?.status === status ? view : undefined;
  }, `płatność w stanie ${status}`);
}

function waitForOrder(order: Sale, status: string) {
  return waitFor(async () => {
    const view = await checkout(order);
    return view.order.status === status ? view : undefined;
  }, `zamówienie w stanie ${status}`);
}

const count = async (sql: string, params: unknown[]) =>
  Number((await pool.query<{ count: string }>(sql, params)).rows[0]?.count ?? 0);

describe('widok i wybór dostawy', () => {
  it('tylko kupujący; dostawa zapisuje cenę i sumę; błędy wyboru jak w F-24', async () => {
    const order = await sale();
    const before = await checkout(order);
    expect(before.order).toMatchObject({ status: 'AWAITING_PAYMENT', shippingFee: null });
    expect(before.order.total).toBe(before.order.itemsTotal + before.order.pokFee);
    expect(before.blocker).toBeNull();
    expect(before.delivery).toBeNull();
    expect(before.options.map((option) => option.carrierId).sort()).toEqual([
      'inpost-kurier',
      'inpost-paczkomat',
    ]);

    for (const user of [order.seller, await createUser(api, pool, { name: 'Ktoś Obcy' })]) {
      const other = await call('GET', `/v1/orders/${order.publicId}/checkout`, user);
      expect(other.statusCode).toBe(404);
    }

    const noPoint = await call('PUT', `/v1/orders/${order.publicId}/delivery`, order.buyer, {
      carrierId: 'inpost-paczkomat',
      recipient,
    });
    expect(problemOf(noPoint).code).toBe('PICKUP_POINT_REQUIRED');
    const noAddress = await call('PUT', `/v1/orders/${order.publicId}/delivery`, order.buyer, {
      carrierId: 'inpost-kurier',
      recipient,
    });
    expect(problemOf(noAddress).code).toBe('DELIVERY_ADDRESS_REQUIRED');

    const locker = await chooseLocker(order);
    expect(locker.statusCode, locker.body).toBe(200);
    const price = before.options.find((option) => option.carrierId === 'inpost-paczkomat')?.price;
    expect(locker.json<Checkout>().order).toMatchObject({
      shippingFee: price,
      total: before.order.itemsTotal + before.order.pokFee + (price ?? 0),
    });

    const courier = await call('PUT', `/v1/orders/${order.publicId}/delivery`, order.buyer, {
      carrierId: 'inpost-kurier',
      recipient: {
        ...recipient,
        address: { street: 'ul. Długa 5/12', postalCode: '00238', city: 'Warszawa' },
      },
    });
    expect(courier.statusCode, courier.body).toBe(200);
    const view = courier.json<Checkout>();
    expect(view.delivery).toMatchObject({ carrierId: 'inpost-kurier', pickupPoint: null });
    expect(view.order.total).toBe(
      view.order.itemsTotal + view.order.pokFee + (view.delivery?.price ?? 0),
    );
    expect(
      await count(`select count(*) from shipments where order_id = $1 and status <> 'CANCELLED'`, [
        order.orderId,
      ]),
    ).toBe(1);
  });
});

describe('płatność (kryteria 1–3, 5, 6)', () => {
  it('BLIK 777123: kwota na ekranie = zamówienie = żądanie do operatora; PAID z ship_by i OrderPaid', async () => {
    const order = await sale();
    const noDelivery = await pay(order, {
      method: 'BLIK',
      blikCode: FAKE_BLIK_CODES.SUCCEED,
      expectedTotal: 1,
    });
    expect(problemOf(noDelivery).code).toBe('DELIVERY_REQUIRED');

    const shown = (await chooseLocker(order)).json<Checkout>().order.total;
    const changed = await pay(order, {
      method: 'BLIK',
      blikCode: FAKE_BLIK_CODES.SUCCEED,
      expectedTotal: shown - 1,
    });
    expect(problemOf(changed).code).toBe('CHECKOUT_TOTAL_CHANGED');
    expect(await count(`select count(*) from payments where order_id = $1`, [order.orderId])).toBe(
      0,
    );

    const key = newId();
    const body = { method: 'BLIK', blikCode: FAKE_BLIK_CODES.SUCCEED, expectedTotal: shown };
    const started = await pay(order, body, key);
    expect(started.statusCode, started.body).toBe(201);
    expect(started.json<Checkout>()).toMatchObject({
      blocker: 'PAYMENT_IN_PROGRESS',
      payment: { status: 'PENDING', method: 'BLIK', amount: shown },
    });
    const replay = await pay(order, body, key);
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    const reused = await pay(order, { ...body, method: 'CARD', blikCode: null }, key);
    expect(problemOf(reused).code).toBe('IDEMPOTENCY_KEY_REUSED');
    const second = await pay(order, body);
    expect(problemOf(second).code).toBe('PAYMENT_IN_PROGRESS');
    const otherDelivery = await chooseLocker(order, 'inpost-paczkomat-02');
    expect(problemOf(otherDelivery).code).toBe('PAYMENT_IN_PROGRESS');

    const paid = await waitForOrder(order, 'PAID');
    expect(paid.blocker).toBe('ORDER_NOT_AWAITING_PAYMENT');
    expect(paid.order.paidAt).not.toBeNull();
    expect(paid.order.shipBy).toBe(
      businessDayDeadline(new Date(paid.order.paidAt ?? ''), 5).toISOString(),
    );
    const { rows } = await pool.query<{
      total: string;
      gateway_amount: string;
      seller_amount: string;
      platform_amount: string;
      items_total: string;
    }>(
      `select o.total, o.items_total, g.amount as gateway_amount, g.seller_amount, g.platform_amount
       from orders o join payments p on p.order_id = o.id
       join fake_gateway_payments g on g.id = p.provider_payment_id where o.id = $1`,
      [order.orderId],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.total)).toBe(shown);
    expect(Number(rows[0]?.gateway_amount)).toBe(shown);
    expect(Number(rows[0]?.seller_amount)).toBe(Number(rows[0]?.items_total));
    expect(Number(rows[0]?.seller_amount) + Number(rows[0]?.platform_amount)).toBe(shown);
    expect(
      await count(`select count(*) from outbox where type = 'OrderPaid' and aggregate_id = $1`, [
        order.orderId,
      ]),
    ).toBe(1);

    const again = await pay(order, body);
    expect(problemOf(again).code).toBe('ORDER_NOT_AWAITING_PAYMENT');

    // Strona aukcji i Moje Biddy: status opłacony i kwota bez dostawy (cena + POK), bo te widoki
    // dopisują „+ dostawa”, a `orders.total` po wyborze dostawy ją zawiera.
    const withoutShipping = paid.order.itemsTotal + paid.order.pokFee;
    expect(withoutShipping).toBe(shown - (paid.order.shippingFee ?? 0));
    const mine = await call('GET', `/v1/me/bids/${order.auctionId}`, order.buyer);
    expect(mine.statusCode, mine.body).toBe(200);
    expect(mine.json<{ order: { status: string; total: number } }>().order).toMatchObject({
      status: 'PAID',
      total: withoutShipping,
    });
    const list = await call('GET', '/v1/me/bids?status=WON', order.buyer);
    expect(list.statusCode, list.body).toBe(200);
    expect(
      list.json<{ items: { order: { status: string; total: number } | null }[] }>().items[0]?.order,
    ).toMatchObject({ status: 'PAID', total: withoutShipping });
  });

  it('odrzucony BLIK: ponowienie w tym samym zamówieniu kończy się opłaceniem', async () => {
    const order = await sale();
    const total = (await chooseLocker(order)).json<Checkout>().order.total;
    const declined = await pay(order, {
      method: 'BLIK',
      blikCode: FAKE_BLIK_CODES.DECLINE,
      expectedTotal: total,
    });
    expect(declined.statusCode, declined.body).toBe(201);
    const failed = await waitForPayment(order, 'FAILED');
    expect(failed.payment?.failureReason).toBe('DECLINED');
    expect(failed.blocker).toBeNull();

    const retried = await pay(order, {
      method: 'BLIK',
      blikCode: FAKE_BLIK_CODES.SUCCEED,
      expectedTotal: total,
    });
    expect(retried.statusCode, retried.body).toBe(201);
    await waitForOrder(order, 'PAID');
    const { rows } = await pool.query<{ status: string }>(
      `select status from payments where order_id = $1 order by created_at`,
      [order.orderId],
    );
    expect(rows.map((row) => row.status)).toEqual(['FAILED', 'SUCCEEDED']);
  });

  it('przekierowanie: płatność kartą ma adres strony operatora z powrotem na checkout', async () => {
    const order = await sale();
    const total = (await chooseLocker(order)).json<Checkout>().order.total;
    const started = await pay(order, { method: 'CARD', expectedTotal: total });
    expect(started.statusCode, started.body).toBe(201);
    const payment = started.json<Checkout>().payment;
    expect(payment?.status).toBe('PENDING');
    expect(payment?.redirectUrl).toMatch(/\/dev\/fake-pay\//u);
    const { rows } = await pool.query<{ return_url: string }>(
      `select g.return_url from payments p join fake_gateway_payments g
       on g.id = p.provider_payment_id where p.id = $1`,
      [payment?.id],
    );
    expect(rows[0]?.return_url).toMatch(new RegExp(`/zamowienia/${order.publicId}/zaplac$`, 'u'));
  });

  it('dwa równoległe „Zapłać” z różnymi kluczami dają jedną płatność', async () => {
    const order = await sale();
    const total = (await chooseLocker(order)).json<Checkout>().order.total;
    const body = { method: 'BLIK', blikCode: FAKE_BLIK_CODES.HANG, expectedTotal: total };
    const responses = await Promise.all([pay(order, body), pay(order, body), pay(order, body)]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409, 409]);
    expect(await count(`select count(*) from payments where order_id = $1`, [order.orderId])).toBe(
      1,
    );
  });
});

describe('termin płatności (kryteria 4, 7, 8)', () => {
  it('po terminie 409; płatność w toku przedłuża anulowanie o 30 min; spóźniona udana płatność wraca w całości', async () => {
    const order = await sale();
    const total = (await chooseLocker(order)).json<Checkout>().order.total;
    const pending = await pay(order, {
      method: 'BLIK',
      blikCode: FAKE_BLIK_CODES.HANG,
      expectedTotal: total,
    });
    expect(pending.statusCode, pending.body).toBe(201);
    const paymentId = pending.json<Checkout>().payment?.id;

    const dueAt = new Date(Date.now() + 1_000);
    await pool.query(`update orders set payment_due_at = $2 where id = $1`, [order.orderId, dueAt]);
    const afterDue = new Date(dueAt.getTime() + 60_000);
    await lifecycle.expireUnpaid(afterDue);
    const extended = await checkout(order);
    expect(extended.order.status).toBe('AWAITING_PAYMENT');
    expect(extended.order.effectiveDueAt).toBe(
      new Date(dueAt.getTime() + 30 * 60_000).toISOString(),
    );

    await lifecycle.expireUnpaid(new Date(dueAt.getTime() + 31 * 60_000));
    const cancelled = await checkout(order);
    expect(cancelled.order.status).toBe('CANCELLED_UNPAID');
    expect(cancelled.delivery).toBeNull();
    const event = await pool.query<{ payload: { reason: string; paymentPending: boolean } }>(
      `select payload from outbox where type = 'OrderCancelled' and aggregate_id = $1`,
      [order.orderId],
    );
    expect(event.rows.map((row) => row.payload)).toEqual([
      expect.objectContaining({ reason: 'UNPAID', paymentPending: true }),
    ]);
    const late = await pay(order, {
      method: 'BLIK',
      blikCode: FAKE_BLIK_CODES.SUCCEED,
      expectedTotal: total,
    });
    expect(problemOf(late).code).toBe('ORDER_NOT_AWAITING_PAYMENT');

    // Bank jednak potwierdza wiszącą płatność: webhook po anulowaniu → pełny zwrot.
    const { rows } = await pool.query<{ provider_payment_id: string }>(
      `select provider_payment_id from payments where id = $1`,
      [paymentId],
    );
    const completed = await call(
      'POST',
      `/v1/dev/fake-gateway/payments/${rows[0]?.provider_payment_id ?? ''}/complete`,
      undefined,
      { outcome: 'SUCCEEDED' },
    );
    expect(completed.statusCode, completed.body).toBe(200);
    const refund = await waitFor(async () => {
      const result = await pool.query<{ status: string; reason: string; amount: string }>(
        `select status, reason, amount from refunds where payment_id = $1`,
        [paymentId],
      );
      return result.rows[0]?.status === 'SUCCEEDED' ? result.rows[0] : undefined;
    }, 'zwrot spóźnionej płatności');
    expect(refund).toMatchObject({ reason: 'LATE_PAYMENT' });
    expect(Number(refund.amount)).toBe(total);
    const held = await pool.query<{ balance: string }>(
      `select balance from ledger_accounts where code = 'buyer_funds_held' and subject = $1`,
      [order.orderId],
    );
    expect(Number(held.rows[0]?.balance)).toBe(0);
    expect(
      await count(
        `select count(*) from ledger_transactions where type = 'ORDER_REFUNDED' and order_id = $1`,
        [order.orderId],
      ),
    ).toBe(1);
    expect((await checkout(order)).order.status).toBe('CANCELLED_UNPAID');
  });

  it('bez płatności w toku: anulowanie zaraz po terminie, a nowa płatność i dostawa po terminie 409', async () => {
    const order = await sale();
    const total = (await chooseLocker(order)).json<Checkout>().order.total;
    await pool.query(
      `update orders set payment_due_at = now() - interval '1 minute' where id = $1`,
      [order.orderId],
    );
    const tooLate = await pay(order, {
      method: 'BLIK',
      blikCode: FAKE_BLIK_CODES.SUCCEED,
      expectedTotal: total,
    });
    expect(problemOf(tooLate).code).toBe('PAYMENT_DEADLINE_PASSED');
    expect(problemOf(await chooseLocker(order)).code).toBe('PAYMENT_DEADLINE_PASSED');
    expect((await checkout(order)).blocker).toBe('PAYMENT_DEADLINE_PASSED');

    const report = await lifecycle.expireUnpaid(new Date());
    expect(report.cancelled).toBeGreaterThanOrEqual(1);
    expect((await checkout(order)).order.status).toBe('CANCELLED_UNPAID');
    const { rows } = await pool.query<{ status: string }>(
      `select status from shipments where order_id = $1`,
      [order.orderId],
    );
    expect(rows.map((row) => row.status)).toEqual(['CANCELLED']);
  });
});

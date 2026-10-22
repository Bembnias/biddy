// Kryteria F-23 na prawdziwym Postgresie i Redisie: API nasłuchuje na porcie, a worker w procesie
// testu rozlicza płatności FakeGateway i wysyła podpisane webhooki HTTP na endpoint API
// (prawdziwa ścieżka: podpis z bajtów body, processed_webhooks, handler, ledger, outbox).
// Do tego idempotencja webhooków (3 dostarczenia kolejno i równolegle), polling zapasowy,
// symulacja KYC, trasy deweloperskie i blokada startu bez adaptera operatora domyślnego.
import { setTimeout as delay } from 'node:timers/promises';

import type { LightMyRequestResponse } from 'fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId } from '../../src/infra/db/index.js';
import { FakeGatewaySimulator } from '../../src/modules/payments/adapters/fake/fake-gateway-simulator.js';
import {
  FAKE_SIGNATURE_HEADER,
  signFakeWebhook,
} from '../../src/modules/payments/adapters/fake/fake-webhook-format.js';
import {
  FAKE_BLIK_CODES,
  type PaymentMethod,
  PaymentService,
  type PaymentView,
  PendingPaymentsPoller,
  SellerAccountService,
} from '../../src/modules/payments/index.js';
import { createUser, type TestUser, WEB_ORIGIN } from './support/accounts.js';
import { integrationConfig, problemOf, startTestApp, type TestApp } from './support/app.js';
import type { ScratchDatabase } from './support/database.js';
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
let api: TestApp;
let worker: TestWorker;
let payments: PaymentService;
let simulator: FakeGatewaySimulator;
let secret: string;
let sellerId: string;
let user: TestUser;

beforeAll(async () => {
  database = await createMigratedDatabase();
  pool = new Pool({ connectionString: database.url, max: 8 });
  const shared = {
    DATABASE_URL: database.url,
    REDIS_QUEUE_URL: redisUrl(),
    QUEUE_PREFIX: uniqueQueuePrefix(),
    // Krótkie, ale niezerowe opóźnienie: webhook nie wyprzedza zapisu odpowiedzi operatora.
    PAYMENTS_FAKE_WEBHOOK_DELAY_MS: '300',
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
  payments = api.app.get(PaymentService);
  simulator = api.app.get(FakeGatewaySimulator);
  secret = worker.config.payments.fake.webhookSecret;
  user = await createUser(api, pool, { name: 'Testerka Płatności' });
  sellerId = newId();
  await api.app.get(SellerAccountService).register({
    userId: sellerId,
    email: 'sprzedawca@example.com',
    displayName: 'Sprzedawca',
    type: 'PRIVATE',
  });
}, 120_000);

afterAll(async () => {
  await worker.close();
  await api.close();
  await pool.end();
  await database.drop();
});

let attempt = 0;

function createPayment(
  method: PaymentMethod,
  overrides: Partial<Parameters<PaymentService['createPayment']>[0]> = {},
): Promise<PaymentView> {
  attempt += 1;
  const orderId = newId();
  return payments.createPayment({
    orderId,
    buyer: { id: user.id, email: 'kupujacy@example.com', ip: '203.0.113.10' },
    sellerId,
    amount: { amount: 12_990, currency: 'PLN' },
    sellerAmount: { amount: 11_000, currency: 'PLN' },
    method,
    returnUrl: `${WEB_ORIGIN}/zamowienia/${orderId}`,
    idempotencyKey: `order:${orderId}:attempt:${String(attempt)}`,
    ...overrides,
  });
}

async function paymentRow(id: string) {
  const { rows } = await pool.query<{
    status: string;
    failure_reason: string | null;
    provider_payment_id: string | null;
    order_id: string;
    polled_at: Date | null;
  }>(
    'select status, failure_reason, provider_payment_id, order_id, polled_at from payments where id = $1',
    [id],
  );
  return rows[0];
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(sql, params);
  return Number(rows[0]?.count ?? 0);
}

const receivedPostings = (orderId: string) =>
  count(
    `select count(*) from ledger_transactions where order_id = $1 and type = 'PAYMENT_RECEIVED'`,
    [orderId],
  );
const outboxEvents = (type: string, aggregateId: string) =>
  count('select count(*) from outbox where type = $1 and aggregate_id = $2', [type, aggregateId]);

/** Webhook podpisany jak przez FakeGateway (treść zdarzenia z fake_gateway_events). */
async function fakeWebhook(objectId: string, type: string): Promise<string> {
  const { rows } = await pool.query<{ body: unknown }>(
    'select body from fake_gateway_events where object_id = $1 and type = $2 order by created_at desc limit 1',
    [objectId, type],
  );
  expect(rows[0], `zdarzenie ${type} dla ${objectId}`).toBeDefined();
  return JSON.stringify(rows[0]?.body);
}

function postWebhook(body: string, options: { secret?: string; provider?: string } = {}) {
  return api.http.inject({
    method: 'POST',
    url: `/v1/webhooks/payments/${options.provider ?? 'fake'}`,
    headers: {
      'content-type': 'application/json',
      [FAKE_SIGNATURE_HEADER]: signFakeWebhook(
        options.secret ?? secret,
        body,
        Math.floor(Date.now() / 1000),
      ),
    },
    payload: body,
  });
}

function receipt(response: LightMyRequestResponse) {
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ received: number; processed: number; duplicates: number }>();
}

/** Płatność wisząca u operatora (BLIK 222222) rozliczona bez webhooka, jak przy zaginionym webhooku. */
async function silentlySettled(): Promise<PaymentView> {
  const payment = await createPayment({ type: 'BLIK', code: FAKE_BLIK_CODES.HANG });
  await simulator.settlePayment(payment.providerPaymentId ?? '', 'SUCCEEDED', { deliver: false });
  return payment;
}

describe('magiczne kody BLIK: rozliczenie w workerze i webhook HTTP do API', () => {
  it('777123: PENDING, potem SUCCEEDED z księgowaniem PAYMENT_RECEIVED i eventem', async () => {
    const payment = await createPayment({ type: 'BLIK', code: FAKE_BLIK_CODES.SUCCEED });
    expect(payment).toMatchObject({ status: 'PENDING', provider: 'fake', redirectUrl: null });
    expect(payment.providerPaymentId).toMatch(/^fake_pay_/);

    await waitFor(
      async () => (await paymentRow(payment.id))?.status === 'SUCCEEDED',
      'płatność opłacona po webhooku',
    );
    expect(await receivedPostings(payment.orderId)).toBe(1);
    expect(await outboxEvents('PaymentSucceeded', payment.id)).toBe(1);
    const { rows } = await pool.query<{ delivered_at: Date | null; attempts: number }>(
      'select delivered_at, attempts from fake_gateway_events where object_id = $1',
      [payment.providerPaymentId],
    );
    expect(rows).toEqual([{ delivered_at: expect.any(Date) as Date, attempts: 1 }]);
  });

  it('111111: odrzucona (DECLINED) z eventem PaymentFailed, bez księgowania', async () => {
    const payment = await createPayment({ type: 'BLIK', code: FAKE_BLIK_CODES.DECLINE });
    await waitFor(
      async () => (await paymentRow(payment.id))?.status === 'FAILED',
      'płatność odrzucona po webhooku',
    );
    expect((await paymentRow(payment.id))?.failure_reason).toBe('DECLINED');
    expect(await outboxEvents('PaymentFailed', payment.id)).toBe(1);
    expect(await receivedPostings(payment.orderId)).toBe(0);
  });

  it('222222: zostaje w PENDING bez webhooka; nieznany kod: od razu INVALID_BLIK_CODE', async () => {
    const hanging = await createPayment({ type: 'BLIK', code: FAKE_BLIK_CODES.HANG });
    const invalid = await createPayment({ type: 'BLIK', code: '123456' });
    expect(invalid).toMatchObject({ status: 'FAILED', failureReason: 'INVALID_BLIK_CODE' });
    expect(await outboxEvents('PaymentFailed', invalid.id)).toBe(1);
    await delay(800);
    expect((await paymentRow(hanging.id))?.status).toBe('PENDING');
    expect(
      await count('select count(*) from fake_gateway_events where object_id = $1', [
        hanging.providerPaymentId,
      ]),
    ).toBe(0);
  });

  it('karta: przekierowanie na testową stronę płatności, wynik z przycisku (bez logowania)', async () => {
    const payment = await createPayment({ type: 'CARD' });
    const providerId = payment.providerPaymentId ?? '';
    expect(payment.status).toBe('PENDING');
    expect(payment.redirectUrl).toBe(`${WEB_ORIGIN}/dev/fake-pay/${providerId}`);

    const page = await api.http.inject({
      method: 'GET',
      url: `/v1/dev/fake-gateway/payments/${providerId}`,
    });
    expect(page.statusCode, page.body).toBe(200);
    expect(page.json()).toMatchObject({
      id: providerId,
      status: 'PENDING',
      method: 'CARD',
      amount: 12_990,
      sellerAmount: 11_000,
      platformAmount: 1_990,
      returnUrl: `${WEB_ORIGIN}/zamowienia/${payment.orderId}`,
    });

    const complete = () =>
      api.http.inject({
        method: 'POST',
        url: `/v1/dev/fake-gateway/payments/${providerId}/complete`,
        headers: { origin: WEB_ORIGIN },
        payload: { outcome: 'SUCCEEDED' },
      });
    const first = await complete();
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({ status: 'SUCCEEDED' });
    expect(problemOf(await complete())).toMatchObject({ status: 409, code: 'CONFLICT' });

    await waitFor(
      async () => (await paymentRow(payment.id))?.status === 'SUCCEEDED',
      'płatność kartą opłacona',
    );
    expect(await receivedPostings(payment.orderId)).toBe(1);
  });
});

describe('PaymentService.createPayment: idempotencja i konto sprzedawcy', () => {
  it('ten sam klucz zwraca tę samą płatność; inne dane z tym kluczem: 422', async () => {
    const orderId = newId();
    const command = {
      orderId,
      buyer: { id: user.id, email: 'kupujacy@example.com', ip: '203.0.113.10' },
      sellerId,
      amount: { amount: 5_000, currency: 'PLN' as const },
      sellerAmount: { amount: 4_000, currency: 'PLN' as const },
      method: { type: 'BLIK' as const, code: FAKE_BLIK_CODES.HANG },
      returnUrl: `${WEB_ORIGIN}/zamowienia/${orderId}`,
      idempotencyKey: `order:${orderId}:attempt:1`,
    };
    const first = await payments.createPayment(command);
    const second = await payments.createPayment(command);
    expect(second.id).toBe(first.id);
    expect(second.providerPaymentId).toBe(first.providerPaymentId);
    expect(await count('select count(*) from payments where order_id = $1', [orderId])).toBe(1);
    await expect(
      payments.createPayment({ ...command, amount: { amount: 5_001, currency: 'PLN' } }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', status: 422 });
  });

  it('sprzedający bez konta u operatora: 409 bez zakładania płatności', async () => {
    const orderId = newId();
    await expect(
      createPayment({ type: 'CARD' }, { sellerId: newId(), orderId }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await count('select count(*) from payments where order_id = $1', [orderId])).toBe(0);
  });
});

describe('POST /v1/webhooks/payments/:provider', () => {
  it('ten sam webhook 3 razy kolejno zmienia stan raz: jedno księgowanie i jeden event', async () => {
    const payment = await silentlySettled();
    const body = await fakeWebhook(payment.providerPaymentId ?? '', 'payment.completed');

    expect(receipt(await postWebhook(body))).toEqual({ received: 1, processed: 1, duplicates: 0 });
    expect(receipt(await postWebhook(body))).toEqual({ received: 1, processed: 0, duplicates: 1 });
    expect(receipt(await postWebhook(body))).toEqual({ received: 1, processed: 0, duplicates: 1 });

    expect((await paymentRow(payment.id))?.status).toBe('SUCCEEDED');
    expect(await receivedPostings(payment.orderId)).toBe(1);
    expect(await outboxEvents('PaymentSucceeded', payment.id)).toBe(1);
  });

  it('ten sam webhook 3 razy równolegle też zmienia stan raz', async () => {
    const payment = await silentlySettled();
    const body = await fakeWebhook(payment.providerPaymentId ?? '', 'payment.completed');

    const receipts = (
      await Promise.all([postWebhook(body), postWebhook(body), postWebhook(body)])
    ).map(receipt);
    expect(receipts.reduce((sum, item) => sum + item.processed, 0)).toBe(1);
    expect(receipts.reduce((sum, item) => sum + item.duplicates, 0)).toBe(2);
    expect(await receivedPostings(payment.orderId)).toBe(1);
    expect(await outboxEvents('PaymentSucceeded', payment.id)).toBe(1);
  });

  it('zły podpis: 401 bez zmiany stanu; nieznany albo niedziałający operator: 404', async () => {
    const payment = await silentlySettled();
    const body = await fakeWebhook(payment.providerPaymentId ?? '', 'payment.completed');

    const forged = await postWebhook(body, { secret: 'podrobiony-sekret' });
    expect(problemOf(forged)).toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    const unsigned = await api.http.inject({
      method: 'POST',
      url: '/v1/webhooks/payments/fake',
      headers: { 'content-type': 'application/json' },
      payload: body,
    });
    expect(unsigned.statusCode).toBe(401);
    expect((await paymentRow(payment.id))?.status).toBe('PENDING');

    expect(problemOf(await postWebhook(body, { provider: 'payu' }))).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    expect((await postWebhook(body, { provider: 'nieznany' })).statusCode).toBe(404);
  });

  it('webhook nieznanej płatności: 500 (operator ponowi), a idempotencja się nie zapisuje', async () => {
    const created = new Date().toISOString();
    const body = JSON.stringify({
      id: `fake_evt_${newId().replaceAll('-', '')}`,
      type: 'payment.completed',
      created,
      object: { id: 'fake_pay_nieznana', amount: { value: 100, currency: 'PLN' } },
    });
    const response = await postWebhook(body);
    expect(problemOf(response)).toMatchObject({ status: 500 });
    const eventId = (JSON.parse(body) as { id: string }).id;
    expect(
      await count('select count(*) from processed_webhooks where event_id = $1', [eventId]),
    ).toBe(0);
  });

  it('kwota inna niż w płatności: 500 bez zmiany stanu i bez księgowania', async () => {
    const payment = await silentlySettled();
    const original = JSON.parse(
      await fakeWebhook(payment.providerPaymentId ?? '', 'payment.completed'),
    ) as { object: { amount: { value: number } } };
    original.object.amount.value += 1;
    expect((await postWebhook(JSON.stringify(original))).statusCode).toBe(500);
    expect((await paymentRow(payment.id))?.status).toBe('PENDING');
    expect(await receivedPostings(payment.orderId)).toBe(0);
  });

  it('opłata operatora w webhooku: księgowanie PAYMENT_FEE_CHARGED', async () => {
    const payment = await silentlySettled();
    const event = JSON.parse(
      await fakeWebhook(payment.providerPaymentId ?? '', 'payment.completed'),
    ) as { object: Record<string, unknown> };
    event.object['fee'] = { value: 180, currency: 'PLN' };
    expect(receipt(await postWebhook(JSON.stringify(event))).processed).toBe(1);
    expect(
      await count(
        `select count(*) from ledger_transactions where order_id = $1 and type = 'PAYMENT_FEE_CHARGED'`,
        [payment.orderId],
      ),
    ).toBe(1);
  });

  it('zdarzenie bez obsługi w tej wersji (chargeback) jest przyjęte i zapisane jako IGNORED', async () => {
    const payment = await createPayment({ type: 'BLIK', code: FAKE_BLIK_CODES.SUCCEED });
    await waitFor(
      async () => (await paymentRow(payment.id))?.status === 'SUCCEEDED',
      'płatność opłacona',
    );
    await simulator.chargeback(payment.providerPaymentId ?? '', 'OPEN');
    await waitFor(
      async () =>
        (await count(
          `select count(*) from processed_webhooks where event_type = 'CHARGEBACK_OPENED' and outcome = 'IGNORED'`,
          [],
        )) === 1,
      'chargeback przyjęty bez obsługi',
    );
    expect((await paymentRow(payment.id))?.status).toBe('SUCCEEDED');
  });

  it('ponowne dostarczenie z panelu nie zmienia stanu drugi raz', async () => {
    const payment = await createPayment({ type: 'BLIK', code: FAKE_BLIK_CODES.SUCCEED });
    await waitFor(
      async () => (await paymentRow(payment.id))?.status === 'SUCCEEDED',
      'płatność opłacona',
    );
    const { rows } = await pool.query<{ id: string }>(
      'select id from fake_gateway_events where object_id = $1',
      [payment.providerPaymentId],
    );
    const eventId = rows[0]?.id ?? '';
    await simulator.redeliver(eventId);
    await waitFor(
      async () =>
        (await count('select attempts as count from fake_gateway_events where id = $1', [
          eventId,
        ])) === 2,
      'drugie dostarczenie',
    );
    expect(await receivedPostings(payment.orderId)).toBe(1);
    expect(await outboxEvents('PaymentSucceeded', payment.id)).toBe(1);
  });
});

describe('polling zapasowy (PENDING dłużej niż 15 minut)', () => {
  it('dociąga stan zaginionego webhooka; młodszej płatności nie sprawdza; bez ID operatora: PROVIDER_ERROR', async () => {
    const lost = await silentlySettled();
    const young = await silentlySettled();
    const hanging = await createPayment({ type: 'BLIK', code: FAKE_BLIK_CODES.HANG });
    await pool.query(
      `update payments set created_at = now() - interval '16 minutes' where id = any($1)`,
      [[lost.id, hanging.id]],
    );
    // Płatność, dla której wywołanie operatora nie dało odpowiedzi (np. błąd sieci).
    const orphanOrder = newId();
    const { rows } = await pool.query<{ id: string }>(
      `insert into payments (id, order_id, buyer_id, seller_id, provider, method, currency, amount,
         seller_amount, platform_amount, status, idempotency_key, created_at)
       values ($1, $2, $3, $4, 'fake', 'BLIK', 'PLN', 1000, 800, 200, 'PENDING', $5,
         now() - interval '20 minutes')
       returning id`,
      [newId(), orphanOrder, user.id, sellerId, `order:${orphanOrder}:attempt:1`],
    );
    const orphanId = rows[0]?.id ?? '';

    await api.app.get(PendingPaymentsPoller).pollPending();

    expect((await paymentRow(lost.id))?.status).toBe('SUCCEEDED');
    expect(await receivedPostings(lost.orderId)).toBe(1);
    expect(await outboxEvents('PaymentSucceeded', lost.id)).toBe(1);
    expect(await paymentRow(young.id)).toMatchObject({ status: 'PENDING', polled_at: null });
    expect((await paymentRow(hanging.id))?.status).toBe('PENDING');
    expect((await paymentRow(hanging.id))?.polled_at).toBeInstanceOf(Date);
    expect(await paymentRow(orphanId)).toMatchObject({
      status: 'FAILED',
      failure_reason: 'PROVIDER_ERROR',
    });
    expect(await outboxEvents('PaymentFailed', orphanId)).toBe(1);

    // Późny webhook po pollingu niczego nie dubluje.
    const body = await fakeWebhook(lost.providerPaymentId ?? '', 'payment.completed');
    expect(receipt(await postWebhook(body)).processed).toBe(1);
    expect(await receivedPostings(lost.orderId)).toBe(1);
  });
});

describe('symulacja KYC', () => {
  it('rejestracja z +kyc-pending, zmiana statusu z panelu: webhook, seller_accounts i event', async () => {
    const userId = newId();
    const account = await api.app.get(SellerAccountService).register({
      userId,
      email: 'nowa+kyc-pending@example.com',
      displayName: 'Nowa Sprzedawczyni',
      type: 'PRIVATE',
    });
    expect(account.kycStatus).toBe('PENDING');

    await simulator.setSellerStatus(account.providerAccountId, 'VERIFIED');
    await waitFor(
      async () =>
        (
          await pool.query<{ kyc_status: string }>(
            'select kyc_status from seller_accounts where id = $1',
            [account.id],
          )
        ).rows[0]?.kyc_status === 'VERIFIED',
      'status KYC z webhooka',
    );
    const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
      `select payload from outbox where type = 'SellerKycStatusChanged' and aggregate_id = $1`,
      [account.id],
    );
    expect(rows.map((row) => row.payload)).toEqual([
      { userId, provider: 'fake', status: 'VERIFIED', previousStatus: 'PENDING' },
    ]);
  });
});

describe('panel deweloperski FakeGateway', () => {
  it('wymaga sesji; z sesją pokazuje płatności, sprzedawców i webhooki', async () => {
    const anonymous = await api.http.inject({ method: 'GET', url: '/v1/dev/fake-gateway' });
    expect(problemOf(anonymous)).toMatchObject({ status: 401 });

    const response = await api.http.inject({
      method: 'GET',
      url: '/v1/dev/fake-gateway',
      headers: { cookie: user.cookie },
    });
    expect(response.statusCode, response.body).toBe(200);
    const overview = response.json<{
      payments: unknown[];
      sellers: { sellerRef: string }[];
      events: { type: string }[];
    }>();
    expect(overview.payments.length).toBeGreaterThan(0);
    expect(overview.sellers.map((seller) => seller.sellerRef)).toContain(sellerId);
    expect(overview.events.map((event) => event.type)).toContain('payment.completed');

    const forbidden = await api.http.inject({
      method: 'POST',
      url: '/v1/dev/fake-gateway/events/fake_evt_nieznane/redeliver',
      headers: { cookie: user.cookie, origin: WEB_ORIGIN },
    });
    expect(problemOf(forbidden)).toMatchObject({ status: 404 });
  });
});

describe('start aplikacji', () => {
  it('operator domyślny bez adaptera (produkcja przed F-31): aplikacja nie startuje', async () => {
    await expect(
      startTestApp(
        integrationConfig({
          DATABASE_URL: database.url,
          DEPLOYMENT_ENV: 'production',
          PAYMENTS_DEFAULT_PROVIDER: 'payu',
        }),
      ),
    ).rejects.toThrow(/PAYMENTS_DEFAULT_PROVIDER=payu: brak adaptera/);
  });

  it('fake z DEPLOYMENT_ENV=production: konfiguracja odrzucona przed startem', () => {
    expect(() =>
      integrationConfig({ DEPLOYMENT_ENV: 'production', PAYMENTS_DEFAULT_PROVIDER: 'fake' }),
    ).toThrow(/FakeGateway \(fake\) nie może działać na produkcji/);
  });
});

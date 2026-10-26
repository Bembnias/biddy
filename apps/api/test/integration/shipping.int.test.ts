// Kryteria F-24 na prawdziwym Postgresie, Redisie i magazynie S3 (RustFS): API nasłuchuje na
// porcie, a worker w procesie testu tworzy przesyłki u FakeShipping, prowadzi automat statusów
// i wysyła podpisane webhooki HTTP na endpoint API (prawdziwa ścieżka: webhook jako wskazówka,
// job synchronizacji, tracking z API dostawcy, shipment_events, outbox). Zamówienia powstają
// przez Kup teraz (F-16), a przejście w PAID i wybór dostawy, które dadzą F-25 i F-26, test
// robi wprost (SQL i ShipmentService.prepare).
import type { LightMyRequestResponse } from 'fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Database, DRIZZLE, newId } from '../../src/infra/db/index.js';
import { Outbox } from '../../src/infra/outbox/index.js';
import { OrderPaid } from '../../src/modules/orders/index.js';
import {
  FAKE_SHIPPING_SIGNATURE_HEADER,
  signFakeShippingWebhook,
} from '../../src/modules/shipping/adapters/fake/fake-shipping-format.js';
import { FAKE_REJECTED_PHONE } from '../../src/modules/shipping/adapters/fake/fake-shipping-provider.js';
import { FakeShippingSimulator } from '../../src/modules/shipping/adapters/fake/fake-shipping-simulator.js';
import {
  CarrierClaimService,
  type ShipmentDto,
  ShipmentService,
  TrackingSync,
} from '../../src/modules/shipping/index.js';
import { type TestUser, WEB_ORIGIN, createUser } from './support/accounts.js';
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

let database: ScratchDatabase;
let pool: Pool;
let s3: TestS3;
let api: TestApp;
let worker: TestWorker;
let shipments: ShipmentService;
let simulator: FakeShippingSimulator;
let secret: string;
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
    // Automat FakeShipping co 200 ms: cały cykl dostawy w kilka sekund.
    SHIPPING_FAKE_STEP_DELAY_MS: '200',
    ...s3.env,
  };
  api = await startTestApp(integrationConfig(shared));
  await api.app.listen(0, '127.0.0.1');
  const webhookUrl = `${await api.app.getUrl()}/v1/webhooks/shipping/fake`.replace(
    '[::1]',
    '127.0.0.1',
  );
  worker = await startTestWorker(
    workerConfig(database.url, { ...shared, SHIPPING_FAKE_WEBHOOK_URL: webhookUrl }),
  );
  shipments = api.app.get(ShipmentService);
  simulator = api.app.get(FakeShippingSimulator);
  secret = worker.config.shipping.fake.webhookSecret;
}, 180_000);

afterAll(async () => {
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

/** Aukcja z Kup teraz kupiona przez nowe konto: zamówienie AWAITING_PAYMENT ze snapshotem. */
async function sale(fields: Record<string, unknown> = {}): Promise<Sale> {
  const seller = await createUser(api, pool, { name: 'Sprzedawca Paczek' });
  const buyer = await createUser(api, pool, { name: 'Kupujący Paczki' });
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
    allowedCarriers: ['inpost-paczkomat', 'orlen-paczka'],
    startPrice: 2_000,
    buyNowPrice: 12_000,
    durationDays: 7,
    ...fields,
  });
  expect(patched.statusCode, patched.body).toBe(200);
  const published = await call('POST', `/v1/auctions/${id}/publish`, seller, {
    kycNoticeAccepted: true,
  });
  expect(published.statusCode, published.body).toBe(200);
  const bought = await call('POST', `/v1/auctions/${id}/buy-now`, buyer, undefined, {
    'idempotency-key': `shipping-${newId()}`,
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

const markPaid = (orderId: string) =>
  pool.query(`update orders set status = 'PAID' where id = $1`, [orderId]);

const recipient = { name: 'Jan Kupujący', phone: '600 700 800', email: 'jan@example.com' };

const parcelM = {
  packageSize: 'M' as const,
  weightGrams: null,
  dimensionsCm: null,
  allowedCarriers: ['inpost-paczkomat', 'orlen-paczka'],
};

/** Wybór dostawy, który zrobi checkout (F-25). */
function prepare(
  order: Sale,
  pickupPointId = 'inpost-paczkomat-01',
  carrierId = 'inpost-paczkomat',
) {
  return shipments.prepare({
    orderId: order.orderId,
    direction: 'OUTBOUND',
    carrierId,
    parcel: parcelM,
    currency: 'PLN',
    pickupPointId,
    recipient,
  });
}

const sender = {
  name: 'Anna Sprzedająca',
  phone: '500 600 700',
  address: { street: 'ul. Prosta 1', postalCode: '00-001', city: 'Warszawa' },
};

function dispatch(order: Sale, body: Record<string, unknown> = {}) {
  return call('POST', `/v1/orders/${order.publicId}/shipment`, order.seller, {
    sender,
    dispatchMethod: 'DROP_OFF',
    ...body,
  });
}

async function shipmentOf(order: Sale, user: TestUser = order.seller) {
  const response = await call('GET', `/v1/orders/${order.publicId}/shipment`, user);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ order: { role: string; title: string }; shipment: ShipmentDto | null }>();
}

function waitForStatus(order: Sale, status: string, timeoutMs = 20_000) {
  return waitFor(
    async () => {
      const { shipment } = await shipmentOf(order);
      return shipment?.status === status ? shipment : undefined;
    },
    `przesyłka w statusie ${status}`,
    timeoutMs,
  );
}

/** Statusy po nadaniu u przewoźnika (automat co 200 ms może minąć DROPPED_OFF przed odczytem). */
const HANDED_OVER = new Set(['DROPPED_OFF', 'IN_TRANSIT', 'READY_FOR_PICKUP', 'DELIVERED']);

async function statusEvents(shipmentId: string) {
  const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
    `select payload from outbox where type = 'ShipmentStatusChanged' and aggregate_id = $1
     order by id`,
    [shipmentId],
  );
  return rows.map((row) => row.payload);
}

const count = async (sql: string, params: unknown[]) =>
  Number((await pool.query<{ count: string }>(sql, params)).rows[0]?.count ?? 0);

describe('opcje dostawy (kryterium 1)', () => {
  it('kupujący widzi tylko akceptowane usługi pasujące do gabarytu, z cenami; strona aukcji „dostawa od”', async () => {
    const order = await sale();
    const options = await call('GET', `/v1/orders/${order.publicId}/shipping-options`, order.buyer);
    expect(options.statusCode, options.body).toBe(200);
    expect(options.json()).toEqual([
      {
        carrierId: 'inpost-paczkomat',
        name: 'InPost Paczkomat 24/7',
        kind: 'LOCKER',
        price: 1_399,
        currency: 'PLN',
        requiresPickupPoint: true,
      },
      {
        carrierId: 'orlen-paczka',
        name: 'Orlen Paczka',
        kind: 'PICKUP_POINT',
        price: 1_099,
        currency: 'PLN',
        requiresPickupPoint: true,
      },
    ]);
    expect(
      (await call('GET', `/v1/orders/${order.publicId}/shipping-options`, order.seller)).statusCode,
    ).toBe(404);
    const stranger = await createUser(api, pool);
    expect(
      (await call('GET', `/v1/orders/${order.orderId}/shipping-options`, stranger)).statusCode,
    ).toBe(404);

    const page = await call('GET', `/v1/auctions/${order.auctionId}`);
    expect(page.statusCode, page.body).toBe(200);
    const view = page.json<{ carriers: { id: string; price: number }[]; shippingFrom: number }>();
    expect(view.carriers.map(({ id, price }) => [id, price])).toEqual([
      ['inpost-paczkomat', 1_399],
      ['orlen-paczka', 1_099],
    ]);
    expect(view.shippingFrom).toBe(1_099);
  });

  it('XL: tylko kurier, który mieści paczkę (waga, najdłuższy bok, obwód)', async () => {
    const order = await sale({
      packageSize: 'XL',
      weightGrams: 20_000,
      lengthCm: 100,
      widthCm: 50,
      heightCm: 40,
      allowedCarriers: ['inpost-kurier', 'dpd-kurier'],
    });
    const options = await call('GET', `/v1/orders/${order.publicId}/shipping-options`, order.buyer);
    // InPost Kurier: obwód 100 + 2 × 90 = 280 cm > 220 cm; DPD: do 300 cm.
    expect(
      options.json<{ carrierId: string; price: number }[]>().map((o) => [o.carrierId, o.price]),
    ).toEqual([['dpd-kurier', 4_499]]);
  });
});

describe('wybór dostawy (ShipmentService.prepare)', () => {
  it('punkt wymagany i sprawdzany; usługa spoza oferty odrzucona; ponowny wybór zastępuje dane', async () => {
    const order = await sale();
    await expect(prepare(order, '')).rejects.toMatchObject({ code: 'PICKUP_POINT_REQUIRED' });
    await expect(prepare(order, 'inpost-paczkomat-99')).rejects.toMatchObject({
      code: 'PICKUP_POINT_NOT_FOUND',
    });
    await expect(prepare(order, 'x', 'dpd-kurier')).rejects.toMatchObject({
      code: 'SHIPPING_OPTION_UNAVAILABLE',
    });
    const first = await prepare(order);
    const second = await prepare(order, 'orlen-paczka-02', 'orlen-paczka');
    expect(second.shipment.id).toBe(first.shipment.id);
    expect(second.shipment).toMatchObject({
      status: 'PENDING',
      carrierId: 'orlen-paczka',
      price: 1_099,
      pickupPoint: { id: 'orlen-paczka-02', name: 'Punkt testowy 02' },
      recipient: { name: 'Jan Kupujący', phone: '+48600700800', address: null },
    });
  });
});

describe('„Nadaj” (kryterium 2)', () => {
  it('tylko sprzedający opłaconego zamówienia z dostawą; dwa kliknięcia to jedna przesyłka; kod i etykieta', async () => {
    const order = await sale();
    await prepare(order);
    const unpaid = await dispatch(order);
    expect(unpaid.statusCode, unpaid.body).toBe(409);
    expect(problemOf(unpaid).code).toBe('ORDER_NOT_AWAITING_SHIPMENT');
    await markPaid(order.orderId);
    const asBuyer = await call('POST', `/v1/orders/${order.publicId}/shipment`, order.buyer, {
      sender,
      dispatchMethod: 'DROP_OFF',
    });
    expect(asBuyer.statusCode).toBe(404);
    const courier = await dispatch(order, { dispatchMethod: 'COURIER_PICKUP' });
    expect(problemOf(courier).code).toBe('DISPATCH_METHOD_UNAVAILABLE');

    const clicks = await Promise.all([dispatch(order), dispatch(order)]);
    for (const click of clicks) {
      expect(click.statusCode, click.body).toBe(202);
    }
    const created = await waitForStatus(order, 'CREATED');
    expect(created.trackingNumber).toMatch(/^FS\d{12}$/);
    expect(created.dropoffCode).toMatch(/^\d{6}$/);
    expect(created.sender).toMatchObject({ name: 'Anna Sprzedająca', phone: '+48500600700' });
    await waitFor(async () => (await shipmentOf(order)).shipment?.labelAvailable, 'etykieta');
    expect(
      await count('select count(*) from fake_shipping_parcels where idempotency_key like $1', [
        `shipment:${created.id}:%`,
      ]),
    ).toBe(1);
    expect(
      await count(
        `select count(*) from outbox where type = 'ShipmentCreated' and aggregate_id = $1`,
        [created.id],
      ),
    ).toBe(1);
    expect(await s3.exists(UPLOADS_BUCKET, `shipping-labels/${created.id}.pdf`)).toBe(true);

    const label = await call('GET', `/v1/orders/${order.publicId}/label`, order.seller);
    expect(label.statusCode).toBe(200);
    expect(label.headers['content-type']).toBe('application/pdf');
    expect(label.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect((await call('GET', `/v1/orders/${order.publicId}/label`, order.buyer)).statusCode).toBe(
      404,
    );

    const buyerView = await shipmentOf(order, order.buyer);
    expect(buyerView.order).toMatchObject({ role: 'BUYER', title: 'Wazon ceramiczny, lata 70.' });
    expect(buyerView.shipment).toMatchObject({
      trackingNumber: created.trackingNumber,
      dropoffCode: null,
      sender: null,
      labelAvailable: false,
    });

    const again = await dispatch(order);
    expect(again.statusCode).toBe(202);
    expect(again.json<{ shipment: ShipmentDto }>().shipment.status).not.toBe('PENDING');
    await expect(prepare(order)).rejects.toMatchObject({ code: 'SHIPMENT_ALREADY_DISPATCHED' });
  });

  it('dane odrzucone przez przewoźnika wracają do sprzedającego; poprawione nadają się w nowej próbie', async () => {
    const order = await sale();
    await prepare(order);
    await markPaid(order.orderId);
    const rejected = await dispatch(order, { sender: { ...sender, phone: FAKE_REJECTED_PHONE } });
    expect(rejected.statusCode, rejected.body).toBe(202);
    const pending = await waitFor(async () => {
      const { shipment } = await shipmentOf(order);
      return shipment?.status === 'PENDING' && shipment.lastError !== null ? shipment : undefined;
    }, 'błąd przewoźnika przy przesyłce');
    expect(pending.lastError).toContain('odrzucił numer telefonu nadawcy');
    expect((await dispatch(order)).statusCode).toBe(202);
    const created = await waitForStatus(order, 'CREATED');
    expect(created.lastError).toBeNull();
    const { rows } = await pool.query<{ dispatch_attempts: number }>(
      'select dispatch_attempts from shipments where id = $1',
      [created.id],
    );
    expect(rows[0]?.dispatch_attempts).toBe(2);
  });
});

describe('tracking i automat FakeShipping (kryteria 3–5)', () => {
  it('cały cykl do odbioru i ścieżka nieodebranej paczki: eventy w kolejności, NOT_COLLECTED', async () => {
    const delivered = await sale();
    const returned = await sale();
    await prepare(delivered);
    await prepare(returned, 'inpost-paczkomat-NOPICKUP');
    await markPaid(delivered.orderId);
    await markPaid(returned.orderId);
    await Promise.all([dispatch(delivered), dispatch(returned)]);

    const [done, back] = await Promise.all([
      waitForStatus(delivered, 'DELIVERED', 30_000),
      waitForStatus(returned, 'RETURNED', 30_000),
    ]);
    expect(done.deliveredAt).not.toBeNull();
    const deliveredEvents = await statusEvents(done.id);
    expect(deliveredEvents.map((event) => event['status'])).toEqual([
      'DROPPED_OFF',
      'IN_TRANSIT',
      'READY_FOR_PICKUP',
      'DELIVERED',
    ]);
    const last = deliveredEvents.at(-1) ?? {};
    expect(last).toMatchObject({
      orderId: delivered.orderId,
      direction: 'OUTBOUND',
      previousStatus: 'READY_FOR_PICKUP',
    });
    expect(Date.parse(String(last['detectedAt']))).toBeGreaterThanOrEqual(
      Date.parse(String(last['occurredAt'])),
    );

    const returnEvents = await statusEvents(back.id);
    expect(returnEvents.map((event) => [event['status'], event['returnReason']])).toEqual([
      ['DROPPED_OFF', null],
      ['IN_TRANSIT', null],
      ['READY_FOR_PICKUP', null],
      ['RETURNING', 'NOT_COLLECTED'],
      ['RETURNED', null],
    ]);
    expect(back.events.map((event) => event.status)).toContain('RETURNING');
  });

  it('webhook: zły podpis 401, nieznany dostawca 404, nieznana przesyłka pominięta; 3 dostarczenia = jedna zmiana', async () => {
    const order = await sale();
    await prepare(order);
    await markPaid(order.orderId);
    await dispatch(order);
    const created = await waitForStatus(order, 'CREATED');
    const { rows } = await pool.query<{ provider_shipment_id: string }>(
      'select provider_shipment_id from shipments where id = $1',
      [created.id],
    );
    const parcelId = rows[0]?.provider_shipment_id ?? '';
    await simulator.setScenario(parcelId, 'MANUAL');
    await simulator.advance(parcelId, { status: 'posted', deliverWebhook: false });

    const body = (id: string) =>
      JSON.stringify({
        id: `fsw_${newId()}`,
        type: 'parcel.updated',
        created: new Date().toISOString(),
        parcel_id: id,
      });
    const send = (raw: string, signature: string, provider = 'fake') =>
      api.http.inject({
        method: 'POST',
        url: `/v1/webhooks/shipping/${provider}`,
        headers: {
          'content-type': 'application/json',
          [FAKE_SHIPPING_SIGNATURE_HEADER]: signature,
        },
        payload: raw,
      });
    const now = () => Math.floor(Date.now() / 1000);
    const valid = body(parcelId);
    expect(
      (await send(valid, signFakeShippingWebhook('zly-sekret', valid, now()))).statusCode,
    ).toBe(401);
    expect(
      (await send(valid, signFakeShippingWebhook(secret, valid, now()), 'dhl')).statusCode,
    ).toBe(404);
    const unknown = body('fsp_nieznana');
    const unknownResponse = await send(unknown, signFakeShippingWebhook(secret, unknown, now()));
    expect(unknownResponse.statusCode).toBe(200);
    expect(unknownResponse.json()).toEqual({ status: 'OK', received: 1, unknown: 1 });

    const responses = await Promise.all(
      [1, 2, 3].map(() => send(valid, signFakeShippingWebhook(secret, valid, now()))),
    );
    for (const response of responses) {
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({ status: 'OK', received: 1, unknown: 0 });
    }
    await waitForStatus(order, 'DROPPED_OFF');
    // Kolejna synchronizacja (np. następny webhook albo polling) niczego nie dubluje.
    await worker.app.get(TrackingSync).sync(created.id);
    expect((await statusEvents(created.id)).map((event) => event['status'])).toEqual([
      'DROPPED_OFF',
    ]);
    expect(
      await count(
        `select count(*) from shipment_events where shipment_id = $1 and raw_status = 'posted'`,
        [created.id],
      ),
    ).toBe(1);
  });

  it('polling zapasowy: przesyłka niesprawdzana od 2 h dostaje status bez webhooka', async () => {
    const order = await sale();
    await prepare(order);
    await markPaid(order.orderId);
    await dispatch(order);
    const created = await waitForStatus(order, 'CREATED');
    const { rows } = await pool.query<{ provider_shipment_id: string }>(
      'select provider_shipment_id from shipments where id = $1',
      [created.id],
    );
    const parcelId = rows[0]?.provider_shipment_id ?? '';
    await simulator.setScenario(parcelId, 'MANUAL');
    await simulator.advance(parcelId, { status: 'in_transit', deliverWebhook: false });
    const tracking = worker.app.get(TrackingSync);

    await pool.query(
      `update shipments set polled_at = now() - interval '30 minutes' where id = $1`,
      [created.id],
    );
    await tracking.pollActive();
    expect((await shipmentOf(order)).shipment?.status).toBe('CREATED');

    await pool.query(`update shipments set polled_at = now() - interval '3 hours' where id = $1`, [
      created.id,
    ]);
    const result = await tracking.pollActive();
    expect(result.checked).toBeGreaterThanOrEqual(1);
    expect((await shipmentOf(order)).shipment?.status).toBe('IN_TRANSIT');
  });
});

describe('zwroty, anulowanie i reklamacje', () => {
  it('przesyłka zwrotna (od kupującego do sprzedającego) przechodzi ten sam przepływ', async () => {
    const order = await sale();
    const prepared = await shipments.prepare({
      orderId: order.orderId,
      direction: 'RETURN',
      carrierId: 'inpost-paczkomat',
      parcel: parcelM,
      currency: 'PLN',
      pickupPointId: 'inpost-paczkomat-03',
      recipient: { name: 'Anna Sprzedająca', phone: '500600700', email: null },
    });
    await shipments.dispatch(prepared.shipment.id, {
      sender: { name: 'Jan Kupujący', phone: '600700800', address: sender.address },
      dispatchMethod: 'DROP_OFF',
      declaredValue: null,
      reference: order.publicId,
    });
    await waitFor(
      async () => {
        const details = await shipments.details(prepared.shipment.id);
        return details !== undefined && HANDED_OVER.has(details.shipment.status)
          ? details
          : undefined;
      },
      'zwrot nadany',
      20_000,
    );
    const events = await statusEvents(prepared.shipment.id);
    expect(events[0]).toMatchObject({ direction: 'RETURN', orderId: order.orderId });
    // Przesyłka do kupującego i zwrot to osobne aktywne przesyłki zamówienia.
    await expect(prepare(order)).resolves.toMatchObject({ shipment: { direction: 'OUTBOUND' } });
  });

  it('anulowanie: PENDING od razu, CREATED u dostawcy z eventem; w drodze 409', async () => {
    const pendingOrder = await sale();
    const pending = await prepare(pendingOrder);
    expect((await shipments.cancel(pending.shipment.id)).shipment.status).toBe('CANCELLED');

    const order = await sale();
    await prepare(order);
    await markPaid(order.orderId);
    await dispatch(order);
    const created = await waitForStatus(order, 'CREATED');
    const parcel = await pool.query<{ provider_shipment_id: string }>(
      'select provider_shipment_id from shipments where id = $1',
      [created.id],
    );
    await simulator.setScenario(parcel.rows[0]?.provider_shipment_id ?? '', 'MANUAL');
    expect((await shipments.cancel(created.id)).shipment.status).toBe('CANCELLED');
    expect((await statusEvents(created.id)).map((event) => event['status'])).toEqual(['CANCELLED']);

    const moving = await sale();
    await prepare(moving);
    await markPaid(moving.orderId);
    await dispatch(moving);
    const movingShipment = await waitFor(async () => {
      const { shipment } = await shipmentOf(moving);
      return shipment !== null && HANDED_OVER.has(shipment.status) ? shipment : undefined;
    }, 'przesyłka w drodze');
    await expect(shipments.cancel(movingShipment.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('reklamacja: jedna na przesyłkę, zgłoszenie i rozstrzygnięcie z eventem', async () => {
    const order = await sale();
    await prepare(order);
    await markPaid(order.orderId);
    await dispatch(order);
    const created = await waitForStatus(order, 'CREATED');
    const claims = api.app.get(CarrierClaimService);
    const claim = await claims.open({
      shipmentId: created.id,
      type: 'LOST',
      claimedAmount: 12_000,
    });
    await expect(
      claims.open({ shipmentId: created.id, type: 'DAMAGED', claimedAmount: 100 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await claims.submit(claim.id, 'REK/2026/1')).status).toBe('SUBMITTED');
    await expect(
      claims.resolve(claim.id, { status: 'ACCEPTED', recoveredAmount: 20_000 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const resolved = await claims.resolve(claim.id, {
      status: 'ACCEPTED',
      recoveredAmount: 10_000,
    });
    expect(resolved).toMatchObject({ status: 'ACCEPTED', recoveredAmount: 10_000 });
    await expect(claims.resolve(claim.id, { status: 'REJECTED' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
      `select payload from outbox where type = 'CarrierClaimResolved' and aggregate_id = $1`,
      [claim.id],
    );
    expect(rows.map((row) => row.payload)).toEqual([
      {
        shipmentId: created.id,
        orderId: order.orderId,
        type: 'LOST',
        status: 'ACCEPTED',
        claimed: { amount: 12_000, currency: 'PLN' },
        recovered: { amount: 10_000, currency: 'PLN' },
      },
    ]);
  });
});

describe('powiadomienie po opłaceniu (kryterium 2)', () => {
  it('OrderPaid: sprzedający dostaje „Opłacono” z linkiem do nadania', async () => {
    const order = await sale();
    const db = api.app.get<Database>(DRIZZLE);
    await db.transaction(async (tx) => {
      await api.app.get(Outbox).add(
        tx,
        OrderPaid.create({
          aggregateId: order.orderId,
          payload: {
            publicId: order.publicId,
            auctionId: order.auctionId,
            buyerId: order.buyer.id,
            sellerId: order.seller.id,
            total: { amount: 13_597, currency: 'PLN' },
            paidAt: new Date().toISOString(),
            shipBy: '2026-10-29T22:59:59.000Z',
          },
        }),
      );
    });
    const notification = await waitFor(async () => {
      const response = await call('GET', '/v1/me/notifications', order.seller);
      const items = response.json<{
        items: { type: string; title: string; body: string; url: string }[];
      }>().items;
      return items.find((item) => item.type === 'ORDER_PAID');
    }, 'powiadomienie ORDER_PAID');
    expect(notification.title).toBe('Opłacono: Wazon ceramiczny, lata 70.');
    expect(notification.body).toContain('Nadaj paczkę do');
    expect(notification.url).toContain(`/zamowienia/${order.publicId}/nadaj`);
  });
});

describe('punkty odbioru i trasy deweloperskie (kryterium 5)', () => {
  it('punkty: wymagają sesji; kurier 422; brak miejsca 400', async () => {
    const user = await createUser(api, pool);
    expect(
      (await call('GET', '/v1/shipping/points?carrier=inpost-paczkomat&q=Kraków')).statusCode,
    ).toBe(401);
    const points = await call(
      'GET',
      '/v1/shipping/points?carrier=inpost-paczkomat&q=Kraków&limit=3',
      user,
    );
    expect(points.statusCode, points.body).toBe(200);
    expect(points.json()).toHaveLength(3);
    expect(points.json<{ address: string }[]>()[0]?.address).toContain('Kraków');
    const courier = await call('GET', '/v1/shipping/points?carrier=dpd-kurier&q=Kraków', user);
    expect(problemOf(courier).code).toBe('SHIPPING_OPTION_UNAVAILABLE');
    expect(
      (await call('GET', '/v1/shipping/points?carrier=inpost-paczkomat', user)).statusCode,
    ).toBe(400);
  });

  it('panel: przesyłka testowa bez zamówienia, „Nadaj”, etykieta, status i scenariusz z panelu', async () => {
    const user = await createUser(api, pool, { name: 'Testerka Dostaw' });
    expect((await call('GET', '/v1/dev/fake-shipping')).statusCode).toBe(401);
    const created = await call('POST', '/v1/dev/fake-shipping/shipments', user, {
      carrierId: 'dpd-kurier',
      packageSize: 'XL',
    });
    expect(created.statusCode, created.body).toBe(201);
    const shipment = created.json<ShipmentDto>();
    expect(shipment).toMatchObject({
      status: 'PENDING',
      price: 4_499,
      dispatchMethods: ['DROP_OFF', 'COURIER_PICKUP'],
    });
    const dispatched = await call(
      'POST',
      `/v1/dev/fake-shipping/shipments/${shipment.id}/dispatch`,
      user,
      {
        sender,
        dispatchMethod: 'COURIER_PICKUP',
      },
    );
    expect(dispatched.statusCode, dispatched.body).toBe(202);
    const overview = await waitFor(async () => {
      const response = await call('GET', '/v1/dev/fake-shipping', user);
      const row = response
        .json<{
          shipments: {
            shipment: ShipmentDto;
            orderId: string | null;
            parcel: { id: string } | null;
          }[];
        }>()
        .shipments.find((entry) => entry.shipment.id === shipment.id);
      return row?.parcel === null || row === undefined ? undefined : row;
    }, 'przesyłka testowa u FakeShipping');
    expect(overview.orderId).toBeNull();
    // Kurier odbiera paczkę: etykieta zamiast kodu nadania.
    expect(overview.shipment.dropoffCode).toBeNull();
    await waitFor(
      async () =>
        (await call('GET', `/v1/dev/fake-shipping/shipments/${shipment.id}/label`, user))
          .statusCode === 200,
      'etykieta przesyłki testowej',
    );

    const parcelId = overview.parcel?.id ?? '';
    const scenario = await call(
      'POST',
      `/v1/dev/fake-shipping/parcels/${parcelId}/scenario`,
      user,
      { scenario: 'MANUAL' },
    );
    expect(scenario.json()).toMatchObject({ scenario: 'MANUAL' });
    const advanced = await call('POST', `/v1/dev/fake-shipping/parcels/${parcelId}/advance`, user, {
      status: 'exception',
      deliverWebhook: false,
    });
    expect(advanced.statusCode, advanced.body).toBe(200);
    const synced = await call('POST', `/v1/dev/fake-shipping/shipments/${shipment.id}/sync`, user);
    expect(synced.json<ShipmentDto>().status).toBe('EXCEPTION');
    const end = await call('POST', `/v1/dev/fake-shipping/parcels/${parcelId}/advance`, user, {});
    expect(problemOf(end).code).toBe('CONFLICT');
  });
});

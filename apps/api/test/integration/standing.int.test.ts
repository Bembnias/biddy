// Kryteria F-61 na prawdziwym Postgresie i Redisie: strike'i z konsumentów eventów (worker
// w procesie testu), blokady licytowania i wystawiania w guardach API, cofnięcie, odwołania,
// poziomy z historii zamówień, polityka kont zmieniana bez deployu i nadpisania limitów.
// Aukcje powstają wprost w bazie (jak w testach licytowania), zamówienia przez Kup teraz.
import { DEFAULT_ACCOUNT_POLICY } from '@biddy/shared';
import type { LightMyRequestResponse } from 'fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Database, DRIZZLE, newId } from '../../src/infra/db/index.js';
import { Outbox } from '../../src/infra/outbox/index.js';
import { StrikeService } from '../../src/modules/identity/index.js';
import { OrderPaid, OrderPaymentLifecycle } from '../../src/modules/orders/index.js';
import { RefundRequested } from '../../src/modules/payments/index.js';
import { ShipmentStatusChanged } from '../../src/modules/shipping/index.js';
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

const DAY = 24 * 60 * 60 * 1000;

let database: ScratchDatabase;
let pool: Pool;
let api: TestApp;
let worker: TestWorker;
let db: Database;
let lifecycle: OrderPaymentLifecycle;
let seller: TestUser;
let admin: TestUser;
let keyCounter = 0;

beforeAll(async () => {
  database = await createMigratedDatabase();
  pool = new Pool({ connectionString: database.url, max: 8 });
  const shared = {
    DATABASE_URL: database.url,
    REDIS_QUEUE_URL: redisUrl(),
    QUEUE_PREFIX: uniqueQueuePrefix(),
    CORS_ORIGINS: WEB_ORIGIN,
  };
  api = await startTestApp(integrationConfig(shared));
  worker = await startTestWorker(workerConfig(database.url, shared));
  db = api.app.get<Database>(DRIZZLE);
  lifecycle = api.app.get(OrderPaymentLifecycle);
  seller = await createUser(api, pool, { name: 'Sprzedawca Strike' });
  admin = await createUser(api, pool, { name: 'Admin Biddy' });
  await pool.query(`update users set staff_role = 'admin' where id = $1`, [admin.id]);
}, 180_000);

afterAll(async () => {
  await worker.close();
  await api.close();
  await pool.end();
  await database.drop();
});

function call(
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  user?: TestUser,
  body?: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  return api.http.inject({
    method,
    url,
    headers: {
      origin: WEB_ORIGIN,
      ...(user === undefined ? {} : { cookie: user.cookie }),
      ...headers,
    },
    ...(body === undefined ? {} : { payload: body }),
  });
}

/** Aktywna aukcja (wiersze przedmiotu i aukcji wprost w bazie). */
async function auction(
  owner: TestUser = seller,
  options: { readonly buyNowPrice?: number } = {},
): Promise<string> {
  const itemId = newId();
  const id = newId();
  await pool.query(
    `insert into items (id, seller_id, title) values ($1, $2, 'Lampa biurkowa z mosiądzu')`,
    [itemId, owner.id],
  );
  await pool.query(
    `insert into auctions (id, public_id, item_id, seller_id, status, start_price, buy_now_price,
       duration_days, starts_at, ends_at, original_ends_at, published_at)
     values ($1, $2, $3, $4, 'ACTIVE', 1000, $5, 7, now(), now() + interval '7 days',
       now() + interval '7 days', now())`,
    [id, id.slice(-8), itemId, owner.id, options.buyNowPrice ?? null],
  );
  return id;
}

function bid(user: TestUser, auctionId: string, maxAmount: number) {
  return call(
    'POST',
    `/v1/auctions/${auctionId}/bids`,
    user,
    { maxAmount },
    {
      'idempotency-key': `s-${String((keyCounter += 1))}`,
    },
  );
}

/** Zamówienie z Kup teraz przez kupującego (AWAITING_PAYMENT). */
async function order(buyer: TestUser): Promise<{ id: string; publicId: string }> {
  const id = await auction(seller, { buyNowPrice: 5_000 });
  const bought = await call('POST', `/v1/auctions/${id}/buy-now`, buyer, undefined, {
    'idempotency-key': `bn-${String((keyCounter += 1))}`,
  });
  expect(bought.statusCode, bought.body).toBe(201);
  const { rows } = await pool.query<{ id: string; public_id: string }>(
    `select o.id, o.public_id from orders o join order_items i on i.order_id = o.id
     where i.auction_id = $1`,
    [id],
  );
  return { id: rows[0]?.id ?? '', publicId: rows[0]?.public_id ?? '' };
}

/** Anulowanie nieopłaconego zamówienia po terminie (job F-25), a potem strike z konsumenta. */
async function expireUnpaid(orderId: string): Promise<void> {
  await pool.query(`update orders set payment_due_at = now() - interval '1 minute' where id = $1`, [
    orderId,
  ]);
  await lifecycle.expireUnpaid(new Date());
  await waitFor(
    async () =>
      (await pool.query(`select 1 from strikes where source_key = $1`, [`UNPAID:${orderId}`]))
        .rowCount === 1,
    `strike UNPAID zamówienia ${orderId}`,
  );
}

interface StandingView {
  buyer: {
    level: string;
    limits: { maxBidAmount: number | null; maxActiveAuctions: number | null };
    overridden: boolean;
    next: { level: string; requirements: { kind: string; met: boolean }[] } | null;
    block: { id: string; until: string | null } | null;
  };
  seller: { level: string; block: { id: string; until: string | null } | null };
  strikes: { windowDays: number; threshold: number; buyer: number; seller: number };
}

async function standing(user: TestUser): Promise<StandingView> {
  const response = await call('GET', '/v1/me/standing', user);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<StandingView>();
}

interface StrikesView {
  strikes: {
    id: string;
    reason: string;
    statement: string;
    state: string;
    canAppeal: boolean;
    revokeNote: string | null;
    appeal: { status: string; note: string | null };
  }[];
  blocks: { id: string; kind: string; state: string; endsAt: string | null; canAppeal: boolean }[];
}

async function strikes(user: TestUser): Promise<StrikesView> {
  const response = await call('GET', '/v1/me/strikes', user);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<StrikesView>();
}

async function notificationTypes(user: TestUser): Promise<string[]> {
  const { rows } = await pool.query<{ type: string }>(
    `select type from notifications where user_id = $1 order by created_at`,
    [user.id],
  );
  return rows.map((row) => row.type);
}

/** Event wprost w outboxie (zdarzenie z innego modułu, którego pełny przebieg testują F-24/F-25). */
async function publish(event: Parameters<Outbox['add']>[1]): Promise<void> {
  const outbox = api.app.get(Outbox);
  await db.transaction((tx) => outbox.add(tx, event));
}

describe('strike’i kupującego i blokada licytowania (kryteria 1, 3, 8)', () => {
  it('trzy nieopłacone zamówienia: trzy strike’i, blokada na 30 dni i 403 BIDDING_BLOCKED', async () => {
    const buyer = await createUser(api, pool, { name: 'Kupujący Niepłacący' });
    const orders = [await order(buyer), await order(buyer), await order(buyer)];

    await expireUnpaid(orders[0]?.id ?? '');
    await expireUnpaid(orders[1]?.id ?? '');
    expect((await standing(buyer)).strikes).toMatchObject({ buyer: 2, threshold: 3 });
    expect((await bid(buyer, await auction(), 2_000)).statusCode).toBe(201);

    await expireUnpaid(orders[2]?.id ?? '');
    const view = await standing(buyer);
    expect(view.buyer.block).not.toBeNull();
    const until = new Date(view.buyer.block?.until ?? '');
    expect(Math.abs(until.getTime() - (Date.now() + 30 * DAY))).toBeLessThan(60_000);

    const blocked = await bid(buyer, await auction(), 2_000);
    expect(blocked.statusCode).toBe(403);
    expect(problemOf(blocked)).toMatchObject({
      code: 'BIDDING_BLOCKED',
      blockedUntil: view.buyer.block?.until,
      blockId: view.buyer.block?.id,
    });
    expect(problemOf(blocked).detail).toContain('Limity i strike');

    const history = await strikes(buyer);
    expect(history.strikes).toHaveLength(3);
    expect(history.strikes.every((item) => item.reason === 'UNPAID')).toBe(true);
    expect(history.strikes[0]?.statement).toContain(orders[2]?.publicId);
    expect(history.strikes[0]?.statement).toContain('Lampa biurkowa z mosiądzu');
    expect(history.blocks).toEqual([
      expect.objectContaining({ kind: 'BIDDING', state: 'ACTIVE', canAppeal: true }),
    ]);

    await waitFor(async () => {
      const types = await notificationTypes(buyer);
      return types.filter((type) => type === 'STRIKE_ISSUED').length === 3 &&
        types.includes('ACCOUNT_BLOCKED')
        ? types
        : undefined;
    }, 'powiadomienia o strike’ach i blokadzie');
  });

  it('ponowiony event nie daje drugiego strike’a; strike sprzed 90 dni się nie liczy (kryterium 2)', async () => {
    const buyer = await createUser(api, pool);
    const first = await order(buyer);
    await expireUnpaid(first.id);
    const service = api.app.get(StrikeService);
    const again = await db.transaction((tx) =>
      service.issue(tx, {
        userId: buyer.id,
        reason: 'UNPAID',
        sourceKey: `UNPAID:${first.id}`,
        orderId: first.id,
      }),
    );
    expect(again).toBeUndefined();

    await pool.query(
      `update strikes set created_at = now() - interval '91 days' where user_id = $1`,
      [buyer.id],
    );
    await expireUnpaid((await order(buyer)).id);
    await expireUnpaid((await order(buyer)).id);
    const view = await standing(buyer);
    expect(view.strikes.buyer).toBe(2);
    expect(view.buyer.block).toBeNull();
  });

  it('równoległe strike’i dają jedną blokadę', async () => {
    const buyer = await createUser(api, pool);
    const service = api.app.get(StrikeService);
    await Promise.all(
      [1, 2, 3, 4].map((index) =>
        db.transaction((tx) =>
          service.issue(tx, {
            userId: buyer.id,
            reason: 'UNPAID',
            sourceKey: `UNPAID:parallel-${buyer.id}-${String(index)}`,
          }),
        ),
      ),
    );
    const { rows } = await pool.query<{ count: string }>(
      `select count(*) from account_blocks where user_id = $1`,
      [buyer.id],
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('druga blokada w ciągu 12 miesięcy jest bezterminowa (kryterium 6)', async () => {
    const buyer = await createUser(api, pool);
    await pool.query(
      `insert into account_blocks (id, user_id, kind, cause, strike_ids, starts_at, ends_at, statement)
       values ($1, $2, 'BIDDING', 'STRIKES', '{}', now() - interval '100 days',
         now() - interval '70 days', 'Pierwsza blokada')`,
      [newId(), buyer.id],
    );
    const service = api.app.get(StrikeService);
    for (const index of [1, 2, 3]) {
      await db.transaction((tx) =>
        service.issue(tx, {
          userId: buyer.id,
          reason: 'UNPAID',
          sourceKey: `UNPAID:escalation-${buyer.id}-${String(index)}`,
        }),
      );
    }
    const blocked = await bid(buyer, await auction(), 2_000);
    expect(problemOf(blocked)).toMatchObject({ code: 'BIDDING_BLOCKED', blockedUntil: null });
    expect(problemOf(blocked).detail).toContain('bezterminową blokadę licytowania');
    expect((await strikes(buyer)).blocks[0]?.endsAt).toBeNull();
  });
});

describe('cofnięcie i odwołania (kryteria 3, 4)', () => {
  it('odwołanie, decyzja personelu, cofnięcie zdejmuje blokadę', async () => {
    const buyer = await createUser(api, pool);
    for (let index = 0; index < 3; index += 1) {
      await expireUnpaid((await order(buyer)).id);
    }
    const [newest, middle] = (await strikes(buyer)).strikes;
    const strikeId = newest?.id ?? '';

    const tooShort = await call('POST', `/v1/me/strikes/${strikeId}/appeal`, buyer, {
      message: 'Za krótko',
    });
    expect(tooShort.statusCode).toBe(400);
    const stranger = await createUser(api, pool);
    const foreign = await call('POST', `/v1/me/strikes/${strikeId}/appeal`, stranger, {
      message: 'Próba odwołania od cudzego strike’a, która powinna się nie udać.',
    });
    expect(problemOf(foreign).code).toBe('STRIKE_NOT_FOUND');
    expect(
      problemOf(
        await call('POST', '/v1/me/strikes/nie-uuid/appeal', buyer, {
          message: 'Identyfikator w złym formacie też daje 404, a nie 400.',
        }),
      ).code,
    ).toBe('STRIKE_NOT_FOUND');

    const appealed = await call('POST', `/v1/me/strikes/${strikeId}/appeal`, buyer, {
      message: 'Bank odrzucił płatność BLIK z powodu awarii, mam potwierdzenie z banku.',
    });
    expect(appealed.statusCode, appealed.body).toBe(200);
    expect(appealed.json()).toMatchObject({ appeal: { status: 'PENDING' }, canAppeal: false });
    const twice = await call('POST', `/v1/me/strikes/${strikeId}/appeal`, buyer, {
      message: 'Drugie odwołanie od tego samego strike’a nie powinno przejść.',
    });
    expect(problemOf(twice).code).toBe('APPEAL_NOT_ALLOWED');

    const pending = await call('GET', '/v1/admin/appeals', admin);
    expect(pending.statusCode, pending.body).toBe(200);
    expect(pending.json<{ strikes: { id: string }[] }>().strikes.map((item) => item.id)).toContain(
      strikeId,
    );
    expect((await call('GET', '/v1/admin/appeals', buyer)).statusCode).toBe(403);

    const accepted = await call('POST', `/v1/admin/strikes/${strikeId}/appeal-decision`, admin, {
      decision: 'ACCEPTED',
      note: 'Potwierdzenie z banku: awaria po stronie banku.',
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toMatchObject({
      state: 'REVOKED',
      revokeNote: 'Potwierdzenie z banku: awaria po stronie banku.',
      appeal: { status: 'ACCEPTED' },
    });
    const again = await call('POST', `/v1/admin/strikes/${strikeId}/appeal-decision`, admin, {
      decision: 'REJECTED',
      note: 'Druga decyzja w tym samym odwołaniu.',
    });
    expect(problemOf(again).code).toBe('APPEAL_NOT_PENDING');

    const after = await standing(buyer);
    expect(after.buyer.block).toBeNull();
    expect(after.strikes.buyer).toBe(2);
    expect((await strikes(buyer)).blocks[0]?.state).toBe('LIFTED');
    expect((await bid(buyer, await auction(), 2_000)).statusCode).toBe(201);

    // Odrzucone odwołanie: decyzja zostaje, użytkownik dostaje uzasadnienie.
    const middleId = middle?.id ?? '';
    await call('POST', `/v1/me/strikes/${middleId}/appeal`, buyer, {
      message: 'Nie dostałem powiadomienia o terminie płatności tego zamówienia.',
    });
    const rejected = await call('POST', `/v1/admin/strikes/${middleId}/appeal-decision`, admin, {
      decision: 'REJECTED',
      note: 'Powiadomienie i e-mail wyszły zaraz po zakupie.',
    });
    expect(rejected.json()).toMatchObject({
      state: 'ACTIVE',
      appeal: { status: 'REJECTED', note: 'Powiadomienie i e-mail wyszły zaraz po zakupie.' },
    });

    await waitFor(async () => {
      const types = await notificationTypes(buyer);
      return ['STRIKE_REVOKED', 'ACCOUNT_UNBLOCKED', 'APPEAL_REJECTED'].every((type) =>
        types.includes(type),
      )
        ? types
        : undefined;
    }, 'powiadomienia o cofnięciu, zdjęciu blokady i odrzuceniu');
  });

  it('cofnięcie przez support i ręczny strike za podróbkę', async () => {
    const support = await createUser(api, pool);
    await pool.query(`update users set staff_role = 'support' where id = $1`, [support.id]);
    const counterfeiter = await createUser(api, pool);

    const issued = await call('POST', '/v1/admin/strikes', support, {
      userId: counterfeiter.id,
      reason: 'COUNTERFEIT',
      note: 'Kopia torebki potwierdzona przez rzeczoznawcę.',
    });
    expect(issued.statusCode, issued.body).toBe(201);
    const strike = issued.json<{ id: string; statement: string; issuedBy: string }>();
    expect(strike.issuedBy).toBe(support.id);
    expect(strike.statement).toContain('Kopia torebki potwierdzona przez rzeczoznawcę.');
    const blocks = (await strikes(counterfeiter)).blocks;
    expect(blocks.map((block) => [block.kind, block.endsAt]).sort()).toEqual([
      ['LISTING', null],
      ['PAYOUTS', null],
    ]);
    expect((await standing(counterfeiter)).seller.block).toMatchObject({ until: null });

    const other = await call('POST', '/v1/admin/strikes', support, {
      userId: counterfeiter.id,
      reason: 'OTHER',
      note: 'Bez roli przy OTHER nie wolno.',
    });
    expect(other.statusCode).toBe(400);

    const revoked = await call('POST', `/v1/admin/strikes/${strike.id}/revoke`, support, {
      note: 'Rzeczoznawca się pomylił.',
    });
    expect(revoked.json()).toMatchObject({ state: 'REVOKED' });
    expect((await standing(counterfeiter)).seller.block).toBeNull();
    const lift = await call(
      'POST',
      `/v1/admin/account-blocks/${blocks[0]?.id ?? ''}/lift`,
      support,
      {
        note: 'Support nie zdejmuje blokad.',
      },
    );
    expect(lift.statusCode).toBe(403);
  });
});

describe('źródła strike’ów z innych modułów', () => {
  it('spóźniona płatność cofa strike za brak płatności (§6.8)', async () => {
    const buyer = await createUser(api, pool);
    const unpaid = await order(buyer);
    await expireUnpaid(unpaid.id);
    await publish(
      RefundRequested.create({
        aggregateId: newId(),
        payload: {
          paymentId: newId(),
          orderId: unpaid.id,
          amount: { amount: 5_000, currency: 'PLN' },
          reason: 'LATE_PAYMENT',
        },
      }),
    );
    const revoked = await waitFor(async () => {
      const [item] = (await strikes(buyer)).strikes;
      return item?.state === 'REVOKED' ? item : undefined;
    }, 'cofnięty strike po spóźnionej płatności');
    expect(revoked.revokeNote).toContain('Płatność dotarła po terminie');
  });

  it('nieodebrana paczka daje strike NOT_COLLECTED kupującemu', async () => {
    const buyer = await createUser(api, pool);
    const placed = await order(buyer);
    const returning = {
      orderId: placed.id,
      direction: 'OUTBOUND' as const,
      status: 'RETURNING' as const,
      previousStatus: 'READY_FOR_PICKUP' as const,
      occurredAt: new Date().toISOString(),
      detectedAt: new Date().toISOString(),
      returnReason: 'NOT_COLLECTED' as const,
    };
    await publish(ShipmentStatusChanged.create({ aggregateId: newId(), payload: returning }));
    await publish(ShipmentStatusChanged.create({ aggregateId: newId(), payload: returning }));
    await waitFor(async () => {
      const list = (await strikes(buyer)).strikes;
      return list.length === 1 && list[0]?.reason === 'NOT_COLLECTED' ? list : undefined;
    }, 'strike za nieodebraną paczkę');
    expect((await strikes(buyer)).strikes[0]?.statement).toContain(placed.publicId);
  });

  it('anulowanie aukcji z ofertami: strike sprzedającego, po trzecim 403 LISTING_BLOCKED (kryterium 9)', async () => {
    const owner = await createUser(api, pool, { name: 'Sprzedawca Anulujący' });
    const bidder = await createUser(api, pool);
    for (let index = 0; index < 3; index += 1) {
      const id = await auction(owner);
      expect((await bid(bidder, id, 2_000)).statusCode).toBe(201);
      const cancelled = await call('POST', `/v1/auctions/${id}/cancel`, owner);
      expect(cancelled.statusCode, cancelled.body).toBe(200);
    }
    const noBids = await auction(owner);
    expect((await call('POST', `/v1/auctions/${noBids}/cancel`, owner)).statusCode).toBe(200);

    await waitFor(async () => {
      const view = await standing(owner);
      return view.seller.block === null ? undefined : view;
    }, 'blokada wystawiania');
    const list = (await strikes(owner)).strikes;
    expect(list).toHaveLength(3);
    expect(list.every((item) => item.reason === 'AUCTION_CANCELLED_WITH_BIDS')).toBe(true);

    const draft = await call('POST', '/v1/auctions', owner);
    const published = await call(
      'POST',
      `/v1/auctions/${draft.json<{ id: string }>().id}/publish`,
      owner,
      {
        kycNoticeAccepted: true,
      },
    );
    expect(problemOf(published)).toMatchObject({ code: 'LISTING_BLOCKED' });
  });
});

describe('poziomy, polityka i nadpisania (kryteria 5, 7)', () => {
  it('OrderPaid podnosi poziom kupującego: limit oferty 5000 zł', async () => {
    const buyer = await createUser(api, pool);
    const before = await standing(buyer);
    expect(before.buyer).toMatchObject({
      level: 'NEW',
      limits: { maxBidAmount: 250_000, maxActiveAuctions: 10 },
      next: { level: 'CHECKED', requirements: [{ kind: 'PAID_ORDERS', met: false }] },
    });
    const paid = await order(buyer);
    await publish(
      OrderPaid.create({
        aggregateId: paid.id,
        payload: {
          publicId: paid.publicId,
          auctionId: newId(),
          buyerId: buyer.id,
          sellerId: seller.id,
          total: { amount: 5_000, currency: 'PLN' },
          paidAt: new Date().toISOString(),
          shipBy: new Date(Date.now() + 7 * DAY).toISOString(),
        },
      }),
    );
    const after = await waitFor(async () => {
      const view = await standing(buyer);
      return view.buyer.level === 'CHECKED' ? view : undefined;
    }, 'poziom sprawdzonego kupującego');
    expect(after.buyer.limits).toEqual({ maxBidAmount: 500_000, maxActiveAuctions: 50 });
    expect((await bid(buyer, await auction(), 300_000)).statusCode).toBe(201);
  });

  it('nadpisanie limitów użytkownika i polityka kont bez deployu', async () => {
    const buyer = await createUser(api, pool);
    const override = await call('PUT', `/v1/admin/users/${buyer.id}/limits`, admin, {
      limits: { buyer: { maxBidAmount: null } },
    });
    expect(override.statusCode, override.body).toBe(200);
    expect(override.json()).toMatchObject({
      limitsOverride: { buyer: { maxBidAmount: null } },
      buyer: { overridden: true, limits: { maxBidAmount: null } },
    });
    expect((await bid(buyer, await auction(), 900_000)).statusCode).toBe(201);
    await call('PUT', `/v1/admin/users/${buyer.id}/limits`, admin, { limits: null });
    expect((await standing(buyer)).buyer.overridden).toBe(false);

    const support = await createUser(api, pool);
    await pool.query(`update users set staff_role = 'support' where id = $1`, [support.id]);
    const strict = {
      ...DEFAULT_ACCOUNT_POLICY,
      buyer: {
        ...DEFAULT_ACCOUNT_POLICY.buyer,
        levels: {
          ...DEFAULT_ACCOUNT_POLICY.buyer.levels,
          NEW: { maxBidAmount: 10_000, maxActiveAuctions: 10 },
        },
      },
    };
    expect(
      (await call('PUT', '/v1/admin/account-policy', support, { policy: strict })).statusCode,
    ).toBe(403);
    const invalid = await call('PUT', '/v1/admin/account-policy', admin, {
      policy: { ...strict, strikes: { ...strict.strikes, blockThreshold: 0 } },
    });
    expect(invalid.statusCode).toBe(400);
    try {
      const saved = await call('PUT', '/v1/admin/account-policy', admin, {
        policy: strict,
        note: 'Test: niższy limit nowych kont',
      });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(saved.json()).toMatchObject({
        createdBy: admin.id,
        note: 'Test: niższy limit nowych kont',
      });
      const limited = await bid(buyer, await auction(), 10_001);
      expect(problemOf(limited)).toMatchObject({ code: 'BID_LIMIT_EXCEEDED', limit: 10_000 });
      expect((await standing(buyer)).buyer.limits.maxBidAmount).toBe(10_000);
    } finally {
      await call('PUT', '/v1/admin/account-policy', admin, { policy: DEFAULT_ACCOUNT_POLICY });
    }
    expect((await standing(buyer)).buyer.limits.maxBidAmount).toBe(250_000);
  });
});

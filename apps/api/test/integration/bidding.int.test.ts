// Kryteria F-15 na prawdziwym Postgresie (Testcontainers): licytacja automatyczna przez API,
// odrzucenia (kwota, status, czas, własna aukcja, telefon, blokada, limity), anti-sniping,
// idempotencja (także równoległa), Kup teraz, historia, unieważnienie z replayem i 50
// równoległych ofert na jedną aukcję. Aukcje aktywne wstawiamy wprost do bazy (kreator: F-14).
import { replay } from '@biddy/shared';
import type { LightMyRequestResponse } from 'fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId } from '../../src/infra/db/index.js';
import { type TestUser, WEB_ORIGIN, createUser } from './support/accounts.js';
import { integrationConfig, problemOf, startTestApp, type TestApp } from './support/app.js';
import type { ScratchDatabase } from './support/database.js';
import { createMigratedDatabase, redisUrl, uniqueQueuePrefix } from './support/worker.js';

const MINUTE = 60_000;

let database: ScratchDatabase;
let pool: Pool;
let api: TestApp;
let seller: TestUser;

beforeAll(async () => {
  database = await createMigratedDatabase();
  pool = new Pool({ connectionString: database.url, max: 8 });
  api = await startTestApp(
    integrationConfig({
      DATABASE_URL: database.url,
      REDIS_QUEUE_URL: redisUrl(),
      QUEUE_PREFIX: uniqueQueuePrefix(),
    }),
  );
  seller = await createUser(api, pool, { name: 'Sprzedawca Testowy' });
}, 120_000);

afterAll(async () => {
  await api.close();
  await pool.end();
  await database.drop();
});

interface AuctionOptions {
  readonly startPrice?: number;
  readonly reservePrice?: number | null;
  readonly buyNowPrice?: number | null;
  readonly endsInMs?: number;
  readonly status?: string;
}

/** Aktywna aukcja sprzedającego (wiersze przedmiotu i aukcji wprost w bazie). */
async function auction(options: AuctionOptions = {}): Promise<string> {
  const itemId = newId();
  const id = newId();
  await pool.query(
    `insert into items (id, seller_id, title) values ($1, $2, 'Przedmiot testowy na aukcji')`,
    [itemId, seller.id],
  );
  await pool.query(
    `insert into auctions (id, public_id, item_id, seller_id, status, start_price, reserve_price,
       buy_now_price, duration_days, starts_at, ends_at, original_ends_at, published_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 7, now(), now() + $9 * interval '1 millisecond',
       now() + $9 * interval '1 millisecond', now())`,
    [
      id,
      id.slice(-8),
      itemId,
      seller.id,
      options.status ?? 'ACTIVE',
      options.startPrice ?? 1_000,
      options.reservePrice ?? null,
      options.buyNowPrice ?? null,
      options.endsInMs ?? 7 * 24 * 60 * MINUTE,
    ],
  );
  return id;
}

let keyCounter = 0;

function bid(
  user: TestUser,
  auctionId: string,
  maxAmount: number,
  key = `k-${String((keyCounter += 1))}`,
): Promise<LightMyRequestResponse> {
  return api.http.inject({
    method: 'POST',
    url: `/v1/auctions/${auctionId}/bids`,
    headers: { origin: WEB_ORIGIN, cookie: user.cookie, 'idempotency-key': key },
    payload: { maxAmount },
  });
}

function buyNow(user: TestUser, auctionId: string, key = `b-${String((keyCounter += 1))}`) {
  return api.http.inject({
    method: 'POST',
    url: `/v1/auctions/${auctionId}/buy-now`,
    headers: { origin: WEB_ORIGIN, cookie: user.cookie, 'idempotency-key': key },
  });
}

interface AuctionRow {
  status: string;
  current_price: string | null;
  leader_id: string | null;
  leader_max_amount: string | null;
  bid_count: number;
  bid_sequence: number;
  ends_at: Date;
  original_ends_at: Date;
}

async function row(auctionId: string): Promise<AuctionRow> {
  const { rows } = await pool.query<AuctionRow>('select * from auctions where id = $1', [
    auctionId,
  ]);
  if (rows[0] === undefined) {
    throw new Error('brak aukcji');
  }
  return rows[0];
}

async function outbox(type: string, auctionId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
    'select payload from outbox where type = $1 and aggregate_id = $2 order by occurred_at',
    [type, auctionId],
  );
  return rows.map((entry) => entry.payload);
}

describe('licytacja automatyczna przez API', () => {
  it('maksimum, odpowiedź lidera, przejęcie prowadzenia, eventy i zanonimizowana historia', async () => {
    const id = await auction({ startPrice: 1_000 });
    const anna = await createUser(api, pool, { name: 'Anna Licytująca' });
    const bartek = await createUser(api, pool, { name: 'Bartek Kupujący' });
    const celina = await createUser(api, pool, { name: 'Celina' });

    const first = await bid(anna, id, 10_000);
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json()).toMatchObject({
      bid: { amount: 1_000, maxAmount: 10_000, kind: 'MANUAL' },
      leading: true,
      auction: { currentPrice: 1_000, bidCount: 1, minimumNextBid: 1_050, reserveStatus: 'NONE' },
    });

    const second = await bid(bartek, id, 5_000);
    expect(second.json()).toMatchObject({
      leading: false,
      auction: { currentPrice: 5_100, bidCount: 3, minimumNextBid: 5_200 },
    });

    const third = await bid(celina, id, 15_000);
    expect(third.json()).toMatchObject({ leading: true, auction: { currentPrice: 10_500 } });
    expect(await row(id)).toMatchObject({ leader_max_amount: '15000', bid_count: 4 });

    expect(await outbox('BidPlaced', id)).toHaveLength(3);
    expect(await outbox('UserOutbid', id)).toEqual([
      {
        userId: anna.id,
        currentPrice: { amount: 10_500, currency: 'PLN' },
        endsAt: expect.any(String) as string,
      },
    ]);
    for (const payload of await outbox('BidPlaced', id)) {
      expect(JSON.stringify(payload)).not.toContain('15000');
    }

    const history = await api.http.inject({ method: 'GET', url: `/v1/auctions/${id}/bids` });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toEqual({
      currency: 'PLN',
      nextBefore: null,
      items: [
        expect.objectContaining({ amount: 10_500, kind: 'MANUAL', bidder: 'c***a' }),
        expect.objectContaining({ amount: 5_100, kind: 'AUTO', bidder: 'a***a' }),
        expect.objectContaining({ amount: 5_000, kind: 'MANUAL', bidder: 'b***y' }),
        expect.objectContaining({ amount: 1_000, kind: 'MANUAL', bidder: 'a***a' }),
      ],
    });
    expect(history.body).not.toContain(anna.id);
    expect(history.body).not.toContain('maxAmount');
  });

  it('cena minimalna: nieosiągnięta, potem osiągnięta przez podniesienie maksimum lidera', async () => {
    const id = await auction({ startPrice: 1_000, reservePrice: 20_000 });
    const buyer = await createUser(api, pool);
    expect((await bid(buyer, id, 15_000)).json()).toMatchObject({
      auction: { currentPrice: 1_000, reserveStatus: 'NOT_MET' },
    });
    const raised = await bid(buyer, id, 25_000);
    expect(raised.json()).toMatchObject({
      leading: true,
      auction: { currentPrice: 20_000, reserveStatus: 'MET' },
    });
  });
});

describe('odrzucenia', () => {
  it('za niska oferta, własna aukcja, telefon, blokada, limity, koniec, szkic, brak klucza', async () => {
    const id = await auction({ startPrice: 2_000 });
    const buyer = await createUser(api, pool);
    const low = await bid(buyer, id, 1_999);
    expect(low.statusCode).toBe(409);
    expect(problemOf(low)).toMatchObject({ code: 'BID_TOO_LOW', minimumBid: 2_000 });
    expect(problemOf(low).detail.replaceAll(' ', ' ')).toBe('Najniższa możliwa oferta to 20 zł.');

    expect(problemOf(await bid(seller, id, 5_000)).code).toBe('OWN_AUCTION');
    const noPhone = await createUser(api, pool, { phone: false });
    expect(problemOf(await bid(noPhone, id, 5_000)).code).toBe('PHONE_NOT_VERIFIED');

    const blocked = await createUser(api, pool);
    await pool.query(
      `update users set bidding_blocked_until = now() + interval '3 days' where id = $1`,
      [blocked.id],
    );
    expect(problemOf(await bid(blocked, id, 5_000))).toMatchObject({
      code: 'BIDDING_BLOCKED',
      blockedUntil: expect.any(String) as string,
    });

    const tooMuch = await bid(buyer, id, 50_001);
    expect(tooMuch.statusCode).toBe(403);
    expect(problemOf(tooMuch)).toMatchObject({
      code: 'BID_LIMIT_EXCEEDED',
      limit: 50_000,
      limitKind: 'BID_AMOUNT',
    });

    const ended = await auction({ endsInMs: -1_000 });
    expect(problemOf(await bid(buyer, ended, 5_000)).code).toBe('AUCTION_ENDED');
    const draft = await auction({ status: 'PENDING_REVIEW' });
    expect((await bid(buyer, draft, 5_000)).statusCode).toBe(404);

    const missingKey = await api.http.inject({
      method: 'POST',
      url: `/v1/auctions/${id}/bids`,
      headers: { origin: WEB_ORIGIN, cookie: buyer.cookie },
      payload: { maxAmount: 5_000 },
    });
    expect(missingKey.statusCode).toBe(400);
    expect(problemOf(missingKey).errors?.[0]?.path).toBe('Idempotency-Key');
    expect((await row(id)).bid_count).toBe(0);
  });

  it('nowy kupujący: najwyżej 10 aukcji z aktywną ofertą', async () => {
    const buyer = await createUser(api, pool);
    for (let index = 0; index < 10; index += 1) {
      expect((await bid(buyer, await auction(), 1_000)).statusCode).toBe(201);
    }
    const eleventh = await bid(buyer, await auction(), 1_000);
    expect(problemOf(eleventh)).toMatchObject({
      code: 'BID_LIMIT_EXCEEDED',
      limit: 10,
      limitKind: 'ACTIVE_AUCTIONS',
    });
  });
});

describe('anti-sniping (§6.5)', () => {
  it('oferta zmieniająca cenę w ostatnich 2 minutach przesuwa koniec; podniesienie maksimum nie', async () => {
    const id = await auction({ endsInMs: MINUTE });
    const anna = await createUser(api, pool);
    const before = await row(id);
    const started = Date.now();
    await bid(anna, id, 10_000);
    const extended = await row(id);
    expect(extended.ends_at.getTime()).toBeGreaterThan(before.ends_at.getTime());
    expect(Math.abs(extended.ends_at.getTime() - (started + 2 * MINUTE))).toBeLessThan(5_000);
    expect(extended.original_ends_at).toEqual(before.original_ends_at);
    expect(await outbox('AuctionExtended', id)).toHaveLength(1);

    await bid(anna, id, 20_000);
    expect((await row(id)).ends_at).toEqual(extended.ends_at);
    expect(await outbox('AuctionExtended', id)).toHaveLength(1);

    const far = await auction({ endsInMs: 10 * MINUTE });
    const farBefore = await row(far);
    await bid(anna, far, 10_000);
    expect((await row(far)).ends_at).toEqual(farBefore.ends_at);
  });
});

describe('idempotencja', () => {
  it('ponowienie i równoległe żądania z tym samym kluczem: jedna oferta', async () => {
    const id = await auction();
    const buyer = await createUser(api, pool);
    const first = await bid(buyer, id, 5_000, 'retry-1');
    const again = await bid(buyer, id, 5_000, 'retry-1');
    expect(again.statusCode).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.json<{ bid: { id: string } }>().bid.id).toBe(
      first.json<{ bid: { id: string } }>().bid.id,
    );

    const parallel = await Promise.all(
      Array.from({ length: 6 }, () => bid(buyer, id, 9_000, 'parallel-1')),
    );
    const ids = new Set(
      parallel.map((response) => response.json<{ bid: { id: string } }>().bid.id),
    );
    expect(parallel.every((response) => response.statusCode === 201)).toBe(true);
    expect(ids.size).toBe(1);
    const { rows } = await pool.query('select id from bids where auction_id = $1', [id]);
    expect(rows).toHaveLength(2);

    const reused = await bid(buyer, id, 9_500, 'retry-1');
    expect(reused.statusCode).toBe(422);
    expect(problemOf(reused).code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});

describe('Kup teraz', () => {
  it('bez ofert kończy aukcję jako sprzedaną; po ofercie niedostępne; limit kwoty', async () => {
    const withBid = await auction({ buyNowPrice: 5_000 });
    const anna = await createUser(api, pool);
    const bartek = await createUser(api, pool);
    await bid(anna, withBid, 2_000);
    expect(problemOf(await buyNow(bartek, withBid)).code).toBe('BUY_NOW_UNAVAILABLE');

    const id = await auction({ buyNowPrice: 5_000 });
    const bought = await buyNow(bartek, id);
    expect(bought.statusCode, bought.body).toBe(201);
    expect(bought.json()).toMatchObject({
      bid: { kind: 'BUY_NOW', amount: 5_000 },
      leading: true,
      auction: { status: 'ENDED_SOLD', currentPrice: 5_000, buyNowAvailable: false },
    });
    expect(await outbox('AuctionEnded', id)).toEqual([
      expect.objectContaining({
        outcome: 'SOLD',
        winnerId: bartek.id,
        finalPrice: { amount: 5_000, currency: 'PLN' },
        endedBy: 'BUY_NOW',
      }),
    ]);
    expect(problemOf(await bid(anna, id, 10_000)).code).toBe('AUCTION_ENDED');

    const pricey = await auction({ buyNowPrice: 60_000 });
    expect(problemOf(await buyNow(bartek, pricey)).code).toBe('BID_LIMIT_EXCEEDED');
  });
});

describe('historia ofert', () => {
  it('kursor: po 50 ofert od najnowszej', async () => {
    const id = await auction({ startPrice: 100 });
    const buyers = [await createUser(api, pool), await createUser(api, pool)];
    // Naprzemienne oferty bez automatycznych odpowiedzi: każda o krok wyżej niż poprzednia.
    let amount = 100;
    for (let index = 0; index < 55; index += 1) {
      const response = await bid(buyers[index % 2] as TestUser, id, amount);
      expect(response.statusCode, response.body).toBe(201);
      amount = response.json<{ auction: { minimumNextBid: number } }>().auction.minimumNextBid;
    }
    const page = (await api.http.inject({ method: 'GET', url: `/v1/auctions/${id}/bids` })).json<{
      items: unknown[];
      nextBefore: number;
    }>();
    expect(page.items).toHaveLength(50);
    const rest = (
      await api.http.inject({
        method: 'GET',
        url: `/v1/auctions/${id}/bids?before=${String(page.nextBefore)}`,
      })
    ).json<{ items: unknown[]; nextBefore: number | null }>();
    expect(rest.items.length + 50).toBe((await row(id)).bid_count);
    expect(rest.nextBefore).toBeNull();
  });
});

describe('unieważnienie oferty (§15.6)', () => {
  it('replay pozostałych ofert, automatyczne unieważnione, koniec bez zmian, tylko personel', async () => {
    const id = await auction({ startPrice: 1_000 });
    const anna = await createUser(api, pool);
    const bartek = await createUser(api, pool);
    const staff = await createUser(api, pool);
    await pool.query(`update users set staff_role = 'support' where id = $1`, [staff.id]);

    await bid(anna, id, 10_000);
    await bid(bartek, id, 5_000);
    const typo = (await bid(bartek, id, 15_000)).json<{ bid: { id: string } }>();
    expect((await row(id)).leader_id).toBe(bartek.id);
    const endsAt = (await row(id)).ends_at;

    const cancel = (user: TestUser, bidId: string) =>
      api.http.inject({
        method: 'POST',
        url: `/v1/admin/bids/${bidId}/cancel`,
        headers: { origin: WEB_ORIGIN, cookie: user.cookie },
        payload: { reason: 'TYPO', note: 'Literówka zgłoszona do supportu' },
      });
    expect((await cancel(anna, typo.bid.id)).statusCode).toBe(403);

    const response = await cancel(staff, typo.bid.id);
    expect(response.statusCode, response.body).toBe(200);
    // Zostają: Anna 100 zł i Bartek 50 zł → Anna prowadzi przy 51 zł.
    expect(response.json()).toMatchObject({
      leaderId: anna.id,
      leaderMaxAmount: 10_000,
      currentPrice: 5_100,
      bidCount: 3,
    });
    expect((await row(id)).ends_at).toEqual(endsAt);

    const { rows } = await pool.query<{
      kind: string;
      status: string;
      cancel_reason: string | null;
      amount: string;
      max_amount: string;
      bidder_id: string;
    }>('select * from bids where auction_id = $1 order by sequence', [id]);
    const valid = rows.filter((entry) => entry.status === 'VALID');
    const manual = valid.filter((entry) => entry.kind === 'MANUAL');
    const expected = replay(
      { currency: 'PLN', startPrice: 1_000, reservePrice: null },
      manual.map((entry) => ({ bidderId: entry.bidder_id, maxAmount: Number(entry.max_amount) })),
    );
    expect(valid.map((entry) => [entry.bidder_id, entry.kind, Number(entry.amount)])).toEqual(
      expected.bids.map((entry) => [entry.bidderId, entry.kind, entry.amount]),
    );
    expect(rows.filter((entry) => entry.cancel_reason === 'TYPO')).toHaveLength(1);
    expect(rows.filter((entry) => entry.cancel_reason === 'REPLAY').length).toBeGreaterThan(0);
    expect(await outbox('BidCancelled', id)).toEqual([
      expect.objectContaining({
        bidId: typo.bid.id,
        reason: 'TYPO',
        previousLeaderId: bartek.id,
        leaderId: anna.id,
      }),
    ]);

    const auto = rows.find((entry) => entry.kind === 'AUTO' && entry.status === 'VALID');
    expect(auto).toBeDefined();
    const { rows: autoIds } = await pool.query<{ id: string }>(
      `select id from bids where auction_id = $1 and kind = 'AUTO' and status = 'VALID'`,
      [id],
    );
    expect((await cancel(staff, autoIds[0]?.id ?? '')).statusCode).toBe(409);
  });
});

describe('współbieżność (§15.1)', () => {
  it('50 równoległych ofert na jedną aukcję: stan zgodny z przeliczeniem zapisanych ofert', async () => {
    const id = await auction({ startPrice: 1_000, reservePrice: 20_000 });
    const buyers = await Promise.all(Array.from({ length: 10 }, () => createUser(api, pool)));
    const amounts = Array.from({ length: 50 }, (_, index) => 1_000 + ((index * 7_919) % 49_000));
    const responses = await Promise.all(
      amounts.map((maxAmount, index) =>
        bid(buyers[index % buyers.length] as TestUser, id, maxAmount),
      ),
    );
    for (const response of responses) {
      expect([201, 409]).toContain(response.statusCode);
    }
    const accepted = responses.filter((response) => response.statusCode === 201).length;
    expect(accepted).toBeGreaterThan(0);

    const { rows } = await pool.query<{
      bidder_id: string;
      kind: string;
      amount: string;
      max_amount: string;
      sequence: number;
    }>(`select * from bids where auction_id = $1 and status = 'VALID' order by sequence`, [id]);
    const state = await row(id);
    expect(rows.map((entry) => entry.sequence)).toEqual(rows.map((_, index) => index + 1));
    expect(state.bid_count).toBe(rows.length);
    expect(state.bid_sequence).toBe(rows.length);
    expect(rows.filter((entry) => entry.kind === 'MANUAL')).toHaveLength(accepted);

    const expected = replay(
      { currency: 'PLN', startPrice: 1_000, reservePrice: 20_000 },
      rows
        .filter((entry) => entry.kind === 'MANUAL')
        .map((entry) => ({ bidderId: entry.bidder_id, maxAmount: Number(entry.max_amount) })),
    );
    expect(expected.steps.every((step) => step.result.accepted)).toBe(true);
    expect({
      currentPrice: Number(state.current_price),
      leaderId: state.leader_id,
      leaderMaxAmount: Number(state.leader_max_amount),
    }).toEqual({
      currentPrice: expected.state.currentPrice,
      leaderId: expected.state.leaderId,
      leaderMaxAmount: expected.state.leaderMaxAmount,
    });
    expect(rows.map((entry) => Number(entry.amount))).toEqual(
      expected.bids.map((entry) => entry.amount),
    );
  });
});

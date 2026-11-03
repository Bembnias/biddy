// Kryteria F-27 na prawdziwym Postgresie i Redisie: API nasłuchuje na porcie, a worker w procesie
// testu wykonuje konsumentów eventów (wypłata u FakeGateway, powiadomienia) i rozlicza wypłaty
// FakeGateway webhookiem HTTP. Saldo sprzedającego budujemy księgowaniami sprzedaży w ledgerze,
// a saldo u operatora ustawiamy w symulatorze (model SELLER_BALANCE).
import type { LightMyRequestResponse } from 'fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Database, DRIZZLE, newId } from '../../src/infra/db/index.js';
import { type LedgerPosting, LedgerService } from '../../src/modules/ledger/index.js';
import { PayoutService, SellerAccountService } from '../../src/modules/payments/index.js';
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
const IBAN = 'PL61109010140000071219812874';
const OTHER_IBAN = '60 1020 1026 0000 0422 7020 1111';
const PESEL = '44051401359';

let database: ScratchDatabase;
let pool: Pool;
let api: TestApp;
let worker: TestWorker;
let db: Database;
let ledger: LedgerService;
let payouts: PayoutService;
let ipCounter = 0;
let keyCounter = 0;

beforeAll(async () => {
  database = await createMigratedDatabase();
  pool = new Pool({ connectionString: database.url, max: 8 });
  const shared = {
    DATABASE_URL: database.url,
    REDIS_QUEUE_URL: redisUrl(),
    QUEUE_PREFIX: uniqueQueuePrefix(),
    TRUST_PROXY: 'loopback',
    CORS_ORIGINS: WEB_ORIGIN,
    PAYMENTS_FAKE_WEBHOOK_DELAY_MS: '300',
  };
  api = await startTestApp(integrationConfig(shared));
  await api.app.listen(0, '127.0.0.1');
  const base = (await api.app.getUrl()).replace('[::1]', '127.0.0.1');
  worker = await startTestWorker(
    workerConfig(database.url, {
      ...shared,
      PAYMENTS_FAKE_WEBHOOK_URL: `${base}/v1/webhooks/payments/fake`,
    }),
  );
  db = api.app.get<Database>(DRIZZLE);
  ledger = api.app.get(LedgerService);
  payouts = api.app.get(PayoutService);
}, 120_000);

afterAll(async () => {
  await worker.close();
  await api.close();
  await pool.end();
  await database.drop();
});

function call(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  url: string,
  user: TestUser,
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
      cookie: user.cookie,
      ...headers,
    },
    ...(body === undefined ? {} : { payload: body }),
  });
}

function requestPayout(user: TestUser, body: Record<string, unknown> = {}, key?: string) {
  keyCounter += 1;
  return call('POST', '/v1/me/payouts', user, body, {
    'idempotency-key': key ?? `key-${String(keyCounter)}`,
  });
}

const personalData = {
  firstName: 'Anna',
  lastName: 'Kowalska',
  birthDate: '1944-05-14',
  street: 'ul. Długa 5/2',
  postalCode: '00-950',
  city: 'Warszawa',
  taxIdKind: 'PESEL',
  taxId: PESEL,
};

function post(posting: LedgerPosting) {
  return db.transaction((tx) => ledger.post(tx, posting));
}

/** Zakończona sprzedaż: cena trafia na saldo dostępne sprzedającego. */
async function sale(sellerId: string, price: number): Promise<string> {
  const orderId = newId();
  const amounts = {
    itemsTotal: { amount: price, currency: 'PLN' as const },
    pokFee: { amount: 500, currency: 'PLN' as const },
    pokVat: { amount: 94, currency: 'PLN' as const },
    shippingFee: { amount: 0, currency: 'PLN' as const },
  };
  await post({
    type: 'PAYMENT_RECEIVED',
    idempotencyKey: `test:${orderId}:paid`,
    orderId,
    sellerId,
    provider: 'fake',
    amount: { amount: price + 500, currency: 'PLN' },
    sellerAmount: { amount: price, currency: 'PLN' },
  });
  await post({
    type: 'ORDER_COMPLETED',
    idempotencyKey: `test:${orderId}:completed`,
    orderId,
    sellerId,
    amounts,
  });
  return orderId;
}

interface Seller {
  readonly user: TestUser;
  readonly providerAccountId: string;
}

/** Sprzedający z kontem u operatora, saldem w ledgerze i u operatora oraz danymi do wypłat. */
async function seller(
  options: { balance?: number; operatorBalance?: number; profile?: boolean } = {},
): Promise<Seller> {
  const user = await createUser(api, pool, { name: 'Sprzedawczyni Testowa' });
  const account = await api.app.get(SellerAccountService).register({
    userId: user.id,
    email: `seller-${user.id}@example.com`,
    displayName: 'Sprzedawczyni',
    type: 'PRIVATE',
  });
  await pool.query('update fake_gateway_sellers set balance = $2 where id = $1', [
    account.providerAccountId,
    options.operatorBalance ?? 1_000_000,
  ]);
  if (options.balance !== undefined) {
    await sale(user.id, options.balance);
  }
  if (options.profile !== false) {
    expect(
      (await call('PUT', '/v1/me/payout-profile/personal-data', user, personalData)).statusCode,
    ).toBe(200);
    expect(
      (
        await call('PUT', '/v1/me/payout-profile/bank-account', user, {
          iban: IBAN,
          holderName: 'Anna Kowalska',
        })
      ).statusCode,
    ).toBe(200);
  }
  return { user, providerAccountId: account.providerAccountId };
}

async function payoutRows(sellerId: string) {
  const { rows } = await pool.query<{
    id: string;
    amount: string;
    status: string;
    trigger: string;
    failure_reason: string | null;
    provider_payout_id: string | null;
  }>(
    `select id, amount, status, trigger, failure_reason, provider_payout_id
       from payouts where seller_id = $1 order by created_at`,
    [sellerId],
  );
  return rows;
}

async function notificationTypes(userId: string): Promise<string[]> {
  const { rows } = await pool.query<{ type: string }>(
    'select type from notifications where user_id = $1 order by created_at',
    [userId],
  );
  return rows.map((row) => row.type);
}

describe('dane do wypłat', () => {
  it('walidacja PESEL, daty urodzenia i wieku; zapis zaszyfrowany, w API tylko maski', async () => {
    const user = await createUser(api, pool);
    const wrong = await call('PUT', '/v1/me/payout-profile/personal-data', user, {
      ...personalData,
      taxId: '44051401358',
    });
    expect(wrong.statusCode).toBe(400);
    expect(problemOf(wrong).errors?.map((error) => error.path)).toEqual(['taxId']);
    const mismatch = await call('PUT', '/v1/me/payout-profile/personal-data', user, {
      ...personalData,
      birthDate: '1944-05-15',
    });
    expect(problemOf(mismatch).errors?.map((error) => error.path)).toEqual(['birthDate']);
    const minor = await call('PUT', '/v1/me/payout-profile/personal-data', user, {
      ...personalData,
      birthDate: '2015-01-01',
      taxIdKind: 'NIP',
      taxId: '526-025-02-74',
    });
    expect(problemOf(minor).errors?.map((error) => error.message)).toEqual([
      'Wypłaty są dostępne od 18 lat.',
    ]);
    const badIban = await call('PUT', '/v1/me/payout-profile/bank-account', user, {
      iban: 'PL62109010140000071219812874',
      holderName: 'Anna Kowalska',
    });
    expect(badIban.statusCode).toBe(400);

    expect(
      (await call('PUT', '/v1/me/payout-profile/personal-data', user, personalData)).statusCode,
    ).toBe(200);
    const saved = await call('PUT', '/v1/me/payout-profile/bank-account', user, {
      iban: 'pl61 1090 1014 0000 0712 1981 2874',
      holderName: 'Anna Kowalska',
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.headers['cache-control']).toBe('private, no-store');
    const profile = (await call('GET', '/v1/me/payout-profile', user)).json<{
      personalData: { lastName: string; taxIdMasked: string; postalCode: string };
      bankAccount: { masked: string; holderName: string };
      complete: boolean;
      payoutsBlockedUntil: string | null;
    }>();
    expect(profile).toMatchObject({
      personalData: { lastName: 'Kowalska', taxIdMasked: '•••••••1359', postalCode: '00-950' },
      bankAccount: { masked: '•••• 2874', holderName: 'Anna Kowalska' },
      complete: true,
      payoutsBlockedUntil: null,
    });
    expect(JSON.stringify(profile)).not.toContain(PESEL);
    expect(JSON.stringify(profile)).not.toContain('0712');

    const { rows } = await pool.query<{ personal_data: Buffer; bank_account: Buffer }>(
      'select personal_data, bank_account from seller_payout_profiles where user_id = $1',
      [user.id],
    );
    const stored = Buffer.concat([rows[0]!.personal_data, rows[0]!.bank_account]).toString(
      'latin1',
    );
    for (const plain of ['Kowalska', PESEL, IBAN, '109010140000071219812874', 'Warszawa']) {
      expect(stored).not.toContain(plain);
    }
  });

  it('zmiana numeru rachunku: blokada 48 h, 409 PAYOUTS_ON_HOLD i powiadomienie; sam właściciel bez blokady', async () => {
    const { user } = await seller({ balance: 5_000 });
    await waitFor(
      async () => (await notificationTypes(user.id)).includes('PAYOUT_ACCOUNT_CHANGED'),
      'powiadomienie o pierwszym rachunku',
    );

    const before = Date.now();
    const changed = await call('PUT', '/v1/me/payout-profile/bank-account', user, {
      iban: OTHER_IBAN,
      holderName: 'Anna Kowalska',
    });
    const until = Date.parse(changed.json<{ payoutsBlockedUntil: string }>().payoutsBlockedUntil);
    expect(until - before).toBeGreaterThanOrEqual(48 * 60 * 60 * 1000 - 1_000);
    expect(until - before).toBeLessThanOrEqual(48 * 60 * 60 * 1000 + 5_000);

    const refused = await requestPayout(user);
    expect(refused.statusCode).toBe(409);
    expect(problemOf(refused)).toMatchObject({
      code: 'PAYOUTS_ON_HOLD',
      blockedUntil: new Date(until).toISOString(),
    });
    const notifications = await waitFor(async () => {
      const types = await notificationTypes(user.id);
      return types.filter((type) => type === 'PAYOUT_ACCOUNT_CHANGED').length === 2 && types;
    }, 'powiadomienie o zmianie rachunku');
    expect(notifications).toHaveLength(2);
    const latest = (await call('GET', '/v1/me/notifications', user)).json<{
      items: { title: string; body: string }[];
    }>().items[0];
    expect(latest?.title).toBe('Zmieniono rachunek do wypłat');
    expect(latest?.body).toContain('•••• 1111');

    // Ten sam numer, inny zapis właściciela: bez nowej blokady i powiadomienia.
    const same = await call('PUT', '/v1/me/payout-profile/bank-account', user, {
      iban: OTHER_IBAN,
      holderName: 'Anna Maria Kowalska',
    });
    expect(Date.parse(same.json<{ payoutsBlockedUntil: string }>().payoutsBlockedUntil)).toBe(
      until,
    );
    const balance = (await call('GET', '/v1/me/balance', user)).json<{
      payout: { blocker: { code: string; until: string } };
    }>();
    expect(balance.payout.blocker).toMatchObject({ code: 'PAYOUTS_ON_HOLD' });
  });
});

describe('wypłata na żądanie', () => {
  it('zlecenie, idempotencja nagłówka, webhook PAYOUT_PAID, ledger, powiadomienie i historia', async () => {
    const { user } = await seller({ balance: 5_000 });

    const missingKey = await call('POST', '/v1/me/payouts', user, {});
    expect(missingKey.statusCode).toBe(400);

    const created = await requestPayout(user, {}, 'pierwsza-wyplata');
    expect(created.statusCode, created.body).toBe(201);
    const payout = created.json<{ id: string; amount: number; status: string }>();
    expect(payout).toMatchObject({ amount: 5_000, status: 'PENDING' });
    const replay = await requestPayout(user, {}, 'pierwsza-wyplata');
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.json<{ id: string }>().id).toBe(payout.id);

    await waitFor(
      async () => (await payoutRows(user.id))[0]?.status === 'PAID',
      'wypłata potwierdzona webhookiem',
    );
    const balances = await ledger.sellerBalances(user.id);
    expect(balances.available.amount).toBe(0);
    expect(balances.payoutsInTransit.amount).toBe(0);
    await waitFor(
      async () => (await notificationTypes(user.id)).includes('PAYOUT_PAID'),
      'powiadomienie o wypłacie',
    );

    const history = (await call('GET', '/v1/me/balance/history', user)).json<{
      items: { type: string; available: number; payout: { status: string } | null }[];
      nextCursor: string | null;
    }>();
    expect(history.items.map((item) => [item.type, item.available, item.payout?.status])).toEqual([
      ['PAYOUT_REQUESTED', -5_000, 'PAID'],
      ['ORDER_COMPLETED', 5_000, undefined],
    ]);
    expect(history.nextCursor).toBeNull();
  });

  it('równoległe żądania: jedno 201, drugie 409 INSUFFICIENT_BALANCE; jedna transakcja w ledgerze', async () => {
    const { user } = await seller({ balance: 5_000 });
    const responses = await Promise.all([
      requestPayout(user, { amount: 4_000 }),
      requestPayout(user, { amount: 4_000 }),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    const refused = responses.find((response) => response.statusCode === 409);
    expect(refused === undefined ? undefined : problemOf(refused).code).toBe(
      'INSUFFICIENT_BALANCE',
    );
    const { rows } = await pool.query<{ count: string }>(
      `select count(*) from ledger_transactions where type = 'PAYOUT_REQUESTED'
         and payout_id in (select id from payouts where seller_id = $1)`,
      [user.id],
    );
    expect(rows[0]?.count).toBe('1');
    expect((await payoutRows(user.id)).length).toBe(1);
  });

  it('odmowa operatora przy zleceniu: wypłata FAILED, środki wracają na saldo, powiadomienie', async () => {
    const { user } = await seller({ balance: 3_000, operatorBalance: 0 });
    expect((await requestPayout(user)).statusCode).toBe(201);
    const [failed] = await waitFor(async () => {
      const rows = await payoutRows(user.id);
      return rows[0]?.status === 'FAILED' && rows;
    }, 'odrzucona wypłata');
    expect(failed?.failure_reason).toBe('INSUFFICIENT_BALANCE');
    const balances = await ledger.sellerBalances(user.id);
    expect(balances.available.amount).toBe(3_000);
    expect(balances.payoutsInTransit.amount).toBe(0);
    await waitFor(
      async () => (await notificationTypes(user.id)).includes('PAYOUT_FAILED'),
      'powiadomienie o nieudanej wypłacie',
    );
  });

  it('warunki 409: brak danych, minimum, należność, blokada F-61; zamknięcie konta bez minimum', async () => {
    const noProfile = await seller({ balance: 5_000, profile: false });
    expect(problemOf(await requestPayout(noProfile.user)).code).toBe('PAYOUT_PROFILE_INCOMPLETE');

    const small = await seller({ balance: 1_500 });
    const belowMinimum = await requestPayout(small.user);
    expect(problemOf(belowMinimum)).toMatchObject({ code: 'PAYOUT_BELOW_MINIMUM', minimum: 2_000 });
    const tooMuch = await requestPayout(small.user, { amount: 1_501 });
    expect(problemOf(tooMuch)).toMatchObject({ code: 'INSUFFICIENT_BALANCE', available: 1_500 });
    const closure = await payouts.payOutOnClosure(small.user.id);
    expect(closure).toMatchObject({ amount: 1_500, trigger: 'ACCOUNT_CLOSURE' });

    const debtor = await seller();
    await post({
      type: 'DISPUTE_COSTS_CHARGED',
      idempotencyKey: `test:${debtor.user.id}:dispute`,
      orderId: newId(),
      sellerId: debtor.user.id,
      amount: { amount: 2_798, currency: 'PLN' },
    });
    expect(problemOf(await requestPayout(debtor.user))).toMatchObject({
      code: 'RECEIVABLE_OUTSTANDING',
      receivable: 2_798,
    });
    const debtorBalance = (await call('GET', '/v1/me/balance', debtor.user)).json<{
      receivable: number;
      payout: { blocker: { code: string; amount: number } };
    }>();
    expect(debtorBalance).toMatchObject({
      receivable: 2_798,
      payout: { blocker: { code: 'RECEIVABLE_OUTSTANDING', amount: 2_798 } },
    });

    const blocked = await seller({ balance: 5_000 });
    const blockId = newId();
    await pool.query(
      `insert into account_blocks (id, user_id, kind, cause, strike_ids, starts_at, ends_at, statement)
       values ($1, $2, 'PAYOUTS', 'COUNTERFEIT', '{}', now() - interval '1 hour', null, 'Podróbka')`,
      [blockId, blocked.user.id],
    );
    expect(problemOf(await requestPayout(blocked.user))).toMatchObject({
      code: 'PAYOUTS_BLOCKED',
      blockedUntil: null,
      blockId,
    });
    await expect(payouts.payOutOnClosure(blocked.user.id)).rejects.toMatchObject({
      code: 'PAYOUTS_BLOCKED',
    });
  });
});

describe('wypłaty automatyczne', () => {
  it('tygodniowa: jedna wypłata całego salda w tygodniu, saldo poniżej minimum pominięte', async () => {
    const weekly = await seller({ balance: 3_000 });
    const small = await seller({ balance: 1_000 });
    for (const { user } of [weekly, small]) {
      const response = await call('PATCH', '/v1/me/payout-settings', user, { weeklyPayouts: true });
      expect(response.json<{ weeklyPayouts: boolean }>().weeklyPayouts).toBe(true);
    }
    const monday = new Date('2026-11-09T05:00:00Z');
    await payouts.weeklyPayouts(monday);
    await payouts.weeklyPayouts(monday);
    expect((await payoutRows(weekly.user.id)).map((row) => [row.trigger, row.amount])).toEqual([
      ['WEEKLY', '3000'],
    ]);
    expect(await payoutRows(small.user.id)).toEqual([]);
  });

  it('saldo uśpione: wypłata całości po 90 dniach bez sprzedaży, bez niej przy otwartym zamówieniu i przed terminem', async () => {
    const dormant = await seller({ balance: 1_200 });
    const withOpenOrder = await seller({ balance: 1_200 });
    await post({
      type: 'PAYMENT_RECEIVED',
      idempotencyKey: `test:${withOpenOrder.user.id}:open`,
      orderId: newId(),
      sellerId: withOpenOrder.user.id,
      provider: 'fake',
      amount: { amount: 3_000, currency: 'PLN' },
      sellerAmount: { amount: 2_500, currency: 'PLN' },
    });

    await payouts.dormantBalances(new Date(Date.now() + 89 * DAY));
    expect(await payoutRows(dormant.user.id)).toEqual([]);

    await payouts.dormantBalances(new Date(Date.now() + 91 * DAY));
    expect((await payoutRows(dormant.user.id)).map((row) => [row.trigger, row.amount])).toEqual([
      ['DORMANT_BALANCE', '1200'],
    ]);
    expect(await payoutRows(withOpenOrder.user.id)).toEqual([]);
    await waitFor(
      async () => (await payoutRows(dormant.user.id))[0]?.status === 'PAID',
      'wypłata salda uśpionego',
    );
  });
});

describe('widok salda', () => {
  it('salda, zamówienia w trakcie z tytułem i historia z kursorem', async () => {
    const { user } = await seller();
    const prices = Array.from({ length: 21 }, (_, index) => 1_000 + index);
    for (const price of prices) {
      await sale(user.id, price);
    }
    const orderId = newId();
    await pool.query(
      `insert into orders (id, public_id, buyer_id, seller_id, status, currency, items_total,
         pok_fee, pok_vat, total, fee_schedule_id, payment_due_at, paid_at, ship_by)
       values ($1, $2, $3, $4, 'PAID', 'PLN', 4500, 500, 94, 5000, $5, now(), now(), now())`,
      [orderId, 'B-7731', newId(), user.id, newId()],
    );
    await pool.query(
      `insert into order_items (id, order_id, auction_id, hammer_price, item_snapshot)
       values ($1, $2, $3, 4500, $4)`,
      [
        newId(),
        orderId,
        newId(),
        JSON.stringify({ version: 1, item: { title: 'Wazon ceramiczny', photos: [] } }),
      ],
    );
    const balance = (await call('GET', '/v1/me/balance', user)).json<{
      available: number;
      inProgress: number;
      inProgressOrders: { publicId: string; title: string; amount: number; status: string }[];
      payout: { blocker: null; profileComplete: boolean; bankAccountMasked: string };
    }>();
    expect(balance).toMatchObject({
      available: prices.reduce((total, price) => total + price, 0),
      inProgress: 4_500,
      inProgressOrders: [
        { publicId: 'B-7731', title: 'Wazon ceramiczny', amount: 4_500, status: 'PAID' },
      ],
      payout: { blocker: null, profileComplete: true, bankAccountMasked: '•••• 2874' },
    });

    const pages: number[][] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 3; page += 1) {
      const response = await call(
        'GET',
        `/v1/me/balance/history${cursor === null ? '' : `?cursor=${cursor}`}`,
        user,
      );
      const body = response.json<{ items: { available: number }[]; nextCursor: string | null }>();
      pages.push(body.items.map((item) => item.available));
      cursor = body.nextCursor;
      if (cursor === null) {
        break;
      }
    }
    expect(pages.map((page) => page.length)).toEqual([20, 1]);
    expect(pages.flat()).toEqual([...prices].reverse());
  });
});

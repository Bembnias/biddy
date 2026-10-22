// Kryteria F-22 na prawdziwym Postgresie (Testcontainers): szablony księgowań przez LedgerService,
// idempotencja i współbieżność, saldo dostępne i należność, storno, gwarancje w bazie (bilans
// transakcji, saldo = suma wpisów, niemodyfikowalność, strona salda) i spójność odtworzona
// z samych wpisów, także dla losowych sekwencji porównanych z modelem w pamięci.
import { randomUUID } from 'node:crypto';

import { type Money, money } from '@biddy/shared';
import fc from 'fast-check';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Database, DRIZZLE, newId } from '../../src/infra/db/index.js';
import {
  accountKey,
  accountLabel,
  type LedgerAccountCode,
} from '../../src/modules/ledger/domain/accounts.js';
import {
  LEDGER_TRANSACTION_TYPES,
  LedgerError,
  LedgerIntegrity,
  LedgerIntegrityError,
  type LedgerPosting,
  LedgerService,
  type OrderAmounts,
  type OrderCompleted,
  type PaymentReceived,
  type PostedLedgerEntry,
  type PostedLedgerTransaction,
} from '../../src/modules/ledger/index.js';
import {
  InMemoryLedger,
  isInsufficientFunds,
  ScenarioDriver,
  scenarioActionsArbitrary,
  scenarioOrdersArbitrary,
} from '../support/ledger-model.js';
import { integrationConfig, startTestApp, type TestApp } from './support/app.js';
import type { ScratchDatabase } from './support/database.js';
import { createMigratedDatabase, redisUrl, uniqueQueuePrefix } from './support/worker.js';

let database: ScratchDatabase;
let pool: Pool;
let api: TestApp;
let db: Database;
let ledger: LedgerService;
let integrity: LedgerIntegrity;

beforeAll(async () => {
  database = await createMigratedDatabase();
  pool = new Pool({ connectionString: database.url, max: 4 });
  api = await startTestApp(
    integrationConfig({
      DATABASE_URL: database.url,
      REDIS_QUEUE_URL: redisUrl(),
      QUEUE_PREFIX: uniqueQueuePrefix(),
    }),
  );
  db = api.app.get<Database>(DRIZZLE);
  ledger = api.app.get(LedgerService);
  integrity = api.app.get(LedgerIntegrity);
});

afterAll(async () => {
  await api.close();
  await pool.end();
  await database.drop();
});

const AMOUNTS: OrderAmounts = {
  itemsTotal: money(10_000),
  pokFee: money(999),
  pokVat: money(187),
  shippingFee: money(1_299),
};
const TOTAL = money(12_298);
const ZERO = money(0);

/** Księgowanie w osobnej transakcji bazy (jak handler zdarzenia z jedną zmianą stanu). */
function post(posting: LedgerPosting): Promise<PostedLedgerTransaction> {
  return db.transaction((tx) => ledger.post(tx, posting));
}

async function ledgerError(promise: Promise<unknown>): Promise<LedgerError> {
  const error = await promise.then(
    () => {
      throw new Error('oczekiwano LedgerError');
    },
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(LedgerError);
  return error as LedgerError;
}

function labelled(entries: readonly PostedLedgerEntry[]): Record<string, number> {
  return Object.fromEntries(
    entries.map((entry) => [accountLabel(entry.account), entry.amount.amount]),
  );
}

/** Nowy sprzedający i zamówienie: testy nie dzielą kont użytkowników ani zamówień. */
function newOrder(sellerId: string = randomUUID()) {
  const orderId = randomUUID();
  return {
    sellerId,
    orderId,
    held: `buyer_funds_held:${orderId}`,
    available: `seller_balance_available:${sellerId}`,
    receivable: `seller_receivable:${sellerId}`,
    key: (name: string) => `${orderId}:${name}`,
  };
}
type TestOrder = ReturnType<typeof newOrder>;

function payment(order: TestOrder, amount: Money = TOTAL): PaymentReceived {
  return {
    type: 'PAYMENT_RECEIVED',
    idempotencyKey: order.key('payment'),
    orderId: order.orderId,
    sellerId: order.sellerId,
    provider: 'fake',
    amount,
    sellerAmount: AMOUNTS.itemsTotal,
  };
}

function completion(order: TestOrder): OrderCompleted {
  return {
    type: 'ORDER_COMPLETED',
    idempotencyKey: order.key('completed'),
    orderId: order.orderId,
    sellerId: order.sellerId,
    amounts: AMOUNTS,
  };
}

const PLATFORM_ACCOUNTS: readonly LedgerAccountCode[] = [
  'carrier_claims_receivable',
  'vat_payable',
  'platform_revenue_pok',
  'platform_shipping',
  'payment_fees_expense',
  'platform_losses',
  'platform_external',
];

/** Salda kont platformy i `provider_cash:fake` (po stronie normalnej), do porównania przyrostów. */
async function platformBalances(): Promise<Record<string, number>> {
  const balances: Record<string, number> = {};
  for (const code of PLATFORM_ACCOUNTS) {
    balances[code] = (await ledger.balance({ code, subject: null, currency: 'PLN' })).amount;
  }
  balances['provider_cash:fake'] = (
    await ledger.balance({ code: 'provider_cash', subject: 'fake', currency: 'PLN' })
  ).amount;
  return balances;
}

function difference(
  after: Record<string, number>,
  before: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(after)
      .map(([account, balance]) => [account, balance - (before[account] ?? 0)] as const)
      .filter(([, change]) => change !== 0),
  );
}

describe('przebieg zamówienia w bazie', () => {
  it('płatność, potem zakończenie: wpisy, salda sprzedającego, środki zamówienia, przychody', async () => {
    const order = newOrder();
    const before = await platformBalances();

    const paid = await post(payment(order));
    expect(paid).toMatchObject({
      type: 'PAYMENT_RECEIVED',
      orderId: order.orderId,
      payoutId: null,
      reversesTransactionId: null,
      replayed: false,
    });
    expect(labelled(paid.entries)).toEqual({ [order.held]: -12_298, 'provider_cash:fake': 12_298 });
    expect(await ledger.heldForOrder(order.orderId)).toEqual(TOTAL);
    expect(await ledger.sellerBalances(order.sellerId)).toEqual({
      available: ZERO,
      pending: money(10_000),
      receivable: ZERO,
      payoutsInTransit: ZERO,
    });

    const completed = await post(completion(order));
    expect(labelled(completed.entries)).toEqual({
      [order.held]: 12_298,
      platform_revenue_pok: -812,
      platform_shipping: -1_299,
      [order.available]: -10_000,
      vat_payable: -187,
    });
    expect(await ledger.heldForOrder(order.orderId)).toEqual(ZERO);
    expect(await ledger.sellerBalances(order.sellerId)).toEqual({
      available: money(10_000),
      pending: ZERO,
      receivable: ZERO,
      payoutsInTransit: ZERO,
    });
    expect(difference(await platformBalances(), before)).toEqual({
      'provider_cash:fake': 12_298,
      platform_revenue_pok: 812,
      platform_shipping: 1_299,
      vat_payable: 187,
    });

    const { rows } = await pool.query<{ type: string; payload: unknown }>(
      'select type, payload from ledger_transactions where order_id = $1 order by created_at',
      [order.orderId],
    );
    expect(rows).toEqual([
      {
        type: 'PAYMENT_RECEIVED',
        payload: {
          orderId: order.orderId,
          sellerId: order.sellerId,
          provider: 'fake',
          amount: { amount: 12_298, currency: 'PLN' },
          sellerAmount: { amount: 10_000, currency: 'PLN' },
        },
      },
      expect.objectContaining({ type: 'ORDER_COMPLETED' }),
    ]);
  });

  it('wszystkie szablony §7.7 i §7.9: konta powstają z ograniczeniami bazy, salda wracają do zera', async () => {
    const sellerId = randomUUID();
    const [completed, refunded, notPickedUp, partial] = [1, 2, 3, 4].map(() => newOrder(sellerId));
    if (!completed || !refunded || !notPickedUp || !partial) {
      throw new Error('brak zamówień testowych');
    }
    const payoutOk = randomUUID();
    const payoutFailed = randomUUID();
    const key = (name: string) => `${sellerId}:${name}`;
    const before = await platformBalances();

    for (const order of [completed, refunded, notPickedUp, partial]) {
      await post(payment(order));
    }
    expect((await ledger.sellerBalances(sellerId)).pending).toEqual(money(40_000));
    await post({
      type: 'ORDER_REFUNDED',
      idempotencyKey: refunded.key('refund'),
      orderId: refunded.orderId,
      provider: 'fake',
      amount: TOTAL,
      reason: 'NOT_SHIPPED',
    });
    await post({
      type: 'NOT_PICKED_UP_REFUNDED',
      idempotencyKey: notPickedUp.key('not-picked-up'),
      orderId: notPickedUp.orderId,
      provider: 'fake',
      amounts: AMOUNTS,
    });
    await post({
      type: 'ORDER_PARTIALLY_REFUNDED',
      idempotencyKey: partial.key('partial-refund'),
      orderId: partial.orderId,
      sellerId,
      provider: 'fake',
      amounts: AMOUNTS,
      refund: money(3_000),
    });
    await post(completion(completed));
    expect(await ledger.sellerBalances(sellerId)).toEqual({
      available: money(17_000),
      pending: ZERO,
      receivable: ZERO,
      payoutsInTransit: ZERO,
    });

    await post({
      type: 'PAYOUT_REQUESTED',
      idempotencyKey: key('payout-1'),
      payoutId: payoutOk,
      sellerId,
      amount: money(5_000),
    });
    await post({
      type: 'PAYOUT_REQUESTED',
      idempotencyKey: key('payout-2'),
      payoutId: payoutFailed,
      sellerId,
      amount: money(2_000),
    });
    expect((await ledger.sellerBalances(sellerId)).payoutsInTransit).toEqual(money(7_000));
    await post({
      type: 'PAYOUT_COMPLETED',
      idempotencyKey: key('payout-1-paid'),
      payoutId: payoutOk,
      sellerId,
      provider: 'fake',
      amount: money(5_000),
    });
    await post({
      type: 'PAYOUT_FAILED',
      idempotencyKey: key('payout-2-failed'),
      payoutId: payoutFailed,
      sellerId,
      amount: money(2_000),
    });
    expect(await ledger.sellerBalances(sellerId)).toEqual({
      available: money(12_000),
      pending: ZERO,
      receivable: ZERO,
      payoutsInTransit: ZERO,
    });

    await post({
      type: 'PAYMENT_FEE_CHARGED',
      idempotencyKey: key('fee'),
      provider: 'fake',
      amount: money(150),
    });
    await post({
      type: 'DISPUTE_COSTS_CHARGED',
      idempotencyKey: key('dispute-costs'),
      orderId: completed.orderId,
      sellerId,
      amount: money(13_000),
    });
    await post({
      type: 'CHARGEBACK_ABSORBED',
      idempotencyKey: key('chargeback-absorbed'),
      orderId: completed.orderId,
      provider: 'fake',
      amount: money(1_000),
    });
    await post({
      type: 'CHARGEBACK_CHARGED_TO_SELLER',
      idempotencyKey: key('chargeback-seller'),
      orderId: completed.orderId,
      sellerId,
      provider: 'fake',
      amount: money(500),
    });
    expect((await ledger.sellerBalances(sellerId)).receivable).toEqual(money(1_500));
    await post({
      type: 'PARCEL_COMPENSATION_PAID',
      idempotencyKey: key('compensation-balance'),
      orderId: completed.orderId,
      sellerId,
      amount: money(1_000),
      channel: 'SELLER_BALANCE',
    });
    await post({
      type: 'PARCEL_COMPENSATION_PAID',
      idempotencyKey: key('compensation-transfer'),
      orderId: completed.orderId,
      sellerId,
      amount: money(2_000),
      channel: 'EXTERNAL_TRANSFER',
    });
    await post({
      type: 'CARRIER_CLAIM_SETTLED',
      idempotencyKey: key('claim'),
      orderId: completed.orderId,
      recovered: money(2_000),
      unrecovered: money(1_000),
    });
    await post({
      type: 'RECEIVABLE_WRITTEN_OFF',
      idempotencyKey: key('write-off'),
      sellerId,
      amount: money(500),
    });

    expect(await ledger.sellerBalances(sellerId)).toEqual({
      available: ZERO,
      pending: ZERO,
      receivable: ZERO,
      payoutsInTransit: ZERO,
    });
    for (const order of [completed, refunded, notPickedUp, partial]) {
      expect(await ledger.heldForOrder(order.orderId)).toEqual(ZERO);
    }
    expect(difference(await platformBalances(), before)).toEqual({
      'provider_cash:fake': 4 * 12_298 - 12_298 - 10_999 - 3_000 - 5_000 - 150 - 1_000 - 500,
      platform_revenue_pok: 2 * 812,
      vat_payable: 2 * 187,
      // Dostawa: dwa zakończenia, nieodebrana i koszty sporu.
      platform_shipping: 3 * 1_299 + 13_000,
      payment_fees_expense: 150,
      platform_losses: 1_000 + 1_000 + 500,
      // platform_external i carrier_claims_receivable wracają do zera: rekompensaty
      // (1000 zł na saldo, 2000 zł przelewem) rozliczone reklamacją (2000 zł odzyskane, 1000 zł nie).
    });

    const { rows } = await pool.query<{ type: string }>(
      `select distinct type from ledger_transactions
        where order_id = any($1) or payout_id = any($2) or idempotency_key like $3`,
      [
        [completed, refunded, notPickedUp, partial].map((order) => order.orderId),
        [payoutOk, payoutFailed],
        `${sellerId}:%`,
      ],
    );
    expect(rows.map((row) => row.type).sort()).toEqual(
      LEDGER_TRANSACTION_TYPES.filter((type) => type !== 'REVERSAL').sort(),
    );
  });
});

describe('idempotencja', () => {
  it('ponowienie z tym samym kluczem i danymi zwraca tę samą transakcję bez nowych wpisów', async () => {
    const order = newOrder();
    const first = await post(payment(order));
    const again = await post(payment(order));
    expect(again).toEqual({ ...first, replayed: true });
    const { rows } = await pool.query<{ count: number }>(
      'select count(*)::int as count from ledger_entries where transaction_id = $1',
      [first.id],
    );
    expect(rows[0]?.count).toBe(2);
    expect(await ledger.heldForOrder(order.orderId)).toEqual(TOTAL);
  });

  it('ten sam klucz z innymi danymi: IDEMPOTENCY_CONFLICT', async () => {
    const order = newOrder();
    await post(payment(order));
    const error = await ledgerError(post(payment(order, money(12_299))));
    expect(error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('równoległe księgowania z tym samym kluczem: jedno zapisuje, drugie dostaje jego wynik', async () => {
    const order = newOrder();
    const results = await Promise.all([post(payment(order)), post(payment(order))]);
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(await ledger.heldForOrder(order.orderId)).toEqual(TOTAL);
  });
});

describe('saldo dostępne i należność', () => {
  async function sellerWithAvailable(): Promise<TestOrder> {
    const order = newOrder();
    await post(payment(order));
    await post(completion(order));
    return order;
  }

  it('10 równoległych wypłat po 60 zł przy saldzie 100 zł: przechodzi jedna, reszta INSUFFICIENT_FUNDS', async () => {
    const { sellerId } = await sellerWithAvailable();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        post({
          type: 'PAYOUT_REQUESTED',
          idempotencyKey: `payout:${randomUUID()}`,
          payoutId: randomUUID(),
          sellerId,
          amount: money(6_000),
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(LedgerError);
        expect((result.reason as LedgerError).code).toBe('INSUFFICIENT_FUNDS');
      }
    }
    expect(await ledger.sellerBalances(sellerId)).toMatchObject({
      available: money(4_000),
      payoutsInTransit: money(6_000),
    });
  });

  it('koszty sporu ponad saldo: saldo 0, niedobór jako należność; kolejne zakończenie najpierw ją spłaca', async () => {
    const first = await sellerWithAvailable();
    const costs = await post({
      type: 'DISPUTE_COSTS_CHARGED',
      idempotencyKey: first.key('dispute-costs'),
      orderId: first.orderId,
      sellerId: first.sellerId,
      amount: money(12_598),
    });
    expect(labelled(costs.entries)).toEqual({
      platform_shipping: -12_598,
      [first.available]: 10_000,
      [first.receivable]: 2_598,
    });
    expect(await ledger.sellerBalances(first.sellerId)).toMatchObject({
      available: ZERO,
      receivable: money(2_598),
    });

    const second = newOrder(first.sellerId);
    await post(payment(second));
    const completed = await post(completion(second));
    expect(labelled(completed.entries)).toMatchObject({
      [first.receivable]: -2_598,
      [first.available]: -7_402,
    });
    expect(await ledger.sellerBalances(first.sellerId)).toMatchObject({
      available: money(7_402),
      receivable: ZERO,
    });
  });

  it('błąd księgowania wycofuje całą transakcję wywołującego', async () => {
    const order = await sellerWithAvailable();
    const feeKey = `fee:${randomUUID()}`;
    const error = await ledgerError(
      db.transaction(async (tx) => {
        await ledger.post(tx, {
          type: 'PAYMENT_FEE_CHARGED',
          idempotencyKey: feeKey,
          provider: 'fake',
          amount: money(100),
        });
        await ledger.post(tx, {
          type: 'PAYOUT_REQUESTED',
          idempotencyKey: `payout:${randomUUID()}`,
          payoutId: randomUUID(),
          sellerId: order.sellerId,
          amount: money(10_001),
        });
      }),
    );
    expect(error.code).toBe('INSUFFICIENT_FUNDS');
    const { rows } = await pool.query(
      'select 1 from ledger_transactions where idempotency_key = $1',
      [feeKey],
    );
    expect(rows).toEqual([]);
  });

  it('płatność za to samo zamówienie z innym sprzedającym: ACCOUNT_MISMATCH', async () => {
    const order = newOrder();
    await post(payment(order));
    const error = await ledgerError(
      post({ ...payment(order), idempotencyKey: order.key('payment-2'), sellerId: randomUUID() }),
    );
    expect(error.code).toBe('ACCOUNT_MISMATCH');
  });

  it('zwrot bez płatności: INSUFFICIENT_FUNDS (konto środków zamówienia nie powstaje)', async () => {
    const order = newOrder();
    const error = await ledgerError(
      post({
        type: 'ORDER_REFUNDED',
        idempotencyKey: order.key('refund'),
        orderId: order.orderId,
        provider: 'fake',
        amount: TOTAL,
        reason: 'LATE_PAYMENT',
      }),
    );
    expect(error.code).toBe('INSUFFICIENT_FUNDS');
    const { rows } = await pool.query('select 1 from ledger_accounts where subject = $1', [
      order.orderId,
    ]);
    expect(rows).toEqual([]);
  });
});

describe('storno (korekta przez nowe wpisy)', () => {
  it('odwraca wpisy transakcji; drugi raz: ALREADY_REVERSED, ten sam klucz: ponowienie', async () => {
    const order = newOrder();
    const paid = await post(payment(order));
    const reverse = (idempotencyKey: string) =>
      db.transaction((tx) =>
        ledger.reverse(tx, { transactionId: paid.id, idempotencyKey, reason: 'Błędna kwota' }),
      );

    const reversal = await reverse(order.key('reversal'));
    expect(reversal).toMatchObject({
      type: 'REVERSAL',
      orderId: order.orderId,
      reversesTransactionId: paid.id,
      replayed: false,
    });
    expect(labelled(reversal.entries)).toEqual({
      [order.held]: 12_298,
      'provider_cash:fake': -12_298,
    });
    expect(await ledger.heldForOrder(order.orderId)).toEqual(ZERO);
    expect((await ledger.sellerBalances(order.sellerId)).pending).toEqual(ZERO);

    expect(await reverse(order.key('reversal'))).toEqual({ ...reversal, replayed: true });
    expect((await ledgerError(reverse(order.key('reversal-2')))).code).toBe('ALREADY_REVERSED');
    expect(
      (
        await ledgerError(
          db.transaction((tx) =>
            ledger.reverse(tx, {
              transactionId: reversal.id,
              idempotencyKey: order.key('reversal-3'),
              reason: 'Storno storna',
            }),
          ),
        )
      ).code,
    ).toBe('INVALID_POSTING');
    expect(
      (
        await ledgerError(
          db.transaction((tx) =>
            ledger.reverse(tx, {
              transactionId: newId(),
              idempotencyKey: order.key('reversal-4'),
              reason: 'Nie ma takiej',
            }),
          ),
        )
      ).code,
    ).toBe('TRANSACTION_NOT_FOUND');
  });

  it('storno zakończenia po wypłacie środków: INSUFFICIENT_FUNDS', async () => {
    const order = newOrder();
    await post(payment(order));
    const completed = await post(completion(order));
    await post({
      type: 'PAYOUT_REQUESTED',
      idempotencyKey: order.key('payout'),
      payoutId: randomUUID(),
      sellerId: order.sellerId,
      amount: money(10_000),
    });
    const error = await ledgerError(
      db.transaction((tx) =>
        ledger.reverse(tx, {
          transactionId: completed.id,
          idempotencyKey: order.key('reversal'),
          reason: 'Pomyłka',
        }),
      ),
    );
    expect(error.code).toBe('INSUFFICIENT_FUNDS');
  });
});

describe('gwarancje w bazie', () => {
  let order: TestOrder;
  let accounts: { held: string; cash: string; available: string };

  /** Polecenia w jednej transakcji bazy na osobnym połączeniu (bez LedgerService). */
  async function inTransaction(
    statements: (client: PoolClient) => Promise<unknown>,
  ): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await statements(client);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async function accountId(code: string, subject: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `select id from ledger_accounts where code = $1 and subject = $2 and currency = 'PLN'`,
      [code, subject],
    );
    const [row] = rows;
    if (row === undefined) {
      throw new Error(`brak konta ${code}:${subject}`);
    }
    return row.id;
  }

  async function insertTransaction(client: PoolClient): Promise<string> {
    const id = newId();
    await client.query(
      `insert into ledger_transactions (id, type, idempotency_key, currency, payload)
       values ($1, 'PAYMENT_FEE_CHARGED', $2, 'PLN', '{}')`,
      [id, `raw:${id}`],
    );
    return id;
  }

  async function insertEntries(
    client: PoolClient,
    transactionId: string,
    entries: readonly (readonly [string, number])[],
  ): Promise<void> {
    for (const [account, amount] of entries) {
      await client.query(
        'insert into ledger_entries (id, transaction_id, account_id, amount) values ($1, $2, $3, $4)',
        [newId(), transactionId, account, amount],
      );
    }
  }

  beforeAll(async () => {
    order = newOrder();
    await post(payment(order));
    await post(completion(order));
    accounts = {
      held: await accountId('buyer_funds_held', order.orderId),
      cash: await accountId('provider_cash', 'fake'),
      available: await accountId('seller_balance_available', order.sellerId),
    };
  });

  it('transakcja, która nie sumuje się do zera, ma jeden wpis albo nie ma wpisów, jest odrzucana przy zatwierdzeniu', async () => {
    const cases: readonly (readonly (readonly [string, number])[])[] = [
      [
        [accounts.cash, 100],
        [accounts.available, -99],
      ],
      [[accounts.cash, 100]],
      [],
    ];
    for (const entries of cases) {
      await expect(
        inTransaction(async (client) => {
          await insertEntries(client, await insertTransaction(client), entries);
        }),
      ).rejects.toMatchObject({
        code: '23514',
        message: expect.stringContaining('nie bilansuje się') as string,
      });
    }
  });

  it('zbilansowana transakcja wstawiona bez serwisu przechodzi, a saldo konta = suma wpisów', async () => {
    const before = (
      await ledger.balance({ code: 'provider_cash', subject: 'fake', currency: 'PLN' })
    ).amount;
    await inTransaction(async (client) => {
      await insertEntries(client, await insertTransaction(client), [
        [accounts.cash, 100],
        [accounts.available, -100],
      ]);
    });
    expect(
      (await ledger.balance({ code: 'provider_cash', subject: 'fake', currency: 'PLN' })).amount,
    ).toBe(before + 100);
  });

  it('wpis z kwotą 0 jest odrzucany', async () => {
    await expect(
      inTransaction(async (client) => {
        await insertEntries(client, await insertTransaction(client), [
          [accounts.cash, 0],
          [accounts.available, 0],
        ]);
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('saldo dostępne nie może być ujemne także przy wpisach z pominięciem serwisu (CHECK)', async () => {
    const available = (await ledger.sellerBalances(order.sellerId)).available.amount;
    await expect(
      inTransaction(async (client) => {
        await insertEntries(client, await insertTransaction(client), [
          [accounts.available, available + 1],
          [accounts.cash, -(available + 1)],
        ]);
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'ledger_accounts_balance_side_check',
    });
  });

  it('wpis na koncie w innej walucie niż transakcja jest odrzucany', async () => {
    const eurAccount = newId();
    await pool.query(
      `insert into ledger_accounts (id, code, currency) values ($1, 'platform_losses', 'EUR')
       on conflict do nothing`,
      [eurAccount],
    );
    const { rows } = await pool.query<{ id: string }>(
      `select id from ledger_accounts where code = 'platform_losses' and currency = 'EUR'`,
    );
    await expect(
      inTransaction(async (client) => {
        await insertEntries(client, await insertTransaction(client), [
          [rows[0]?.id ?? eurAccount, 100],
          [accounts.cash, -100],
        ]);
      }),
    ).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('innej niż waluta transakcji') as string,
    });
  });

  it('zmiana i usunięcie wpisów, transakcji i kont oraz ręczna zmiana salda są odrzucane', async () => {
    const [entry] = (
      await pool.query<{ id: string; transaction_id: string }>(
        'select id, transaction_id from ledger_entries where account_id = $1 limit 1',
        [accounts.held],
      )
    ).rows;
    if (entry === undefined) {
      throw new Error('brak wpisu');
    }
    for (const statement of [
      `update ledger_entries set amount = amount + 1 where id = '${entry.id}'`,
      `delete from ledger_entries where id = '${entry.id}'`,
      'truncate ledger_entries',
      `update ledger_transactions set payload = '{}' where id = '${entry.transaction_id}'`,
      `delete from ledger_transactions where id = '${entry.transaction_id}'`,
      'truncate ledger_transactions cascade',
      `update ledger_accounts set balance = 0 where id = '${accounts.available}'`,
      `update ledger_accounts set seller_id = '${randomUUID()}' where id = '${accounts.held}'`,
      `delete from ledger_accounts where id = '${accounts.held}'`,
      'truncate ledger_accounts cascade',
      `insert into ledger_accounts (id, code, currency, balance)
       values ('${newId()}', 'platform_losses', 'USD', 100)`,
    ]) {
      await expect(pool.query(statement), statement).rejects.toMatchObject({
        code: '23001',
        message: expect.stringMatching(/niemodyfikowaln|saldo 0/) as string,
      });
    }
    // 100 zł cena zamówienia + 1 zł z ręcznie wstawionej, zbilansowanej transakcji wyżej.
    expect(await ledger.sellerBalances(order.sellerId)).toMatchObject({
      available: money(10_000 + 100),
    });
  });
});

describe('spójność: salda odtworzone z samych wpisów (LedgerIntegrity)', () => {
  it('bez rozjazdów; rozjazd po zmianie salda z pominięciem triggerów zgłasza job', async () => {
    const clean = await integrity.verify();
    expect(clean.unbalancedTransactions).toEqual([]);
    expect(clean.balanceMismatches).toEqual([]);
    expect(clean.transactions).toBeGreaterThan(0);
    expect(clean.entries).toBeGreaterThanOrEqual(2 * clean.transactions);
    await expect(integrity.verifyDaily()).resolves.toEqual(clean);

    // Tylko właściciel tabeli (np. superużytkownik) może wyłączyć trigger; aplikacja tego nie robi.
    const tamper = async (delta: number) => {
      await pool.query('alter table ledger_accounts disable trigger ledger_accounts_guard');
      try {
        await pool.query(
          `update ledger_accounts set balance = balance + $1
            where code = 'platform_losses' and subject is null and currency = 'PLN'`,
          [delta],
        );
      } finally {
        await pool.query('alter table ledger_accounts enable trigger ledger_accounts_guard');
      }
    };
    const losses = await ledger.balance({
      code: 'platform_losses',
      subject: null,
      currency: 'PLN',
    });
    await tamper(1);
    try {
      const report = await integrity.verify();
      expect(report.balanceMismatches).toEqual([
        {
          accountId: expect.any(String) as string,
          account: 'platform_losses',
          currency: 'PLN',
          balance: losses.amount + 1,
          recomputed: losses.amount,
        },
      ]);
      await expect(integrity.verifyDaily()).rejects.toBeInstanceOf(LedgerIntegrityError);
    } finally {
      await tamper(-1);
    }
    expect((await integrity.verify()).balanceMismatches).toEqual([]);
  });
});

describe('property-based: baza = model w pamięci', () => {
  /** Salda kont platformy (bez parametru) ze znakiem, po kluczu konta. */
  async function platformSnapshot(): Promise<Map<string, number>> {
    const { rows } = await pool.query<{
      code: LedgerAccountCode;
      currency: 'PLN';
      balance: string;
    }>(
      'select code, currency, balance::text as balance from ledger_accounts where subject is null',
    );
    return new Map(
      rows.map((row) => [
        accountKey({ code: row.code, subject: null, currency: row.currency }),
        Number(row.balance),
      ]),
    );
  }

  it('te same losowe zdarzenia dają te same decyzje i salda w Postgresie co w modelu', async () => {
    await fc.assert(
      fc.asyncProperty(
        scenarioOrdersArbitrary,
        scenarioActionsArbitrary,
        async (orders, actions) => {
          const driver = new ScenarioDriver(orders);
          // Konta platformy są wspólne dla całego pliku testów (np. należność od przewoźników ma
          // ograniczenie salda), więc model startuje z ich stanem z bazy.
          const model = new InMemoryLedger();
          const { rows: platformRows } = await pool.query<{
            code: LedgerAccountCode;
            currency: 'PLN';
            balance: string;
          }>(
            'select code, currency, balance::text as balance from ledger_accounts where subject is null',
          );
          for (const row of platformRows) {
            model.seed(
              { code: row.code, subject: null, currency: row.currency },
              Number(row.balance),
            );
          }

          for (const action of actions) {
            const posting = driver.posting(action);
            if (posting === undefined) {
              continue;
            }
            const outcome = async (run: () => unknown): Promise<'ok' | 'insufficient'> => {
              try {
                await run();
                return 'ok';
              } catch (error) {
                if (isInsufficientFunds(error)) {
                  return 'insufficient';
                }
                throw error;
              }
            };
            const expected = await outcome(() => model.post(posting));
            expect(await outcome(() => post(posting)), posting.type).toBe(expected);
            if (expected === 'ok') {
              driver.accepted(posting);
            }
          }

          const subjects = [
            driver.provider,
            ...driver.sellerIds,
            ...driver.orderIds,
            ...driver.payouts.map((payout) => payout.id),
          ];
          const { rows } = await pool.query<{
            code: LedgerAccountCode;
            subject: string;
            currency: 'PLN';
            balance: string;
            recomputed: string;
          }>(
            `select a.code, a.subject, a.currency, a.balance::text as balance,
                  coalesce((select sum(e.amount) from ledger_entries e where e.account_id = a.id), 0)::text
                    as recomputed
             from ledger_accounts a where a.subject = any($1)`,
            [subjects],
          );
          const stored = new Map(rows.map((row) => [accountKey(row), Number(row.balance)]));
          for (const row of rows) {
            expect(Number(row.recomputed), accountLabel(row)).toBe(Number(row.balance));
          }
          const modelAccounts = model.allAccounts();
          const ownAccounts = modelAccounts.filter((account) => account.ref.subject !== null);
          expect(stored.size).toBe(ownAccounts.length);
          for (const account of ownAccounts) {
            expect(stored.get(accountKey(account.ref)), accountLabel(account.ref)).toBe(
              account.balance,
            );
          }
          const platformAfter = await platformSnapshot();
          for (const account of modelAccounts.filter(
            (candidate) => candidate.ref.subject === null,
          )) {
            const key = accountKey(account.ref);
            expect(platformAfter.get(key) ?? 0, key).toBe(account.balance);
          }
          for (const sellerId of driver.sellerIds) {
            const expected = model.sellerBalances(sellerId);
            expect(await ledger.sellerBalances(sellerId)).toEqual({
              available: money(expected.available),
              pending: money(expected.pending),
              receivable: money(expected.receivable),
              payoutsInTransit: money(expected.payoutsInTransit),
            });
          }
        },
      ),
      { numRuns: 15 },
    );

    const report = await integrity.verify();
    expect(report.unbalancedTransactions).toEqual([]);
    expect(report.balanceMismatches).toEqual([]);
  });
});

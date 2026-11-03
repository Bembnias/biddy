// Ledger (F-22, PROJECT.md §7.7): księgowanie zdarzeń biznesowych według szablonów w transakcji
// wywołującego oraz odczyt sald. Bilans transakcji, saldo = suma wpisów i niemodyfikowalność
// wymusza baza (migracja 0015_ledger). Serwis blokuje konta księgowania w stałej kolejności,
// liczy wpisy na zablokowanych saldach (podział między saldo dostępne a należność sprzedającego)
// i zamienia naruszenia reguł na LedgerError, zanim zrobi to CHECK w bazie.
import { isDeepStrictEqual } from 'node:util';

import { type CurrencyCode, DEFAULT_CURRENCY, type Money, money } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';

import { type Database, DRIZZLE, type Transaction } from '../../infra/db/index.js';
import * as ledgerTables from './db/ledger.schema.js';
import {
  type LedgerAccountRow,
  ledgerAccounts,
  ledgerEntries,
  ledgerTransactions,
  type LedgerTransactionRow,
} from './db/ledger.schema.js';
import {
  accountKey,
  accountLabel,
  compareAccounts,
  type LedgerAccountRef,
  normalBalance,
} from './domain/accounts.js';
import { LedgerError } from './domain/ledger-error.js';
import {
  assertAccountMatches,
  assertAllowedBalances,
  type LedgerPosting,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  type PlannedAccount,
  type PlannedEntry,
  planPosting,
  reversalEntries,
} from './domain/postings.js';
import type { LedgerTransactionType } from './domain/transaction-types.js';

export interface PostedLedgerEntry {
  readonly account: LedgerAccountRef;
  /** Kwota ze znakiem: dodatnia = Winien (debet), ujemna = Ma (kredyt). */
  readonly amount: Money;
}

/** Zaksięgowana transakcja z wpisami. */
export interface PostedLedgerTransaction {
  readonly id: string;
  readonly type: LedgerTransactionType;
  readonly idempotencyKey: string;
  readonly orderId: string | null;
  readonly payoutId: string | null;
  readonly reversesTransactionId: string | null;
  readonly createdAt: Date;
  /** Najwyżej jeden wpis na konto, w stałej kolejności kont. */
  readonly entries: readonly PostedLedgerEntry[];
  /** true: ponowienie z tym samym kluczem zwróciło wcześniejszą transakcję bez nowych wpisów. */
  readonly replayed: boolean;
}

/** Salda sprzedającego w jednej walucie, jako kwoty nieujemne. */
export interface SellerBalances {
  /** Do wypłaty (`seller_balance_available`). */
  readonly available: Money;
  /** W trakcie: ceny otwartych zamówień ze wstrzymanymi środkami (`buyer_funds_held`, §7.7). */
  readonly pending: Money;
  /** Należność sprzedającego wobec Biddy (`seller_receivable`). */
  readonly receivable: Money;
  /** Wypłaty zlecone, jeszcze niepotwierdzone przez operatora (`payouts_in_transit`). */
  readonly payoutsInTransit: Money;
}

/** Transakcja ledgera na saldzie sprzedającego (historia salda, F-27). */
export interface SellerBalanceMovement {
  readonly transactionId: string;
  readonly type: LedgerTransactionType;
  readonly orderId: string | null;
  readonly payoutId: string | null;
  readonly createdAt: Date;
  /** Zmiana salda dostępnego: + uznanie, − obciążenie (np. zlecenie wypłaty). */
  readonly available: Money;
  /** Zmiana należności: + nowa należność, − spłata albo spisanie. */
  readonly receivable: Money;
}

export interface SellerHistoryPage {
  readonly items: readonly SellerBalanceMovement[];
  /** ID ostatniej transakcji na stronie, gdy są starsze; undefined na końcu historii. */
  readonly nextCursor: string | undefined;
}

/** Saldo dostępne sprzedającego bez sprzedaży od dawna (wypłata salda uśpionego, F-27). */
export interface DormantSellerBalance {
  readonly sellerId: string;
  readonly available: Money;
}

/** Księgowania, które są sprzedażą (uznanie salda ceną zamówienia). */
const SALE_TRANSACTION_TYPES: readonly LedgerTransactionType[] = [
  'ORDER_COMPLETED',
  'ORDER_PARTIALLY_REFUNDED',
];

const SELLER_BALANCE_CODES = ['seller_balance_available', 'seller_receivable'] as const;

export interface ReverseLedgerTransactionInput {
  readonly transactionId: string;
  readonly idempotencyKey: string;
  /** Powód korekty (audyt), np. „Pomyłka w kwocie rekompensaty, zgłoszenie #123”. */
  readonly reason: string;
}

const MAX_REASON_LENGTH = 1_000;

@Injectable()
export class LedgerService {
  constructor(@Inject(DRIZZLE) private readonly db: Database<typeof ledgerTables>) {}

  /**
   * Księguje zdarzenie w transakcji wywołującego (zmiana stanu, wpisy i event w outboxie to jedna
   * transakcja, §7.3). Ponowienie z tym samym kluczem i danymi zwraca istniejącą transakcję.
   * Błąd przerywa transakcję wywołującego.
   *
   * @throws {LedgerError} INVALID_POSTING, INSUFFICIENT_FUNDS, IDEMPOTENCY_CONFLICT,
   *   ACCOUNT_MISMATCH
   */
  async post(tx: Transaction, posting: LedgerPosting): Promise<PostedLedgerTransaction> {
    const plan = planPosting(posting);
    // Najpierw klucz: ponowienie nie blokuje kont ani nie liczy wpisów na nowych saldach.
    const transaction = await this.insertTransaction(tx, {
      type: plan.type,
      idempotencyKey: posting.idempotencyKey,
      currency: plan.currency,
      orderId: plan.orderId,
      payoutId: plan.payoutId,
      payload: plan.payload,
    });
    if (transaction === undefined) {
      return this.replay(tx, posting.idempotencyKey, plan.type, plan.payload);
    }
    const accounts = await this.lockAccounts(tx, plan.accounts);
    const balanceOf = (account: LedgerAccountRef) =>
      accounts.get(accountKey(account))?.balance ?? 0;
    const entries = plan.entries(balanceOf);
    assertAllowedBalances(entries, balanceOf);
    await this.insertEntries(tx, transaction.id, entries, accounts);
    return posted(transaction, entries, false);
  }

  /**
   * Storno: nowa transakcja `REVERSAL` z wpisami wycofanej transakcji z przeciwnym znakiem, na
   * tych samych kontach i z tymi samymi ograniczeniami sald (bez spłaty należności). Transakcję
   * można wycofać raz; storna nie da się wycofać.
   *
   * @throws {LedgerError} TRANSACTION_NOT_FOUND, ALREADY_REVERSED, INVALID_POSTING,
   *   INSUFFICIENT_FUNDS, IDEMPOTENCY_CONFLICT
   */
  async reverse(
    tx: Transaction,
    input: ReverseLedgerTransactionInput,
  ): Promise<PostedLedgerTransaction> {
    const reason = input.reason.trim();
    if (reason.length === 0 || reason.length > MAX_REASON_LENGTH) {
      throw new LedgerError(
        'INVALID_POSTING',
        `Powód storna musi mieć od 1 do ${MAX_REASON_LENGTH} znaków.`,
      );
    }
    if (
      input.idempotencyKey.length === 0 ||
      input.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH
    ) {
      throw new LedgerError(
        'INVALID_POSTING',
        `Klucz księgowania musi mieć od 1 do ${MAX_IDEMPOTENCY_KEY_LENGTH} znaków.`,
      );
    }
    const [original] = await tx
      .select()
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.id, input.transactionId));
    if (original === undefined) {
      throw new LedgerError(
        'TRANSACTION_NOT_FOUND',
        `Nie ma transakcji księgowej ${input.transactionId}.`,
      );
    }
    if (original.type === 'REVERSAL') {
      throw new LedgerError('INVALID_POSTING', 'Storna nie można wycofać.');
    }
    const payload = { transactionId: original.id, reason };
    const transaction = await this.insertTransaction(tx, {
      type: 'REVERSAL',
      idempotencyKey: input.idempotencyKey,
      currency: original.currency,
      orderId: original.orderId,
      payoutId: original.payoutId,
      reversesTransactionId: original.id,
      payload,
    });
    if (transaction === undefined) {
      return this.replay(tx, input.idempotencyKey, 'REVERSAL', payload, () => {
        throw new LedgerError(
          'ALREADY_REVERSED',
          `Transakcja księgowa ${original.id} ma już storno.`,
        );
      });
    }
    const entries = reversalEntries(await this.entriesOf(tx, original.id));
    const accounts = await this.lockAccounts(
      tx,
      entries.map((entry) => ({ ...entry.account, opens: false })),
    );
    const balanceOf = (account: LedgerAccountRef) =>
      accounts.get(accountKey(account))?.balance ?? 0;
    assertAllowedBalances(entries, balanceOf);
    await this.insertEntries(tx, transaction.id, entries, accounts);
    return posted(transaction, entries, false);
  }

  /** Saldo konta po stronie normalnej, np. saldo dostępne 70 zł jako `+70 zł`; 0 bez konta. */
  async balance(account: LedgerAccountRef, tx?: Transaction): Promise<Money> {
    const [row] = await (tx ?? this.db)
      .select({ balance: ledgerAccounts.balance })
      .from(ledgerAccounts)
      .where(matches(account));
    return money(normalBalance(account.code, row?.balance ?? 0), account.currency);
  }

  /** Środki wstrzymane na zamówieniu (po stanie końcowym zamówienia: 0). */
  async heldForOrder(
    orderId: string,
    currency: CurrencyCode = DEFAULT_CURRENCY,
    tx?: Transaction,
  ): Promise<Money> {
    return this.balance({ code: 'buyer_funds_held', subject: orderId, currency }, tx);
  }

  /** Salda sprzedającego: dostępne, w trakcie, należność i wypłaty w drodze. */
  async sellerBalances(
    sellerId: string,
    currency: CurrencyCode = DEFAULT_CURRENCY,
    tx?: Transaction,
  ): Promise<SellerBalances> {
    const rows = await (tx ?? this.db)
      .select({
        code: ledgerAccounts.code,
        balance: ledgerAccounts.balance,
        sellerAmount: ledgerAccounts.sellerAmount,
      })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.sellerId, sellerId),
          eq(ledgerAccounts.currency, currency),
          // Zamówienia zakończone (saldo 0) nie są już „w trakcie”.
          or(ne(ledgerAccounts.code, 'buyer_funds_held'), ne(ledgerAccounts.balance, 0)),
        ),
      );
    const totals = { available: 0, pending: 0, receivable: 0, payoutsInTransit: 0 };
    for (const row of rows) {
      const balance = normalBalance(row.code, row.balance);
      if (row.code === 'seller_balance_available') {
        totals.available += balance;
      } else if (row.code === 'seller_receivable') {
        totals.receivable += balance;
      } else if (row.code === 'payouts_in_transit') {
        totals.payoutsInTransit += balance;
      } else if (row.code === 'buyer_funds_held') {
        totals.pending += row.sellerAmount ?? 0;
      }
    }
    return {
      available: money(totals.available, currency),
      pending: money(totals.pending, currency),
      receivable: money(totals.receivable, currency),
      payoutsInTransit: money(totals.payoutsInTransit, currency),
    };
  }

  /**
   * Historia salda sprzedającego: transakcje, które zmieniły jego saldo dostępne albo należność,
   * od najnowszej (ID UUIDv7 rosną z czasem). Kursor to ID ostatniej transakcji poprzedniej strony.
   */
  async sellerHistory(
    sellerId: string,
    options: { readonly before?: string; readonly limit: number; readonly currency?: CurrencyCode },
  ): Promise<SellerHistoryPage> {
    const currency = options.currency ?? DEFAULT_CURRENCY;
    const available = sql<string>`coalesce(sum(${ledgerEntries.amount}) filter (where ${ledgerAccounts.code} = 'seller_balance_available'), 0)`;
    const receivable = sql<string>`coalesce(sum(${ledgerEntries.amount}) filter (where ${ledgerAccounts.code} = 'seller_receivable'), 0)`;
    const rows = await this.db
      .select({
        transactionId: ledgerTransactions.id,
        type: ledgerTransactions.type,
        orderId: ledgerTransactions.orderId,
        payoutId: ledgerTransactions.payoutId,
        createdAt: ledgerTransactions.createdAt,
        available,
        receivable,
      })
      .from(ledgerEntries)
      .innerJoin(ledgerAccounts, eq(ledgerEntries.accountId, ledgerAccounts.id))
      .innerJoin(ledgerTransactions, eq(ledgerEntries.transactionId, ledgerTransactions.id))
      .where(
        and(
          eq(ledgerAccounts.sellerId, sellerId),
          eq(ledgerAccounts.currency, currency),
          inArray(ledgerAccounts.code, [...SELLER_BALANCE_CODES]),
          options.before === undefined ? undefined : lt(ledgerTransactions.id, options.before),
        ),
      )
      .groupBy(ledgerTransactions.id)
      .orderBy(desc(ledgerTransactions.id))
      .limit(options.limit + 1);
    const items = rows.slice(0, options.limit).map((row) => ({
      transactionId: row.transactionId,
      type: row.type,
      orderId: row.orderId,
      payoutId: row.payoutId,
      createdAt: row.createdAt,
      available: money(normalBalance('seller_balance_available', Number(row.available)), currency),
      receivable: money(normalBalance('seller_receivable', Number(row.receivable)), currency),
    }));
    return {
      items,
      nextCursor: rows.length > options.limit ? items.at(-1)?.transactionId : undefined,
    };
  }

  /**
   * Sprzedający z saldem dostępnym w przedziale (0, `below`), bez otwartych zamówień ze
   * wstrzymanymi środkami i bez sprzedaży (`ORDER_COMPLETED`, `ORDER_PARTIALLY_REFUNDED`) od
   * `inactiveSince` (§7.6: saldo poniżej minimum nie może utknąć).
   */
  async dormantSellerBalances(options: {
    readonly below: Money;
    readonly inactiveSince: Date;
    readonly limit: number;
    /** Kursor: sprzedający po tym ID (kolejność po ID). */
    readonly after?: string;
  }): Promise<DormantSellerBalance[]> {
    const { currency } = options.below;
    const rows = await this.db
      .select({ sellerId: ledgerAccounts.sellerId, balance: ledgerAccounts.balance })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.code, 'seller_balance_available'),
          eq(ledgerAccounts.currency, currency),
          options.after === undefined ? undefined : gt(ledgerAccounts.sellerId, options.after),
          // Saldo zobowiązania jest ujemne: (0, below) po stronie normalnej.
          lt(ledgerAccounts.balance, 0),
          sql`${ledgerAccounts.balance} > ${-options.below.amount}`,
          sql`not exists (select 1 from ledger_accounts held where held.seller_id = ${ledgerAccounts.sellerId} and held.code = 'buyer_funds_held' and held.balance <> 0)`,
          sql`not exists (select 1 from ${ledgerEntries} join ${ledgerTransactions} on ${ledgerTransactions.id} = ${ledgerEntries.transactionId} where ${ledgerEntries.accountId} = ${ledgerAccounts.id} and ${inArray(ledgerTransactions.type, [...SALE_TRANSACTION_TYPES])} and ${ledgerTransactions.createdAt} >= ${options.inactiveSince})`,
        ),
      )
      .orderBy(ledgerAccounts.sellerId)
      .limit(options.limit);
    return rows.flatMap((row) =>
      row.sellerId === null
        ? []
        : [
            {
              sellerId: row.sellerId,
              available: money(normalBalance('seller_balance_available', row.balance), currency),
            },
          ],
    );
  }

  private async insertTransaction(
    tx: Transaction,
    values: typeof ledgerTransactions.$inferInsert,
  ): Promise<LedgerTransactionRow | undefined> {
    // Konflikt na kluczu (albo na stornie tej samej transakcji): równoległe księgowanie z tym
    // samym kluczem czeka tu na zatwierdzenie pierwszego i dostaje jego wynik.
    const [row] = await tx
      .insert(ledgerTransactions)
      .values(values)
      .onConflictDoNothing()
      .returning();
    return row;
  }

  private async replay(
    tx: Transaction,
    idempotencyKey: string,
    type: LedgerTransactionType,
    payload: Record<string, unknown>,
    onMissing: () => never = () => {
      throw new Error(`Konflikt przy zapisie transakcji księgowej ${idempotencyKey}`);
    },
  ): Promise<PostedLedgerTransaction> {
    const [existing] = await tx
      .select()
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.idempotencyKey, idempotencyKey));
    if (existing === undefined) {
      return onMissing();
    }
    if (existing.type !== type || !isDeepStrictEqual(existing.payload, payload)) {
      throw new LedgerError(
        'IDEMPOTENCY_CONFLICT',
        `Klucz księgowania ${idempotencyKey} użyto już dla innych danych (${existing.type}).`,
      );
    }
    return posted(existing, await this.entriesOf(tx, existing.id), true);
  }

  /**
   * Zakłada brakujące konta, które księgowanie może otworzyć, i blokuje wszystkie konta
   * księgowania (`FOR UPDATE`) w stałej kolejności, więc dwa księgowania tych samych kont się
   * nie zakleszczą, a salda nie zmienią się do końca transakcji wywołującego.
   */
  private async lockAccounts(
    tx: Transaction,
    planned: readonly PlannedAccount[],
  ): Promise<Map<string, LedgerAccountRow>> {
    const sorted = [...planned].sort(compareAccounts);
    const opening = sorted.filter((account) => account.opens);
    if (opening.length > 0) {
      await tx
        .insert(ledgerAccounts)
        .values(
          opening.map((account) => ({
            code: account.code,
            subject: account.subject,
            currency: account.currency,
            sellerId: account.sellerId ?? null,
            sellerAmount: account.sellerAmount ?? null,
          })),
        )
        .onConflictDoNothing();
    }
    const rows = await tx
      .select()
      .from(ledgerAccounts)
      .where(or(...sorted.map(matches)))
      .orderBy(sql`${ledgerAccounts.code} collate "C"`, sql`${ledgerAccounts.subject} collate "C"`)
      .for('update');
    const byKey = new Map(rows.map((row) => [accountKey(row), row]));
    for (const account of sorted) {
      const row = byKey.get(accountKey(account));
      if (row !== undefined) {
        assertAccountMatches(account, row);
      }
    }
    return byKey;
  }

  private async insertEntries(
    tx: Transaction,
    transactionId: string,
    entries: readonly PlannedEntry[],
    accounts: ReadonlyMap<string, LedgerAccountRow>,
  ): Promise<void> {
    await tx.insert(ledgerEntries).values(
      entries.map((entry) => {
        const account = accounts.get(accountKey(entry.account));
        if (account === undefined) {
          throw new Error(`Brak konta ${accountLabel(entry.account)} dla wpisu księgowego`);
        }
        return { transactionId, accountId: account.id, amount: entry.amount };
      }),
    );
  }

  private async entriesOf(tx: Transaction, transactionId: string): Promise<PlannedEntry[]> {
    const rows = await tx
      .select({
        code: ledgerAccounts.code,
        subject: ledgerAccounts.subject,
        currency: ledgerAccounts.currency,
        amount: ledgerEntries.amount,
      })
      .from(ledgerEntries)
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
      .where(eq(ledgerEntries.transactionId, transactionId));
    return rows
      .map(({ amount, ...account }) => ({ account, amount }))
      .sort((a, b) => compareAccounts(a.account, b.account));
  }
}

function matches(account: LedgerAccountRef) {
  return and(
    eq(ledgerAccounts.code, account.code),
    account.subject === null
      ? isNull(ledgerAccounts.subject)
      : eq(ledgerAccounts.subject, account.subject),
    eq(ledgerAccounts.currency, account.currency),
  );
}

function posted(
  row: LedgerTransactionRow,
  entries: readonly PlannedEntry[],
  replayed: boolean,
): PostedLedgerTransaction {
  return {
    id: row.id,
    type: row.type,
    idempotencyKey: row.idempotencyKey,
    orderId: row.orderId,
    payoutId: row.payoutId,
    reversesTransactionId: row.reversesTransactionId,
    createdAt: row.createdAt,
    entries: entries.map((entry) => ({
      account: entry.account,
      amount: money(entry.amount, entry.account.currency),
    })),
    replayed,
  };
}

// Tabele modułu ledger (F-22, PROJECT.md §7.7): księga podwójnego zapisu. Kwoty w groszach
// (bigint) ze znakiem: + = Winien (debet), − = Ma (kredyt).
//
// Plik nie zależy od NestJS: czyta go też drizzle-kit (drizzle.config.ts). Triggery (saldo konta
// z wpisów, bilans transakcji przy zatwierdzeniu, niemodyfikowalność) są w migracji 0015_ledger
// (Drizzle ich nie opisuje).
import type { CurrencyCode } from '@biddy/shared';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  char,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { idColumn } from '../../../infra/db/ids.js';
import { accountCodes, LEDGER_ACCOUNT_CODES, type LedgerAccountCode } from '../domain/accounts.js';
import {
  LEDGER_TRANSACTION_TYPES,
  type LedgerTransactionType,
} from '../domain/transaction-types.js';

const money = () => bigint({ mode: 'number' });

/** Lista wartości do warunku `in (…)` w CHECK. */
function sqlList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

const SUBJECT_CODES = sqlList(accountCodes((account) => account.subject !== 'NONE'));
const SELLER_CODES = sqlList(accountCodes((account) => account.seller));
const OWN_SELLER_CODES = sqlList(accountCodes((account) => account.subject === 'SELLER'));
const CREDIT_LIMITED_CODES = sqlList(
  accountCodes((account) => account.nonNegative && account.kind === 'LIABILITY'),
);
const DEBIT_LIMITED_CODES = sqlList(
  accountCodes((account) => account.nonNegative && account.kind === 'ASSET'),
);

/**
 * Konto planu kont w jednej walucie. Konta z parametrem (operator, sprzedający, zamówienie,
 * wypłata) powstają przy pierwszym księgowaniu. `balance` to suma wpisów: zmienia ją wyłącznie
 * trigger przy wstawieniu wpisu, a CHECK nie pozwala kontom użytkowników i zamówień przejść na
 * złą stronę (np. ujemne saldo dostępne).
 */
export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: idColumn(),
    code: text().$type<LedgerAccountCode>().notNull(),
    /** Operator płatności, ID sprzedającego, zamówienia albo wypłaty; null dla kont platformy. */
    subject: text(),
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    /**
     * Sprzedający, którego dotyczy konto: jego salda, środki jego zamówień (`buyer_funds_held`)
     * i jego wypłaty (`payouts_in_transit`). Konto z modułu identity (uuid bez FK).
     */
    sellerId: uuid(),
    /** Tylko `buyer_funds_held`: część wstrzymanych środków dla sprzedającego (saldo „w trakcie”). */
    sellerAmount: money(),
    /** Saldo ze znakiem = suma wpisów konta (utrzymuje je trigger ledger_entries_apply). */
    balance: money().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('ledger_accounts_key').on(table.code, table.subject, table.currency).nullsNotDistinct(),
    index().on(table.sellerId, table.code),
    check('ledger_accounts_code_check', sql.raw(`code in (${sqlList(LEDGER_ACCOUNT_CODES)})`)),
    check(
      'ledger_accounts_subject_check',
      sql.raw(`(code in (${SUBJECT_CODES})) = (subject is not null)`),
    ),
    check(
      'ledger_accounts_seller_check',
      sql.raw(
        `(code in (${SELLER_CODES})) = (seller_id is not null) and (code not in (${OWN_SELLER_CODES}) or subject = seller_id::text)`,
      ),
    ),
    check(
      'ledger_accounts_seller_amount_check',
      sql`(${table.code} = 'buyer_funds_held') = (${table.sellerAmount} is not null) and (${table.sellerAmount} is null or ${table.sellerAmount} >= 0)`,
    ),
    check(
      'ledger_accounts_balance_side_check',
      sql.raw(
        `(code not in (${CREDIT_LIMITED_CODES}) or balance <= 0) and (code not in (${DEBIT_LIMITED_CODES}) or balance >= 0)`,
      ),
    ),
  ],
);

export type LedgerAccountRow = typeof ledgerAccounts.$inferSelect;

/**
 * Księgowanie (zdarzenie biznesowe): co najmniej dwa wpisy, które sumują się do zera (odroczony
 * trigger przy zatwierdzeniu). `idempotency_key` sprawia, że ponowienie nie dubluje wpisów.
 */
export const ledgerTransactions = pgTable(
  'ledger_transactions',
  {
    id: idColumn(),
    type: text().$type<LedgerTransactionType>().notNull(),
    idempotencyKey: text().notNull(),
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    /** Zamówienie i wypłata, których dotyczy księgowanie (moduły orders i payments; bez FK). */
    orderId: uuid(),
    payoutId: uuid(),
    /** Dla `REVERSAL`: wycofana transakcja (najwyżej jedno storno). */
    reversesTransactionId: uuid().references((): AnyPgColumn => ledgerTransactions.id),
    /** Dane wejściowe szablonu: kwoty, identyfikatory, powód. */
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('ledger_transactions_idempotency_key').on(table.idempotencyKey),
    uniqueIndex('ledger_transactions_reverses_key').on(table.reversesTransactionId),
    index().on(table.orderId),
    index().on(table.payoutId),
    check(
      'ledger_transactions_type_check',
      sql.raw(`type in (${sqlList(LEDGER_TRANSACTION_TYPES)})`),
    ),
    check(
      'ledger_transactions_reversal_check',
      sql`(${table.type} = 'REVERSAL') = (${table.reversesTransactionId} is not null)`,
    ),
    check(
      'ledger_transactions_idempotency_key_check',
      sql`length(${table.idempotencyKey}) between 1 and 200`,
    ),
  ],
);

export type LedgerTransactionRow = typeof ledgerTransactions.$inferSelect;

/** Wpis na koncie; niemodyfikowalny (korekta = nowa transakcja). */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: idColumn(),
    transactionId: uuid()
      .notNull()
      .references(() => ledgerTransactions.id),
    accountId: uuid()
      .notNull()
      .references(() => ledgerAccounts.id),
    /** Kwota ze znakiem w groszach: + Winien, − Ma. */
    amount: money().notNull(),
  },
  (table) => [
    // Historia konta: ID (UUIDv7) rosną z czasem.
    index().on(table.accountId, table.id),
    index().on(table.transactionId),
    check('ledger_entries_amount_check', sql`${table.amount} <> 0`),
  ],
);

export type LedgerEntryRow = typeof ledgerEntries.$inferSelect;

// Spójność ledgera (F-22, PROJECT.md §7.7): salda odtworzone z samych wpisów muszą być równe
// zapisanym, a każda transakcja księgowa ma co najmniej dwa wpisy, które sumują się do zera.
// Pilnują tego triggery, więc rozjazd oznacza zmianę z pominięciem triggerów (np. superużytkownik
// bazy) albo błąd w migracji. Codzienny job zgłasza go jako nieudany job (Sentry i dead-letter
// queue): alert „rozjazd ledgera ≠ 0” z §18.3. Uzgodnienia z operatorem dojdą w F-33.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../infra/db/index.js';
import { ScheduledJob } from '../../infra/queues/index.js';
import { accountLabel, type LedgerAccountCode } from './domain/accounts.js';

export interface UnbalancedLedgerTransaction {
  readonly transactionId: string;
  /** Suma wpisów w groszach (powinna wynosić 0). */
  readonly total: number;
  readonly entries: number;
}

export interface LedgerBalanceMismatch {
  readonly accountId: string;
  /** Nazwa konta jak w §7.7, np. `seller_balance_available:{userId}`. */
  readonly account: string;
  readonly currency: string;
  /** Saldo zapisane w `ledger_accounts.balance`. */
  readonly balance: number;
  /** Saldo policzone od nowa z wpisów. */
  readonly recomputed: number;
}

export interface LedgerIntegrityReport {
  readonly transactions: number;
  readonly entries: number;
  readonly accounts: number;
  readonly unbalancedTransactions: readonly UnbalancedLedgerTransaction[];
  readonly balanceMismatches: readonly LedgerBalanceMismatch[];
}

/** Ledger nie jest spójny: szczegóły w `report` (i w Sentry). */
export class LedgerIntegrityError extends Error {
  override name = 'LedgerIntegrityError';
  readonly report: LedgerIntegrityReport;

  constructor(report: LedgerIntegrityReport) {
    super(
      `Rozjazd ledgera: ${report.unbalancedTransactions.length} niezbilansowanych transakcji, ` +
        `${report.balanceMismatches.length} kont z saldem innym niż suma wpisów`,
    );
    this.report = report;
  }
}

/** Najwyżej tyle problemów każdego rodzaju trafia do raportu (reszta i tak wymaga śledztwa). */
const MAX_REPORTED = 100;

@Injectable()
export class LedgerIntegrity {
  private readonly logger = new Logger(LedgerIntegrity.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Sprawdza bilans transakcji i salda kont w jednym spójnym odczycie (REPEATABLE READ). */
  async verify(): Promise<LedgerIntegrityReport> {
    return this.db.transaction(
      async (tx) => {
        const counts = await tx.execute<{
          transactions: number;
          entries: number;
          accounts: number;
        }>(
          sql`select (select count(*) from ledger_transactions)::int as transactions,
                     (select count(*) from ledger_entries)::int as entries,
                     (select count(*) from ledger_accounts)::int as accounts`,
        );
        const unbalanced = await tx.execute<{ id: string; total: string; entries: number }>(sql`
          select t.id, coalesce(sum(e.amount), 0)::text as total, count(e.id)::int as entries
            from ledger_transactions t
            left join ledger_entries e on e.transaction_id = t.id
           group by t.id
          having coalesce(sum(e.amount), 0) <> 0 or count(e.id) < 2
           order by t.id
           limit ${MAX_REPORTED}`);
        const mismatched = await tx.execute<{
          id: string;
          code: LedgerAccountCode;
          subject: string | null;
          currency: string;
          balance: string;
          recomputed: string;
        }>(sql`
          select a.id, a.code, a.subject, a.currency, a.balance::text as balance,
                 coalesce(sum(e.amount), 0)::text as recomputed
            from ledger_accounts a
            left join ledger_entries e on e.account_id = a.id
           group by a.id
          having a.balance <> coalesce(sum(e.amount), 0)
           order by a.id
           limit ${MAX_REPORTED}`);
        const [total] = counts.rows;
        return {
          transactions: total?.transactions ?? 0,
          entries: total?.entries ?? 0,
          accounts: total?.accounts ?? 0,
          unbalancedTransactions: unbalanced.rows.map((row) => ({
            transactionId: row.id,
            total: Number(row.total),
            entries: row.entries,
          })),
          balanceMismatches: mismatched.rows.map((row) => ({
            accountId: row.id,
            account: accountLabel(row),
            currency: row.currency,
            balance: Number(row.balance),
            recomputed: Number(row.recomputed),
          })),
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  /** Codzienne sprawdzenie; rozjazd kończy job błędem (Sentry, dead-letter queue). */
  @ScheduledJob({ queue: 'maintenance', name: 'ledger.verify-integrity', pattern: '30 4 * * *' })
  async verifyDaily(): Promise<LedgerIntegrityReport> {
    const report = await this.verify();
    if (report.unbalancedTransactions.length > 0 || report.balanceMismatches.length > 0) {
      this.logger.error(report, 'Rozjazd ledgera: salda albo transakcje niezgodne z wpisami');
      throw new LedgerIntegrityError(report);
    }
    this.logger.log(
      { transactions: report.transactions, entries: report.entries, accounts: report.accounts },
      'Ledger spójny: salda równe sumom wpisów, transakcje zbilansowane',
    );
    return report;
  }
}

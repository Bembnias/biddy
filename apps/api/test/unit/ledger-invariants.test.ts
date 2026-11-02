// Niezmienniki ledgera z PROJECT.md §7.7 (F-22) na losowych sekwencjach ruchów pieniędzy, w modelu
// w pamięci (te same szablony co LedgerService, bez bazy). Ten sam model porównuje z Postgresem
// test integracyjny (test/integration/ledger.int.test.ts).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  accountLabel,
  LEDGER_ACCOUNTS,
  normalBalance,
} from '../../src/modules/ledger/domain/accounts.js';
import type { PlannedEntry } from '../../src/modules/ledger/domain/postings.js';
import {
  InMemoryLedger,
  isInsufficientFunds,
  ScenarioDriver,
  scenarioActionsArbitrary,
  scenarioOrdersArbitrary,
} from '../support/ledger-model.js';

function sumOf(entries: readonly PlannedEntry[]): number {
  return entries.reduce((total, entry) => total + entry.amount, 0);
}

describe('niezmienniki ledgera (property-based, model w pamięci)', () => {
  it('każda transakcja sumuje się do zera, salda sprzedającego są nieujemne i nigdy jednocześnie dodatnie, zamknięte zamówienie nie ma środków, suma sald = 0', () => {
    fc.assert(
      fc.property(scenarioOrdersArbitrary, scenarioActionsArbitrary, (orders, actions) => {
        const driver = new ScenarioDriver(orders);
        const ledger = new InMemoryLedger();
        for (const action of actions) {
          const posting = driver.posting(action);
          if (posting === undefined) {
            continue;
          }
          const availableBefore =
            posting.type === 'PAYOUT_REQUESTED'
              ? ledger.sellerBalances(posting.sellerId).available
              : 0;
          let entries: PlannedEntry[];
          try {
            entries = ledger.post(posting);
          } catch (error) {
            if (!isInsufficientFunds(error)) {
              throw error;
            }
            // Wypłata jest odrzucana tylko ponad saldo dostępne.
            if (posting.type === 'PAYOUT_REQUESTED') {
              expect(posting.amount.amount).toBeGreaterThan(availableBefore);
            }
            continue;
          }
          driver.accepted(posting);
          if (posting.type === 'PAYOUT_REQUESTED') {
            expect(posting.amount.amount).toBeLessThanOrEqual(availableBefore);
          }

          expect(sumOf(entries)).toBe(0);
          expect(new Set(entries.map((entry) => accountLabel(entry.account))).size).toBe(
            entries.length,
          );

          for (const [index, sellerId] of driver.sellerIds.entries()) {
            const balances = ledger.sellerBalances(sellerId);
            expect(balances.available).toBeGreaterThanOrEqual(0);
            expect(balances.receivable).toBeGreaterThanOrEqual(0);
            expect(balances.available > 0 && balances.receivable > 0).toBe(false);
            // „W trakcie” = ceny opłaconych, niezamkniętych zamówień sprzedającego.
            const pending = orders.reduce(
              (total, scenarioOrder, orderIndex) =>
                scenarioOrder.seller === index && driver.orderStates[orderIndex] === 'PAID'
                  ? total + scenarioOrder.amounts.itemsTotal.amount
                  : total,
              0,
            );
            expect(balances.pending).toBe(pending);
          }

          let trialBalance = 0;
          for (const account of ledger.allAccounts()) {
            trialBalance += account.balance;
            if (LEDGER_ACCOUNTS[account.ref.code].nonNegative) {
              expect(normalBalance(account.ref.code, account.balance)).toBeGreaterThanOrEqual(0);
            }
          }
          expect(trialBalance).toBe(0);

          for (const [orderIndex, orderId] of driver.orderIds.entries()) {
            if (driver.orderStates[orderIndex] === 'CLOSED') {
              expect(
                ledger.balance({ code: 'buyer_funds_held', subject: orderId, currency: 'PLN' }),
              ).toBe(0);
            }
          }
        }
      }),
      { numRuns: 300 },
    );
  });
});

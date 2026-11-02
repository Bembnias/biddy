// Ledger w pamięci i losowe scenariusze ruchów pieniędzy (F-22). Model stosuje te same szablony
// (planPosting) i reguły sald co LedgerService, ale bez bazy: test jednostkowy sprawdza na nim
// niezmienniki §7.7, a test integracyjny porównuje z nim salda zapisane w Postgresie.
import { randomUUID } from 'node:crypto';

import { type CurrencyCode, money, splitGross } from '@biddy/shared';
import fc from 'fast-check';

import {
  accountKey,
  type LedgerAccountRef,
  normalBalance,
} from '../../src/modules/ledger/domain/accounts.js';
import { LedgerError } from '../../src/modules/ledger/domain/ledger-error.js';
import {
  assertAccountMatches,
  assertAllowedBalances,
  type LedgerPosting,
  type OrderAmounts,
  type PlannedEntry,
  planPosting,
} from '../../src/modules/ledger/domain/postings.js';

interface ModelAccount {
  readonly ref: LedgerAccountRef;
  readonly sellerId: string | null;
  readonly sellerAmount: number | null;
  balance: number;
}

/** Ledger w pamięci: konta z saldami ze znakiem i lista zaksięgowanych wpisów. */
export class InMemoryLedger {
  private readonly accounts = new Map<string, ModelAccount>();
  readonly transactions: { readonly type: string; readonly entries: readonly PlannedEntry[] }[] =
    [];

  /** Jak LedgerService.post, bez idempotencji. @throws {LedgerError} */
  post(posting: LedgerPosting): PlannedEntry[] {
    const plan = planPosting(posting);
    for (const account of plan.accounts) {
      const stored = this.accounts.get(accountKey(account));
      if (stored !== undefined) {
        assertAccountMatches(account, stored);
      }
    }
    const balanceOf = (account: LedgerAccountRef) => this.signedBalance(account);
    const entries = plan.entries(balanceOf);
    assertAllowedBalances(entries, balanceOf);
    for (const account of plan.accounts) {
      const key = accountKey(account);
      if (account.opens && !this.accounts.has(key)) {
        this.accounts.set(key, {
          ref: { code: account.code, subject: account.subject, currency: account.currency },
          sellerId: account.sellerId ?? null,
          sellerAmount: account.sellerAmount ?? null,
          balance: 0,
        });
      }
    }
    for (const entry of entries) {
      const account = this.accounts.get(accountKey(entry.account));
      if (account === undefined) {
        throw new Error(`Wpis na koncie, którego nie ma: ${accountKey(entry.account)}`);
      }
      account.balance += entry.amount;
    }
    this.transactions.push({ type: plan.type, entries });
    return entries;
  }

  /** Saldo początkowe konta platformy, np. stan bazy przed scenariuszem w teście integracyjnym. */
  seed(account: LedgerAccountRef, signedBalance: number): void {
    this.accounts.set(accountKey(account), {
      ref: account,
      sellerId: null,
      sellerAmount: null,
      balance: signedBalance,
    });
  }

  signedBalance(account: LedgerAccountRef): number {
    return this.accounts.get(accountKey(account))?.balance ?? 0;
  }

  /** Saldo po stronie normalnej konta (jak LedgerService.balance). */
  balance(account: LedgerAccountRef): number {
    return normalBalance(account.code, this.signedBalance(account));
  }

  /** Wszystkie konta modelu. */
  allAccounts(): readonly ModelAccount[] {
    return [...this.accounts.values()];
  }

  /** Jak LedgerService.sellerBalances, w groszach. */
  sellerBalances(
    sellerId: string,
    currency: CurrencyCode = 'PLN',
  ): { available: number; pending: number; receivable: number; payoutsInTransit: number } {
    const totals = { available: 0, pending: 0, receivable: 0, payoutsInTransit: 0 };
    for (const account of this.accounts.values()) {
      if (account.sellerId !== sellerId || account.ref.currency !== currency) {
        continue;
      }
      const balance = normalBalance(account.ref.code, account.balance);
      if (account.ref.code === 'seller_balance_available') {
        totals.available += balance;
      } else if (account.ref.code === 'seller_receivable') {
        totals.receivable += balance;
      } else if (account.ref.code === 'payouts_in_transit') {
        totals.payoutsInTransit += balance;
      } else if (account.ref.code === 'buyer_funds_held' && account.balance !== 0) {
        totals.pending += account.sellerAmount ?? 0;
      }
    }
    return totals;
  }
}

// --- Scenariusze ---

/** Zamówienie w scenariuszu: kwoty i indeks sprzedającego. */
export interface ScenarioOrder {
  readonly seller: number;
  readonly amounts: OrderAmounts;
}

/** Zdarzenie scenariusza; indeksy wskazują sprzedających, zamówienia i wypłaty świata. */
export type ScenarioAction =
  | { readonly kind: 'pay'; readonly order: number }
  | { readonly kind: 'complete'; readonly order: number }
  | { readonly kind: 'refund'; readonly order: number }
  | { readonly kind: 'not-picked-up'; readonly order: number }
  | { readonly kind: 'partial-refund'; readonly order: number; readonly percent: number }
  | { readonly kind: 'dispute-costs'; readonly seller: number; readonly amount: number }
  | { readonly kind: 'payout'; readonly seller: number; readonly amount: number }
  | { readonly kind: 'payout-result'; readonly payout: number; readonly paid: boolean }
  | {
      readonly kind: 'compensation';
      readonly seller: number;
      readonly amount: number;
      readonly toBalance: boolean;
    }
  | { readonly kind: 'claim-settled'; readonly recovered: number; readonly unrecovered: number }
  | { readonly kind: 'write-off'; readonly seller: number; readonly amount: number }
  | { readonly kind: 'chargeback-absorbed'; readonly amount: number }
  | { readonly kind: 'chargeback-to-seller'; readonly seller: number; readonly amount: number }
  | { readonly kind: 'fee'; readonly amount: number };

export const SCENARIO_SELLERS = 2;
export const SCENARIO_ORDERS = 4;

const amount = fc.integer({ min: 1, max: 20_000 });

/** Kwoty zamówienia: cena, POK z VAT 23% (netto + VAT = brutto) i dostawa (także 0). */
export const orderAmountsArbitrary: fc.Arbitrary<OrderAmounts> = fc
  .record({
    itemsTotal: fc.integer({ min: 100, max: 50_000 }),
    pokFee: fc.integer({ min: 0, max: 5_000 }),
    shippingFee: fc.constantFrom(0, 999, 1_299, 1_899),
  })
  .map(({ itemsTotal, pokFee, shippingFee }) => ({
    itemsTotal: money(itemsTotal),
    pokFee: money(pokFee),
    pokVat: splitGross(money(pokFee), 2_300).vat,
    shippingFee: money(shippingFee),
  }));

export const scenarioOrdersArbitrary: fc.Arbitrary<ScenarioOrder[]> = fc.array(
  fc.record({
    seller: fc.integer({ min: 0, max: SCENARIO_SELLERS - 1 }),
    amounts: orderAmountsArbitrary,
  }),
  { minLength: SCENARIO_ORDERS, maxLength: SCENARIO_ORDERS },
);

const order = fc.integer({ min: 0, max: SCENARIO_ORDERS - 1 });
const seller = fc.integer({ min: 0, max: SCENARIO_SELLERS - 1 });

/** Zdarzenie scenariusza; płatności i zakończenia częściej, żeby salda rosły. */
export const scenarioActionArbitrary: fc.Arbitrary<ScenarioAction> = fc.oneof(
  { arbitrary: fc.record({ kind: fc.constant('pay' as const), order }), weight: 4 },
  { arbitrary: fc.record({ kind: fc.constant('complete' as const), order }), weight: 4 },
  { arbitrary: fc.record({ kind: fc.constant('refund' as const), order }), weight: 1 },
  { arbitrary: fc.record({ kind: fc.constant('not-picked-up' as const), order }), weight: 1 },
  {
    arbitrary: fc.record({
      kind: fc.constant('partial-refund' as const),
      order,
      percent: fc.integer({ min: 1, max: 100 }),
    }),
    weight: 1,
  },
  {
    arbitrary: fc.record({ kind: fc.constant('dispute-costs' as const), seller, amount }),
    weight: 2,
  },
  { arbitrary: fc.record({ kind: fc.constant('payout' as const), seller, amount }), weight: 3 },
  {
    arbitrary: fc.record({
      kind: fc.constant('payout-result' as const),
      payout: fc.integer({ min: 0, max: 5 }),
      paid: fc.boolean(),
    }),
    weight: 2,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('compensation' as const),
      seller,
      amount,
      toBalance: fc.boolean(),
    }),
    weight: 1,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('claim-settled' as const),
      recovered: fc.integer({ min: 0, max: 10_000 }),
      unrecovered: fc.integer({ min: 0, max: 10_000 }),
    }),
    weight: 1,
  },
  { arbitrary: fc.record({ kind: fc.constant('write-off' as const), seller, amount }), weight: 1 },
  {
    arbitrary: fc.record({ kind: fc.constant('chargeback-absorbed' as const), amount }),
    weight: 1,
  },
  {
    arbitrary: fc.record({ kind: fc.constant('chargeback-to-seller' as const), seller, amount }),
    weight: 1,
  },
  { arbitrary: fc.record({ kind: fc.constant('fee' as const), amount }), weight: 1 },
);

export const scenarioActionsArbitrary = fc.array(scenarioActionArbitrary, {
  minLength: 1,
  maxLength: 30,
});

/** Stan zamówienia w scenariuszu (uproszczony cykl §7.3). */
export type ScenarioOrderState = 'AWAITING_PAYMENT' | 'PAID' | 'CLOSED';

/**
 * Zamienia zdarzenia scenariusza na księgowania według stanu zamówień i wypłat (np. zakończyć
 * można tylko opłacone zamówienie). Identyfikatory są losowe, więc kolejne scenariusze
 * w jednej bazie nie dzielą kont użytkowników, zamówień, wypłat ani operatora.
 */
export class ScenarioDriver {
  readonly provider = `p-${randomUUID().slice(0, 8)}`;
  readonly sellerIds: string[] = Array.from({ length: SCENARIO_SELLERS }, () => randomUUID());
  readonly orderIds: string[];
  readonly orderStates: ScenarioOrderState[];
  readonly payouts: { id: string; seller: number; amount: number; open: boolean }[] = [];
  private readonly nonce = randomUUID();
  private sequence = 0;

  constructor(readonly orders: readonly ScenarioOrder[]) {
    this.orderIds = orders.map(() => randomUUID());
    this.orderStates = orders.map(() => 'AWAITING_PAYMENT');
  }

  /** Księgowanie dla zdarzenia albo undefined, gdy zdarzenie nie pasuje do stanu. */
  posting(action: ScenarioAction): LedgerPosting | undefined {
    const idempotencyKey = `scenario:${this.nonce}:${(this.sequence += 1)}`;
    const pln = (value: number) => money(value);
    switch (action.kind) {
      case 'pay':
      case 'complete':
      case 'refund':
      case 'not-picked-up':
      case 'partial-refund': {
        const state = this.orderStates[action.order];
        const scenarioOrder = this.orders[action.order];
        const orderId = this.orderIds[action.order];
        if (scenarioOrder === undefined || orderId === undefined) {
          return undefined;
        }
        const sellerId = this.sellerId(scenarioOrder.seller);
        const { amounts } = scenarioOrder;
        const total =
          amounts.itemsTotal.amount + amounts.pokFee.amount + amounts.shippingFee.amount;
        if (action.kind === 'pay') {
          return state === 'AWAITING_PAYMENT'
            ? {
                type: 'PAYMENT_RECEIVED',
                idempotencyKey,
                orderId,
                sellerId,
                provider: this.provider,
                amount: pln(total),
                sellerAmount: amounts.itemsTotal,
              }
            : undefined;
        }
        if (state !== 'PAID') {
          return undefined;
        }
        if (action.kind === 'complete') {
          return { type: 'ORDER_COMPLETED', idempotencyKey, orderId, sellerId, amounts };
        }
        if (action.kind === 'refund') {
          return {
            type: 'ORDER_REFUNDED',
            idempotencyKey,
            orderId,
            provider: this.provider,
            amount: pln(total),
            reason: 'NOT_SHIPPED',
          };
        }
        if (action.kind === 'not-picked-up') {
          return {
            type: 'NOT_PICKED_UP_REFUNDED',
            idempotencyKey,
            orderId,
            provider: this.provider,
            amounts,
          };
        }
        return {
          type: 'ORDER_PARTIALLY_REFUNDED',
          idempotencyKey,
          orderId,
          sellerId,
          provider: this.provider,
          amounts,
          refund: pln(Math.max(1, Math.floor((amounts.itemsTotal.amount * action.percent) / 100))),
        };
      }
      case 'dispute-costs':
        return {
          type: 'DISPUTE_COSTS_CHARGED',
          idempotencyKey,
          orderId: this.anyOrderId(),
          sellerId: this.sellerId(action.seller),
          amount: pln(action.amount),
        };
      case 'payout':
        return {
          type: 'PAYOUT_REQUESTED',
          idempotencyKey,
          payoutId: randomUUID(),
          sellerId: this.sellerId(action.seller),
          amount: pln(action.amount),
        };
      case 'payout-result': {
        const payout = this.payouts.filter((candidate) => candidate.open)[action.payout];
        if (payout === undefined) {
          return undefined;
        }
        const common = {
          idempotencyKey,
          payoutId: payout.id,
          sellerId: this.sellerId(payout.seller),
          amount: pln(payout.amount),
        };
        return action.paid
          ? { type: 'PAYOUT_COMPLETED', ...common, provider: this.provider }
          : { type: 'PAYOUT_FAILED', ...common };
      }
      case 'compensation':
        return {
          type: 'PARCEL_COMPENSATION_PAID',
          idempotencyKey,
          orderId: this.anyOrderId(),
          sellerId: this.sellerId(action.seller),
          amount: pln(action.amount),
          channel: action.toBalance ? 'SELLER_BALANCE' : 'EXTERNAL_TRANSFER',
        };
      case 'claim-settled':
        return action.recovered + action.unrecovered === 0
          ? undefined
          : {
              type: 'CARRIER_CLAIM_SETTLED',
              idempotencyKey,
              orderId: this.anyOrderId(),
              recovered: pln(action.recovered),
              unrecovered: pln(action.unrecovered),
            };
      case 'write-off':
        return {
          type: 'RECEIVABLE_WRITTEN_OFF',
          idempotencyKey,
          sellerId: this.sellerId(action.seller),
          amount: pln(action.amount),
        };
      case 'chargeback-absorbed':
        return {
          type: 'CHARGEBACK_ABSORBED',
          idempotencyKey,
          orderId: this.anyOrderId(),
          provider: this.provider,
          amount: pln(action.amount),
        };
      case 'chargeback-to-seller':
        return {
          type: 'CHARGEBACK_CHARGED_TO_SELLER',
          idempotencyKey,
          orderId: this.anyOrderId(),
          sellerId: this.sellerId(action.seller),
          provider: this.provider,
          amount: pln(action.amount),
        };
      case 'fee':
        return {
          type: 'PAYMENT_FEE_CHARGED',
          idempotencyKey,
          provider: this.provider,
          amount: pln(action.amount),
        };
    }
  }

  /** Zapamiętuje skutek przyjętego księgowania: stan zamówienia albo otwartą wypłatę. */
  accepted(posting: LedgerPosting): void {
    if (posting.type === 'PAYMENT_RECEIVED') {
      this.setOrderState(posting.orderId, 'PAID');
    } else if (
      posting.type === 'ORDER_COMPLETED' ||
      posting.type === 'ORDER_REFUNDED' ||
      posting.type === 'NOT_PICKED_UP_REFUNDED' ||
      posting.type === 'ORDER_PARTIALLY_REFUNDED'
    ) {
      this.setOrderState(posting.orderId, 'CLOSED');
    } else if (posting.type === 'PAYOUT_REQUESTED') {
      this.payouts.push({
        id: posting.payoutId,
        seller: this.sellerIds.indexOf(posting.sellerId),
        amount: posting.amount.amount,
        open: true,
      });
    } else if (posting.type === 'PAYOUT_COMPLETED' || posting.type === 'PAYOUT_FAILED') {
      const payout = this.payouts.find((candidate) => candidate.id === posting.payoutId);
      if (payout !== undefined) {
        payout.open = false;
      }
    }
  }

  sellerId(index: number): string {
    const id = this.sellerIds[index];
    if (id === undefined) {
      throw new Error(`Brak sprzedającego ${index} w scenariuszu`);
    }
    return id;
  }

  private anyOrderId(): string {
    const [id] = this.orderIds;
    if (id === undefined) {
      throw new Error('Scenariusz bez zamówień');
    }
    return id;
  }

  private setOrderState(orderId: string, state: ScenarioOrderState): void {
    this.orderStates[this.orderIds.indexOf(orderId)] = state;
  }
}

/** Czy błąd to odrzucenie z braku środków (oczekiwany wynik części losowych zdarzeń). */
export function isInsufficientFunds(error: unknown): boolean {
  return error instanceof LedgerError && error.code === 'INSUFFICIENT_FUNDS';
}

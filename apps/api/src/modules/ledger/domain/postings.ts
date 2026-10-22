// Szablony księgowań (PROJECT.md §7.7, §7.9): zdarzenie biznesowe z kwotami → wpisy podwójnego
// zapisu. Inne moduły nie podają wpisów same, tylko zdarzenie (`LedgerPosting`), więc każde
// księgowanie bilansuje się do zera i stosuje te same reguły sald sprzedającego:
// - uznanie sprzedającego najpierw spłaca `seller_receivable`, reszta trafia na saldo dostępne,
// - obciążenie sprzedającego bierze z salda dostępnego najwyżej tyle, ile na nim jest, a niedobór
//   trafia na `seller_receivable`.
//
// Funkcje są czyste (bez bazy): LedgerService blokuje konta z `plan.accounts`, liczy wpisy na
// zablokowanych saldach i zapisuje je; testy liczą to samo w pamięci.
import { type CurrencyCode, formatMoney, isMoney, type Money, money } from '@biddy/shared';

import {
  accountKey,
  accountLabel,
  compareAccounts,
  LEDGER_ACCOUNTS,
  type LedgerAccountCode,
  type LedgerAccountRef,
  normalBalance,
} from './accounts.js';
import { LedgerError } from './ledger-error.js';
import type { LedgerTransactionType } from './transaction-types.js';

/** Kwoty zamówienia (kolumny `orders`): cena, POK brutto z VAT i dostawa. */
export interface OrderAmounts {
  /** Cena: suma wylicytowanych kwot (`items_total`). */
  readonly itemsTotal: Money;
  /** Pakiet Ochrony Kupujących brutto (`pok_fee`) i jego VAT (`pok_vat`, F-13). */
  readonly pokFee: Money;
  readonly pokVat: Money;
  /** Dostawa zapłacona przez kupującego; 0, gdy zamówienie jej nie ma. */
  readonly shippingFee: Money;
}

/** Powód pełnego zwrotu (zwrot nieodebranej przesyłki ma osobny szablon). */
export const FULL_REFUND_REASONS = [
  'NOT_SHIPPED',
  'LOST',
  'DISPUTE',
  'LATE_PAYMENT',
  'CHARGEBACK',
] as const;
export type FullRefundReason = (typeof FULL_REFUND_REASONS)[number];

/** Jak Biddy wypłaca rekompensatę za zaginioną lub uszkodzoną paczkę (§7.9). */
export type CompensationChannel = 'SELLER_BALANCE' | 'EXTERNAL_TRANSFER';

interface PostingBase {
  /** Klucz księgowania, np. `order:{orderId}:completed`: ponowienie nie dubluje wpisów. */
  readonly idempotencyKey: string;
}

/** Płatność udana: D `provider_cash` · C `buyer_funds_held`. */
export interface PaymentReceived extends PostingBase {
  readonly type: 'PAYMENT_RECEIVED';
  readonly orderId: string;
  readonly sellerId: string;
  /** Operator płatności (`provider_cash:{provider}`), np. `fake`, `payu`. */
  readonly provider: string;
  /** Cała wpłata kupującego. */
  readonly amount: Money;
  /** Część wpłaty dla sprzedającego (cena): z niej liczymy saldo „w trakcie”. */
  readonly sellerAmount: Money;
}

/** Zakończenie zamówienia: zwolnienie środków na saldo sprzedającego i przychody Biddy. */
export interface OrderCompleted extends PostingBase {
  readonly type: 'ORDER_COMPLETED';
  readonly orderId: string;
  readonly sellerId: string;
  readonly amounts: OrderAmounts;
}

/** Pełny zwrot wpłaty kupującemu z wstrzymanych środków. */
export interface OrderRefunded extends PostingBase {
  readonly type: 'ORDER_REFUNDED';
  readonly orderId: string;
  readonly provider: string;
  readonly amount: Money;
  readonly reason: FullRefundReason;
}

/** Zwrot nieodebranej przesyłki: cena i POK wracają do kupującego, dostawa zostaje (§7.4). */
export interface NotPickedUpRefunded extends PostingBase {
  readonly type: 'NOT_PICKED_UP_REFUNDED';
  readonly orderId: string;
  readonly provider: string;
  readonly amounts: OrderAmounts;
}

/** Zwrot częściowy z części sprzedającego, reszta jak przy zakończeniu (§7.5). */
export interface OrderPartiallyRefunded extends PostingBase {
  readonly type: 'ORDER_PARTIALLY_REFUNDED';
  readonly orderId: string;
  readonly sellerId: string;
  readonly provider: string;
  readonly amounts: OrderAmounts;
  /** Kwota zwrotu: więcej niż 0, najwyżej cena. */
  readonly refund: Money;
}

/** Zlecenie wypłaty z salda dostępnego. */
export interface PayoutRequested extends PostingBase {
  readonly type: 'PAYOUT_REQUESTED';
  readonly payoutId: string;
  readonly sellerId: string;
  readonly amount: Money;
}

/** Wypłata potwierdzona przez operatora. */
export interface PayoutCompleted extends PostingBase {
  readonly type: 'PAYOUT_COMPLETED';
  readonly payoutId: string;
  readonly sellerId: string;
  readonly provider: string;
  readonly amount: Money;
}

/** Wypłata nieudana: środki wracają do sprzedającego (najpierw spłata należności). */
export interface PayoutFailed extends PostingBase {
  readonly type: 'PAYOUT_FAILED';
  readonly payoutId: string;
  readonly sellerId: string;
  readonly amount: Money;
}

/** Opłata operatora płatności. */
export interface PaymentFeeCharged extends PostingBase {
  readonly type: 'PAYMENT_FEE_CHARGED';
  readonly provider: string;
  readonly amount: Money;
  /** Zamówienie, którego dotyczy opłata (brak przy opłacie zbiorczej z raportu). */
  readonly orderId?: string;
}

/** Koszty sporu po stronie sprzedającego, np. dostawa w obie strony (§7.5, §7.9). */
export interface DisputeCostsCharged extends PostingBase {
  readonly type: 'DISPUTE_COSTS_CHARGED';
  readonly orderId: string;
  readonly sellerId: string;
  readonly amount: Money;
}

/** Chargeback po zakończeniu zamówienia, koszt ponosi Biddy (§7.9). */
export interface ChargebackAbsorbed extends PostingBase {
  readonly type: 'CHARGEBACK_ABSORBED';
  readonly orderId: string;
  readonly provider: string;
  readonly amount: Money;
}

/** Chargeback po zakończeniu przy oszustwie sprzedającego: obciąża sprzedającego (§7.9). */
export interface ChargebackChargedToSeller extends PostingBase {
  readonly type: 'CHARGEBACK_CHARGED_TO_SELLER';
  readonly orderId: string;
  readonly sellerId: string;
  readonly provider: string;
  readonly amount: Money;
}

/** Rekompensata dla sprzedającego za zaginioną lub uszkodzoną paczkę (§7.9). */
export interface ParcelCompensationPaid extends PostingBase {
  readonly type: 'PARCEL_COMPENSATION_PAID';
  readonly orderId: string;
  readonly sellerId: string;
  readonly amount: Money;
  /** Na saldo w Biddy albo przelewem z rachunku firmowego (`platform_external`). */
  readonly channel: CompensationChannel;
}

/** Rozliczenie reklamacji u przewoźnika: odszkodowanie i nieodzyskana reszta (§7.9). */
export interface CarrierClaimSettled extends PostingBase {
  readonly type: 'CARRIER_CLAIM_SETTLED';
  readonly orderId: string;
  /** Odszkodowanie od przewoźnika (wpływa poza operatorem, `platform_external`). */
  readonly recovered: Money;
  /** Nieodzyskana część: strata Biddy. */
  readonly unrecovered: Money;
}

/** Spisanie nieodzyskanej należności od sprzedającego, np. po 180 dniach (§7.9). */
export interface ReceivableWrittenOff extends PostingBase {
  readonly type: 'RECEIVABLE_WRITTEN_OFF';
  readonly sellerId: string;
  readonly amount: Money;
}

/** Zdarzenie do zaksięgowania (`LedgerService.post`). Storno: `LedgerService.reverse`. */
export type LedgerPosting =
  | PaymentReceived
  | OrderCompleted
  | OrderRefunded
  | NotPickedUpRefunded
  | OrderPartiallyRefunded
  | PayoutRequested
  | PayoutCompleted
  | PayoutFailed
  | PaymentFeeCharged
  | DisputeCostsCharged
  | ChargebackAbsorbed
  | ChargebackChargedToSeller
  | ParcelCompensationPaid
  | CarrierClaimSettled
  | ReceivableWrittenOff;

/** Konto, którego może dotknąć księgowanie. */
export interface PlannedAccount extends LedgerAccountRef {
  /** Sprzedający konta (nowe konto, a istniejące musi się zgadzać); undefined = nie sprawdzamy. */
  readonly sellerId?: string;
  /** Tylko `buyer_funds_held` przy płatności: część sprzedającego w groszach. */
  readonly sellerAmount?: number;
  /** Księgowanie może założyć konto. Inaczej konto musi istnieć, bo księgowanie z niego zdejmuje. */
  readonly opens: boolean;
}

export interface PlannedEntry {
  readonly account: LedgerAccountRef;
  /** Kwota ze znakiem w groszach: + Winien (debet), − Ma (kredyt). */
  readonly amount: number;
}

/** Saldo konta ze znakiem (suma wpisów); 0 dla konta, którego jeszcze nie ma. */
export type BalanceLookup = (account: LedgerAccountRef) => number;

export interface PostingPlan {
  readonly type: Exclude<LedgerTransactionType, 'REVERSAL'>;
  readonly currency: CurrencyCode;
  readonly orderId: string | null;
  readonly payoutId: string | null;
  /** Dane wejściowe bez typu i klucza (JSON): audyt, eksport, porównanie przy ponowieniu. */
  readonly payload: Record<string, unknown>;
  /** Wszystkie konta, których może dotknąć księgowanie, bez powtórzeń, w stałej kolejności. */
  readonly accounts: readonly PlannedAccount[];
  /** Wpisy przy podanych saldach: bez zer, najwyżej jeden na konto, w kolejności kont. */
  entries(balanceOf: BalanceLookup): PlannedEntry[];
}

/**
 * Sprawdza dane księgowania i zwraca jego plan: konta do zablokowania i funkcję liczącą wpisy na
 * zablokowanych saldach (podział między saldo dostępne a należność sprzedającego zależy od sald).
 *
 * @throws {LedgerError} INVALID_POSTING
 */
export function planPosting(posting: LedgerPosting): PostingPlan {
  requireKey(posting.idempotencyKey);
  const payload = payloadOf(posting);
  switch (posting.type) {
    case 'PAYMENT_RECEIVED': {
      requireIds({ orderId: posting.orderId, sellerId: posting.sellerId });
      requireProvider(posting.provider);
      const currency = currencyOf({ amount: posting.amount, sellerAmount: posting.sellerAmount });
      requirePositive(posting.amount, 'amount');
      requireNonNegative(posting.sellerAmount, 'sellerAmount');
      if (posting.sellerAmount.amount > posting.amount.amount) {
        throw invalid('Część sprzedającego (sellerAmount) nie może przekraczać wpłaty (amount).');
      }
      const cash = providerCash(posting.provider, currency);
      const held = heldFunds(posting.orderId, currency);
      return plan(
        posting,
        payload,
        currency,
        { orderId: posting.orderId },
        [
          opens(cash),
          {
            ...held,
            sellerId: posting.sellerId,
            sellerAmount: posting.sellerAmount.amount,
            opens: true,
          },
        ],
        (draft) => {
          draft.debit(cash, posting.amount.amount);
          draft.credit(held, posting.amount.amount);
        },
      );
    }
    case 'ORDER_COMPLETED': {
      requireIds({ orderId: posting.orderId, sellerId: posting.sellerId });
      const amounts = orderAmounts(posting.amounts);
      const held = heldFunds(posting.orderId, amounts.currency);
      return plan(
        posting,
        payload,
        amounts.currency,
        { orderId: posting.orderId },
        [
          { ...held, sellerId: posting.sellerId, opens: false },
          ...sellerAccounts(posting.sellerId, amounts.currency),
          ...revenueAccounts(amounts.currency),
        ],
        (draft) => {
          draft.debit(held, amounts.total);
          draft.creditSeller(posting.sellerId, amounts.itemsTotal);
          draft.creditRevenue(amounts);
        },
      );
    }
    case 'ORDER_REFUNDED': {
      requireIds({ orderId: posting.orderId });
      requireProvider(posting.provider);
      if (!(FULL_REFUND_REASONS as readonly string[]).includes(posting.reason)) {
        throw invalid(`Nieznany powód zwrotu: ${String(posting.reason)}.`);
      }
      const currency = currencyOf({ amount: posting.amount });
      requirePositive(posting.amount, 'amount');
      const held = heldFunds(posting.orderId, currency);
      const cash = providerCash(posting.provider, currency);
      return plan(
        posting,
        payload,
        currency,
        { orderId: posting.orderId },
        [{ ...held, opens: false }, opens(cash)],
        (draft) => {
          draft.debit(held, posting.amount.amount);
          draft.credit(cash, posting.amount.amount);
        },
      );
    }
    case 'NOT_PICKED_UP_REFUNDED': {
      requireIds({ orderId: posting.orderId });
      requireProvider(posting.provider);
      const amounts = orderAmounts(posting.amounts);
      const held = heldFunds(posting.orderId, amounts.currency);
      const cash = providerCash(posting.provider, amounts.currency);
      const shipping = platformAccount('platform_shipping', amounts.currency);
      return plan(
        posting,
        payload,
        amounts.currency,
        { orderId: posting.orderId },
        [{ ...held, opens: false }, opens(cash), opens(shipping)],
        (draft) => {
          draft.debit(held, amounts.total);
          draft.credit(cash, amounts.total - amounts.shippingFee);
          draft.credit(shipping, amounts.shippingFee);
        },
      );
    }
    case 'ORDER_PARTIALLY_REFUNDED': {
      requireIds({ orderId: posting.orderId, sellerId: posting.sellerId });
      requireProvider(posting.provider);
      const amounts = orderAmounts(posting.amounts);
      currencyOf({ itemsTotal: posting.amounts.itemsTotal, refund: posting.refund });
      requirePositive(posting.refund, 'refund');
      if (posting.refund.amount > amounts.itemsTotal) {
        throw invalid('Zwrot częściowy nie może przekraczać ceny przedmiotu (PROJECT.md §7.5).');
      }
      const held = heldFunds(posting.orderId, amounts.currency);
      const cash = providerCash(posting.provider, amounts.currency);
      return plan(
        posting,
        payload,
        amounts.currency,
        { orderId: posting.orderId },
        [
          { ...held, sellerId: posting.sellerId, opens: false },
          opens(cash),
          ...sellerAccounts(posting.sellerId, amounts.currency),
          ...revenueAccounts(amounts.currency),
        ],
        (draft) => {
          draft.debit(held, amounts.total);
          draft.credit(cash, posting.refund.amount);
          draft.creditSeller(posting.sellerId, amounts.itemsTotal - posting.refund.amount);
          draft.creditRevenue(amounts);
        },
      );
    }
    case 'PAYOUT_REQUESTED': {
      requireIds({ payoutId: posting.payoutId, sellerId: posting.sellerId });
      const currency = currencyOf({ amount: posting.amount });
      requirePositive(posting.amount, 'amount');
      const available = sellerAvailable(posting.sellerId, currency);
      const inTransit = payoutInTransit(posting.payoutId, currency);
      return plan(
        posting,
        payload,
        currency,
        { payoutId: posting.payoutId },
        [opens(available, posting.sellerId), opens(inTransit, posting.sellerId)],
        (draft) => {
          draft.debit(available, posting.amount.amount);
          draft.credit(inTransit, posting.amount.amount);
        },
      );
    }
    case 'PAYOUT_COMPLETED': {
      requireIds({ payoutId: posting.payoutId, sellerId: posting.sellerId });
      requireProvider(posting.provider);
      const currency = currencyOf({ amount: posting.amount });
      requirePositive(posting.amount, 'amount');
      const inTransit = payoutInTransit(posting.payoutId, currency);
      const cash = providerCash(posting.provider, currency);
      return plan(
        posting,
        payload,
        currency,
        { payoutId: posting.payoutId },
        [{ ...inTransit, sellerId: posting.sellerId, opens: false }, opens(cash)],
        (draft) => {
          draft.debit(inTransit, posting.amount.amount);
          draft.credit(cash, posting.amount.amount);
        },
      );
    }
    case 'PAYOUT_FAILED': {
      requireIds({ payoutId: posting.payoutId, sellerId: posting.sellerId });
      const currency = currencyOf({ amount: posting.amount });
      requirePositive(posting.amount, 'amount');
      const inTransit = payoutInTransit(posting.payoutId, currency);
      return plan(
        posting,
        payload,
        currency,
        { payoutId: posting.payoutId },
        [
          { ...inTransit, sellerId: posting.sellerId, opens: false },
          ...sellerAccounts(posting.sellerId, currency),
        ],
        (draft) => {
          draft.debit(inTransit, posting.amount.amount);
          draft.creditSeller(posting.sellerId, posting.amount.amount);
        },
      );
    }
    case 'PAYMENT_FEE_CHARGED': {
      if (posting.orderId !== undefined) {
        requireIds({ orderId: posting.orderId });
      }
      requireProvider(posting.provider);
      const currency = currencyOf({ amount: posting.amount });
      requirePositive(posting.amount, 'amount');
      const fees = platformAccount('payment_fees_expense', currency);
      const cash = providerCash(posting.provider, currency);
      return plan(
        posting,
        payload,
        currency,
        { orderId: posting.orderId ?? null },
        [opens(fees), opens(cash)],
        (draft) => {
          draft.debit(fees, posting.amount.amount);
          draft.credit(cash, posting.amount.amount);
        },
      );
    }
    case 'DISPUTE_COSTS_CHARGED': {
      requireIds({ orderId: posting.orderId, sellerId: posting.sellerId });
      const currency = currencyOf({ amount: posting.amount });
      requirePositive(posting.amount, 'amount');
      const shipping = platformAccount('platform_shipping', currency);
      return plan(
        posting,
        payload,
        currency,
        { orderId: posting.orderId },
        [...sellerAccounts(posting.sellerId, currency), opens(shipping)],
        (draft) => {
          draft.chargeSeller(posting.sellerId, posting.amount.amount);
          draft.credit(shipping, posting.amount.amount);
        },
      );
    }
    case 'CHARGEBACK_ABSORBED': {
      requireIds({ orderId: posting.orderId });
      requireProvider(posting.provider);
      const currency = currencyOf({ amount: posting.amount });
      requirePositive(posting.amount, 'amount');
      const losses = platformAccount('platform_losses', currency);
      const cash = providerCash(posting.provider, currency);
      return plan(
        posting,
        payload,
        currency,
        { orderId: posting.orderId },
        [opens(losses), opens(cash)],
        (draft) => {
          draft.debit(losses, posting.amount.amount);
          draft.credit(cash, posting.amount.amount);
        },
      );
    }
    case 'CHARGEBACK_CHARGED_TO_SELLER': {
      requireIds({ orderId: posting.orderId, sellerId: posting.sellerId });
      requireProvider(posting.provider);
      const currency = currencyOf({ amount: posting.amount });
      requirePositive(posting.amount, 'amount');
      const cash = providerCash(posting.provider, currency);
      return plan(
        posting,
        payload,
        currency,
        { orderId: posting.orderId },
        [...sellerAccounts(posting.sellerId, currency), opens(cash)],
        (draft) => {
          draft.chargeSeller(posting.sellerId, posting.amount.amount);
          draft.credit(cash, posting.amount.amount);
        },
      );
    }
    case 'PARCEL_COMPENSATION_PAID': {
      requireIds({ orderId: posting.orderId, sellerId: posting.sellerId });
      if (posting.channel !== 'SELLER_BALANCE' && posting.channel !== 'EXTERNAL_TRANSFER') {
        throw invalid(`Nieznany sposób wypłaty rekompensaty: ${String(posting.channel)}.`);
      }
      const currency = currencyOf({ amount: posting.amount });
      requirePositive(posting.amount, 'amount');
      const claims = platformAccount('carrier_claims_receivable', currency);
      const external = platformAccount('platform_external', currency);
      const toBalance = posting.channel === 'SELLER_BALANCE';
      return plan(
        posting,
        payload,
        currency,
        { orderId: posting.orderId },
        [
          opens(claims),
          ...(toBalance ? sellerAccounts(posting.sellerId, currency) : [opens(external)]),
        ],
        (draft) => {
          draft.debit(claims, posting.amount.amount);
          if (toBalance) {
            draft.creditSeller(posting.sellerId, posting.amount.amount);
          } else {
            draft.credit(external, posting.amount.amount);
          }
        },
      );
    }
    case 'CARRIER_CLAIM_SETTLED': {
      requireIds({ orderId: posting.orderId });
      const currency = currencyOf({
        recovered: posting.recovered,
        unrecovered: posting.unrecovered,
      });
      requireNonNegative(posting.recovered, 'recovered');
      requireNonNegative(posting.unrecovered, 'unrecovered');
      const settled = posting.recovered.amount + posting.unrecovered.amount;
      if (settled === 0) {
        throw invalid('Rozliczenie reklamacji wymaga kwoty odzyskanej albo nieodzyskanej.');
      }
      const claims = platformAccount('carrier_claims_receivable', currency);
      const external = platformAccount('platform_external', currency);
      const losses = platformAccount('platform_losses', currency);
      return plan(
        posting,
        payload,
        currency,
        { orderId: posting.orderId },
        [opens(claims), opens(external), opens(losses)],
        (draft) => {
          draft.debit(external, posting.recovered.amount);
          draft.debit(losses, posting.unrecovered.amount);
          draft.credit(claims, settled);
        },
      );
    }
    case 'RECEIVABLE_WRITTEN_OFF': {
      requireIds({ sellerId: posting.sellerId });
      const currency = currencyOf({ amount: posting.amount });
      requirePositive(posting.amount, 'amount');
      const losses = platformAccount('platform_losses', currency);
      const receivable = sellerReceivable(posting.sellerId, currency);
      return plan(
        posting,
        payload,
        currency,
        {},
        [opens(losses), opens(receivable, posting.sellerId)],
        (draft) => {
          draft.debit(losses, posting.amount.amount);
          draft.credit(receivable, posting.amount.amount);
        },
      );
    }
    default: {
      const unknown: never = posting;
      throw invalid(`Nieznany typ księgowania: ${String((unknown as { type: unknown }).type)}.`);
    }
  }
}

/**
 * Sprawdza, że po wpisach żadne konto z ograniczeniem nie ma salda po złej stronie (np. saldo
 * dostępne < 0, wypłata ponad środki). Tę samą regułę wymusza CHECK w bazie.
 *
 * @throws {LedgerError} INSUFFICIENT_FUNDS
 */
export function assertAllowedBalances(
  entries: readonly PlannedEntry[],
  balanceOf: BalanceLookup,
): void {
  for (const entry of entries) {
    const { code, currency } = entry.account;
    if (!LEDGER_ACCOUNTS[code].nonNegative) {
      continue;
    }
    const before = balanceOf(entry.account);
    if (normalBalance(code, before + entry.amount) < 0) {
      throw new LedgerError(
        'INSUFFICIENT_FUNDS',
        `Za mało środków na koncie ${accountLabel(entry.account)}: saldo ` +
          `${formatMoney(money(normalBalance(code, before), currency))}, księgowanie zdejmuje ` +
          `${formatMoney(money(-normalBalance(code, entry.amount), currency))}.`,
      );
    }
  }
}

/** Zapisane atrybuty konta, porównywane z planem księgowania. */
export interface StoredAccountAttributes {
  readonly sellerId: string | null;
  readonly sellerAmount: number | null;
}

/** @throws {LedgerError} ACCOUNT_MISMATCH, gdy istniejące konto ma innego sprzedającego lub część */
export function assertAccountMatches(
  planned: PlannedAccount,
  stored: StoredAccountAttributes,
): void {
  if (planned.sellerId !== undefined && planned.sellerId !== stored.sellerId) {
    throw new LedgerError(
      'ACCOUNT_MISMATCH',
      `Konto ${accountLabel(planned)} dotyczy sprzedającego ${String(stored.sellerId)}, a księgowanie podaje ${planned.sellerId}.`,
    );
  }
  if (planned.sellerAmount !== undefined && planned.sellerAmount !== stored.sellerAmount) {
    throw new LedgerError(
      'ACCOUNT_MISMATCH',
      `Konto ${accountLabel(planned)} ma część sprzedającego ${String(stored.sellerAmount)} gr, a księgowanie podaje ${planned.sellerAmount} gr.`,
    );
  }
}

/** Wpisy storna: te same konta z przeciwnym znakiem. */
export function reversalEntries(entries: readonly PlannedEntry[]): PlannedEntry[] {
  return entries.map((entry) => ({ account: entry.account, amount: -entry.amount }));
}

// --- Budowanie planu i wpisów ---

/** Szkic wpisów jednego księgowania: sumuje kwoty per konto i zna salda po dotychczasowych wpisach. */
class EntriesDraft {
  private readonly amounts = new Map<string, { account: LedgerAccountRef; amount: number }>();

  constructor(
    private readonly currency: CurrencyCode,
    private readonly balanceOf: BalanceLookup,
  ) {}

  debit(account: LedgerAccountRef, amount: number): void {
    this.add(account, amount);
  }

  credit(account: LedgerAccountRef, amount: number): void {
    this.add(account, -amount);
  }

  /** Uznanie sprzedającego: najpierw spłata należności, reszta na saldo dostępne. */
  creditSeller(sellerId: string, amount: number): void {
    const receivable = sellerReceivable(sellerId, this.currency);
    const repayment = Math.min(Math.max(this.normal(receivable), 0), amount);
    this.credit(receivable, repayment);
    this.credit(sellerAvailable(sellerId, this.currency), amount - repayment);
  }

  /** Obciążenie sprzedającego: z salda dostępnego do jego wysokości, niedobór jako należność. */
  chargeSeller(sellerId: string, amount: number): void {
    const available = sellerAvailable(sellerId, this.currency);
    const fromBalance = Math.min(Math.max(this.normal(available), 0), amount);
    this.debit(available, fromBalance);
    this.debit(sellerReceivable(sellerId, this.currency), amount - fromBalance);
  }

  /** POK netto, VAT od POK i dostawa jako przychody Biddy (zakończenie, zwrot częściowy). */
  creditRevenue(amounts: ValidOrderAmounts): void {
    this.credit(platformAccount('platform_revenue_pok', this.currency), amounts.pokNet);
    this.credit(platformAccount('vat_payable', this.currency), amounts.pokVat);
    this.credit(platformAccount('platform_shipping', this.currency), amounts.shippingFee);
  }

  entries(): PlannedEntry[] {
    return [...this.amounts.values()]
      .filter((entry) => entry.amount !== 0)
      .sort((a, b) => compareAccounts(a.account, b.account));
  }

  private normal(account: LedgerAccountRef): number {
    const pending = this.amounts.get(accountKey(account))?.amount ?? 0;
    return normalBalance(account.code, this.balanceOf(account) + pending);
  }

  private add(account: LedgerAccountRef, amount: number): void {
    const key = accountKey(account);
    const current = this.amounts.get(key);
    this.amounts.set(key, { account, amount: (current?.amount ?? 0) + amount });
  }
}

function plan(
  posting: LedgerPosting,
  payload: Record<string, unknown>,
  currency: CurrencyCode,
  references: { readonly orderId?: string | null; readonly payoutId?: string },
  accounts: readonly PlannedAccount[],
  build: (draft: EntriesDraft) => void,
): PostingPlan {
  const unique = new Map<string, PlannedAccount>();
  for (const account of accounts) {
    unique.set(accountKey(account), account);
  }
  const planned = [...unique.values()].sort(compareAccounts);
  return {
    type: posting.type,
    currency,
    orderId: references.orderId ?? null,
    payoutId: references.payoutId ?? null,
    payload,
    accounts: planned,
    entries(balanceOf) {
      const draft = new EntriesDraft(currency, balanceOf);
      build(draft);
      const entries = draft.entries();
      if (entries.length === 0) {
        throw invalid('Księgowanie nie przenosi żadnej kwoty.');
      }
      const outside = entries.find((entry) => !unique.has(accountKey(entry.account)));
      if (outside !== undefined) {
        throw new Error(`Wpis na koncie spoza planu księgowania: ${accountLabel(outside.account)}`);
      }
      return entries;
    },
  };
}

function payloadOf(posting: LedgerPosting): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...posting };
  delete payload['type'];
  delete payload['idempotencyKey'];
  // Postać JSON (bez pól undefined), taka sama jak po odczycie z kolumny jsonb.
  return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
}

// --- Konta ---

function providerCash(provider: string, currency: CurrencyCode): LedgerAccountRef {
  return { code: 'provider_cash', subject: provider, currency };
}

function heldFunds(orderId: string, currency: CurrencyCode): LedgerAccountRef {
  return { code: 'buyer_funds_held', subject: orderId, currency };
}

function sellerAvailable(sellerId: string, currency: CurrencyCode): LedgerAccountRef {
  return { code: 'seller_balance_available', subject: sellerId, currency };
}

function sellerReceivable(sellerId: string, currency: CurrencyCode): LedgerAccountRef {
  return { code: 'seller_receivable', subject: sellerId, currency };
}

function payoutInTransit(payoutId: string, currency: CurrencyCode): LedgerAccountRef {
  return { code: 'payouts_in_transit', subject: payoutId, currency };
}

function platformAccount(code: LedgerAccountCode, currency: CurrencyCode): LedgerAccountRef {
  return { code, subject: null, currency };
}

function opens(account: LedgerAccountRef, sellerId?: string): PlannedAccount {
  return sellerId === undefined
    ? { ...account, opens: true }
    : { ...account, sellerId, opens: true };
}

function sellerAccounts(sellerId: string, currency: CurrencyCode): PlannedAccount[] {
  return [
    opens(sellerAvailable(sellerId, currency), sellerId),
    opens(sellerReceivable(sellerId, currency), sellerId),
  ];
}

function revenueAccounts(currency: CurrencyCode): PlannedAccount[] {
  return [
    opens(platformAccount('platform_revenue_pok', currency)),
    opens(platformAccount('vat_payable', currency)),
    opens(platformAccount('platform_shipping', currency)),
  ];
}

// --- Walidacja ---

/** UUID małymi literami (tak zapisuje je Postgres, a parametr konta musi być równy `seller_id`). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Nazwa operatora płatności, np. `fake`, `payu`. */
const PROVIDER_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

interface ValidOrderAmounts {
  readonly currency: CurrencyCode;
  readonly itemsTotal: number;
  readonly pokNet: number;
  readonly pokVat: number;
  readonly shippingFee: number;
  readonly total: number;
}

function orderAmounts(amounts: OrderAmounts): ValidOrderAmounts {
  const currency = currencyOf({ ...amounts });
  for (const [field, value] of Object.entries(amounts) as [string, Money][]) {
    requireNonNegative(value, `amounts.${field}`);
  }
  if (amounts.pokVat.amount > amounts.pokFee.amount) {
    throw invalid('VAT od POK (pokVat) nie może przekraczać POK brutto (pokFee).');
  }
  const total = amounts.itemsTotal.amount + amounts.pokFee.amount + amounts.shippingFee.amount;
  if (total === 0) {
    throw invalid('Zamówienie bez kwot nie ma czego księgować.');
  }
  return {
    currency,
    itemsTotal: amounts.itemsTotal.amount,
    pokNet: amounts.pokFee.amount - amounts.pokVat.amount,
    pokVat: amounts.pokVat.amount,
    shippingFee: amounts.shippingFee.amount,
    total,
  };
}

function currencyOf(amounts: Readonly<Record<string, Money>>): CurrencyCode {
  const currencies = new Set<CurrencyCode>();
  for (const [field, value] of Object.entries(amounts)) {
    if (!isMoney(value)) {
      throw invalid(`Pole ${field} nie jest poprawną kwotą w groszach.`);
    }
    currencies.add(value.currency);
  }
  const [currency, ...others] = currencies;
  if (currency === undefined) {
    throw new Error('Księgowanie bez kwot');
  }
  if (others.length > 0) {
    throw invalid(`Kwoty księgowania muszą być w jednej walucie (${[...currencies].join(', ')}).`);
  }
  return currency;
}

function requirePositive(value: Money, field: string): void {
  if (value.amount <= 0) {
    throw invalid(`Kwota ${field} musi być większa od zera.`);
  }
}

function requireNonNegative(value: Money, field: string): void {
  if (value.amount < 0) {
    throw invalid(`Kwota ${field} nie może być ujemna.`);
  }
}

function requireIds(ids: Readonly<Record<string, string>>): void {
  for (const [field, value] of Object.entries(ids)) {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
      throw invalid(`Pole ${field} musi być identyfikatorem UUID (małe litery).`);
    }
  }
}

function requireProvider(provider: string): void {
  if (typeof provider !== 'string' || !PROVIDER_PATTERN.test(provider)) {
    throw invalid(`Nieprawidłowa nazwa operatora płatności: ${String(provider)}.`);
  }
}

function requireKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw invalid(`Klucz księgowania musi mieć od 1 do ${MAX_IDEMPOTENCY_KEY_LENGTH} znaków.`);
  }
}

function invalid(message: string): LedgerError {
  return new LedgerError('INVALID_POSTING', message);
}

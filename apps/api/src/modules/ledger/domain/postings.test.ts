// Szablony księgowań z PROJECT.md §7.7 i §7.9 na przykładzie z §7.4: przedmiot 100 zł, POK
// 9,99 zł (8,12 zł netto + 1,87 zł VAT), dostawa 12,99 zł, razem 122,98 zł. Salda i wpisy ze
// znakiem: + Winien, − Ma (saldo dostępne 50 zł to −5000 gr na koncie zobowiązania).
import { type Money, money } from '@biddy/shared';
import { describe, expect, it } from 'vitest';

import { accountLabel } from './accounts.js';
import { LedgerError } from './ledger-error.js';
import {
  assertAccountMatches,
  assertAllowedBalances,
  type LedgerPosting,
  type OrderAmounts,
  planPosting,
  reversalEntries,
} from './postings.js';

const SELLER = '019a2b3c-0000-7000-8000-000000000001';
const ORDER = '019a2b3c-0000-7000-8000-000000000002';
const PAYOUT = '019a2b3c-0000-7000-8000-000000000003';

const AVAILABLE = `seller_balance_available:${SELLER}`;
const RECEIVABLE = `seller_receivable:${SELLER}`;
const HELD = `buyer_funds_held:${ORDER}`;
const IN_TRANSIT = `payouts_in_transit:${PAYOUT}`;

const AMOUNTS: OrderAmounts = {
  itemsTotal: money(10_000),
  pokFee: money(999),
  pokVat: money(187),
  shippingFee: money(1_299),
};
const TOTAL = 12_298;

/**
 * Wpisy księgowania przy podanych saldach (ze znakiem, po nazwie konta), po sprawdzeniu
 * ograniczeń sald i bilansu.
 */
function entriesOf(
  posting: LedgerPosting,
  balances: Readonly<Record<string, number>> = {},
): Record<string, number> {
  const plan = planPosting(posting);
  const balanceOf = (account: Parameters<typeof accountLabel>[0]) =>
    balances[accountLabel(account)] ?? 0;
  const entries = plan.entries(balanceOf);
  assertAllowedBalances(entries, balanceOf);
  expect(entries.reduce((total, entry) => total + entry.amount, 0)).toBe(0);
  return Object.fromEntries(entries.map((entry) => [accountLabel(entry.account), entry.amount]));
}

function failure(run: () => unknown): LedgerError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(LedgerError);
    return error as LedgerError;
  }
  throw new Error('oczekiwano błędu LedgerError');
}

const paid = { [HELD]: -TOTAL };

describe('płatność udana (PAYMENT_RECEIVED)', () => {
  const posting: LedgerPosting = {
    type: 'PAYMENT_RECEIVED',
    idempotencyKey: `payment:${ORDER}:1`,
    orderId: ORDER,
    sellerId: SELLER,
    provider: 'fake',
    amount: money(TOTAL),
    sellerAmount: money(10_000),
  };

  it('D provider_cash · C buyer_funds_held, cała wpłata', () => {
    expect(entriesOf(posting)).toEqual({ 'provider_cash:fake': TOTAL, [HELD]: -TOTAL });
  });

  it('konto środków zamówienia powstaje ze sprzedającym i jego częścią (saldo „w trakcie”)', () => {
    const plan = planPosting(posting);
    expect(plan.accounts.find((account) => account.code === 'buyer_funds_held')).toEqual({
      code: 'buyer_funds_held',
      subject: ORDER,
      currency: 'PLN',
      sellerId: SELLER,
      sellerAmount: 10_000,
      opens: true,
    });
    expect(plan).toMatchObject({ type: 'PAYMENT_RECEIVED', orderId: ORDER, payoutId: null });
  });

  it('dane wejściowe bez typu i klucza jako JSON (audyt, porównanie przy ponowieniu)', () => {
    expect(planPosting(posting).payload).toEqual({
      orderId: ORDER,
      sellerId: SELLER,
      provider: 'fake',
      amount: { amount: TOTAL, currency: 'PLN' },
      sellerAmount: { amount: 10_000, currency: 'PLN' },
    });
  });

  it('część sprzedającego większa niż wpłata: INVALID_POSTING', () => {
    const error = failure(() => planPosting({ ...posting, sellerAmount: money(TOTAL + 1) }));
    expect(error.code).toBe('INVALID_POSTING');
  });
});

describe('zakończenie (ORDER_COMPLETED)', () => {
  const posting: LedgerPosting = {
    type: 'ORDER_COMPLETED',
    idempotencyKey: `order:${ORDER}:completed`,
    orderId: ORDER,
    sellerId: SELLER,
    amounts: AMOUNTS,
  };

  it('cena na saldo dostępne, POK netto i VAT, dostawa jako przychody', () => {
    expect(entriesOf(posting, paid)).toEqual({
      [HELD]: TOTAL,
      [AVAILABLE]: -10_000,
      platform_revenue_pok: -812,
      vat_payable: -187,
      platform_shipping: -1_299,
    });
  });

  it('najpierw spłata należności sprzedającego, reszta na saldo dostępne', () => {
    expect(entriesOf(posting, { ...paid, [RECEIVABLE]: 3_000 })).toMatchObject({
      [RECEIVABLE]: -3_000,
      [AVAILABLE]: -7_000,
    });
  });

  it('należność większa niż cena: cała cena spłaca należność, saldo dostępne bez zmian', () => {
    const entries = entriesOf(posting, { ...paid, [RECEIVABLE]: 15_000 });
    expect(entries[RECEIVABLE]).toBe(-10_000);
    expect(entries).not.toHaveProperty(AVAILABLE);
  });

  it('bez dostawy: brak wpisu na platform_shipping (wpisów z kwotą 0 nie ma)', () => {
    const entries = entriesOf(
      { ...posting, amounts: { ...AMOUNTS, shippingFee: money(0) } },
      { [HELD]: -10_999 },
    );
    expect(entries).toEqual({
      [HELD]: 10_999,
      [AVAILABLE]: -10_000,
      platform_revenue_pok: -812,
      vat_payable: -187,
    });
  });

  it('bez wstrzymanych środków: INSUFFICIENT_FUNDS', () => {
    expect(failure(() => entriesOf(posting)).code).toBe('INSUFFICIENT_FUNDS');
  });

  it('VAT większy niż POK albo kwota ujemna: INVALID_POSTING', () => {
    expect(
      failure(() => planPosting({ ...posting, amounts: { ...AMOUNTS, pokVat: money(1_000) } }))
        .code,
    ).toBe('INVALID_POSTING');
    expect(
      failure(() => planPosting({ ...posting, amounts: { ...AMOUNTS, shippingFee: money(-1) } }))
        .code,
    ).toBe('INVALID_POSTING');
  });
});

describe('pełny zwrot (ORDER_REFUNDED)', () => {
  it('D buyer_funds_held · C provider_cash', () => {
    expect(
      entriesOf(
        {
          type: 'ORDER_REFUNDED',
          idempotencyKey: `order:${ORDER}:refund`,
          orderId: ORDER,
          provider: 'fake',
          amount: money(TOTAL),
          reason: 'NOT_SHIPPED',
        },
        paid,
      ),
    ).toEqual({ [HELD]: TOTAL, 'provider_cash:fake': -TOTAL });
  });

  it('zwrot ponad wstrzymane środki: INSUFFICIENT_FUNDS', () => {
    const error = failure(() =>
      entriesOf(
        {
          type: 'ORDER_REFUNDED',
          idempotencyKey: `order:${ORDER}:refund`,
          orderId: ORDER,
          provider: 'fake',
          amount: money(TOTAL + 1),
          reason: 'LOST',
        },
        paid,
      ),
    );
    expect(error.code).toBe('INSUFFICIENT_FUNDS');
    expect(error.message).toContain(HELD);
  });
});

describe('zwrot nieodebranej (NOT_PICKED_UP_REFUNDED)', () => {
  it('kupujący dostaje cenę i POK (109,99 zł), dostawa zostaje jako przychód (§7.4)', () => {
    expect(
      entriesOf(
        {
          type: 'NOT_PICKED_UP_REFUNDED',
          idempotencyKey: `order:${ORDER}:not-picked-up`,
          orderId: ORDER,
          provider: 'fake',
          amounts: AMOUNTS,
        },
        paid,
      ),
    ).toEqual({ [HELD]: TOTAL, 'provider_cash:fake': -10_999, platform_shipping: -1_299 });
  });
});

describe('zwrot częściowy (ORDER_PARTIALLY_REFUNDED)', () => {
  const posting = (refund: Money): LedgerPosting => ({
    type: 'ORDER_PARTIALLY_REFUNDED',
    idempotencyKey: `order:${ORDER}:partial-refund`,
    orderId: ORDER,
    sellerId: SELLER,
    provider: 'fake',
    amounts: AMOUNTS,
    refund,
  });

  it('zwrot z części sprzedającego, POK i dostawa bez zwrotu (§7.5)', () => {
    expect(entriesOf(posting(money(3_000)), paid)).toEqual({
      [HELD]: TOTAL,
      'provider_cash:fake': -3_000,
      [AVAILABLE]: -7_000,
      platform_revenue_pok: -812,
      vat_payable: -187,
      platform_shipping: -1_299,
    });
  });

  it('zwrot równy cenie: sprzedający nie dostaje nic', () => {
    const entries = entriesOf(posting(money(10_000)), paid);
    expect(entries['provider_cash:fake']).toBe(-10_000);
    expect(entries).not.toHaveProperty(AVAILABLE);
  });

  it('zwrot ponad cenę albo zerowy: INVALID_POSTING', () => {
    expect(failure(() => planPosting(posting(money(10_001)))).code).toBe('INVALID_POSTING');
    expect(failure(() => planPosting(posting(money(0)))).code).toBe('INVALID_POSTING');
  });
});

describe('wypłaty', () => {
  const requested: LedgerPosting = {
    type: 'PAYOUT_REQUESTED',
    idempotencyKey: `payout:${PAYOUT}:requested`,
    payoutId: PAYOUT,
    sellerId: SELLER,
    amount: money(5_000),
  };

  it('zlecenie (PAYOUT_REQUESTED): D seller_balance_available · C payouts_in_transit', () => {
    expect(entriesOf(requested, { [AVAILABLE]: -8_000 })).toEqual({
      [AVAILABLE]: 5_000,
      [IN_TRANSIT]: -5_000,
    });
    expect(planPosting(requested)).toMatchObject({ payoutId: PAYOUT, orderId: null });
  });

  it('wypłata ponad saldo dostępne: INSUFFICIENT_FUNDS', () => {
    const error = failure(() => entriesOf(requested, { [AVAILABLE]: -4_999 }));
    expect(error.code).toBe('INSUFFICIENT_FUNDS');
    // formatMoney oddziela kwotę od „zł” twardą spacją (Intl.NumberFormat).
    expect(error.message.replaceAll(' ', ' ')).toBe(
      `Za mało środków na koncie ${AVAILABLE}: saldo 49,99 zł, księgowanie zdejmuje 50,00 zł.`,
    );
  });

  it('zrealizowana (PAYOUT_COMPLETED): D payouts_in_transit · C provider_cash', () => {
    expect(
      entriesOf(
        {
          type: 'PAYOUT_COMPLETED',
          idempotencyKey: `payout:${PAYOUT}:completed`,
          payoutId: PAYOUT,
          sellerId: SELLER,
          provider: 'fake',
          amount: money(5_000),
        },
        { [IN_TRANSIT]: -5_000 },
      ),
    ).toEqual({ [IN_TRANSIT]: 5_000, 'provider_cash:fake': -5_000 });
  });

  it('nieudana (PAYOUT_FAILED): środki wracają, najpierw na należność', () => {
    const failed: LedgerPosting = {
      type: 'PAYOUT_FAILED',
      idempotencyKey: `payout:${PAYOUT}:failed`,
      payoutId: PAYOUT,
      sellerId: SELLER,
      amount: money(5_000),
    };
    expect(entriesOf(failed, { [IN_TRANSIT]: -5_000 })).toEqual({
      [IN_TRANSIT]: 5_000,
      [AVAILABLE]: -5_000,
    });
    expect(entriesOf(failed, { [IN_TRANSIT]: -5_000, [RECEIVABLE]: 2_000 })).toEqual({
      [IN_TRANSIT]: 5_000,
      [RECEIVABLE]: -2_000,
      [AVAILABLE]: -3_000,
    });
  });
});

describe('opłata operatora (PAYMENT_FEE_CHARGED)', () => {
  it('D payment_fees_expense · C provider_cash, z zamówieniem albo zbiorczo', () => {
    const fee: LedgerPosting = {
      type: 'PAYMENT_FEE_CHARGED',
      idempotencyKey: `fee:${ORDER}`,
      provider: 'payu',
      amount: money(150),
      orderId: ORDER,
    };
    expect(entriesOf(fee)).toEqual({ payment_fees_expense: 150, 'provider_cash:payu': -150 });
    expect(planPosting(fee).orderId).toBe(ORDER);
    expect(planPosting({ ...fee, orderId: undefined }).orderId).toBeNull();
  });
});

describe('koszty sporu po stronie sprzedającego (DISPUTE_COSTS_CHARGED)', () => {
  const costs: LedgerPosting = {
    type: 'DISPUTE_COSTS_CHARGED',
    idempotencyKey: `dispute:${ORDER}:costs`,
    orderId: ORDER,
    sellerId: SELLER,
    amount: money(2_598),
  };

  it('saldo wystarcza: potrącenie z salda dostępnego', () => {
    expect(entriesOf(costs, { [AVAILABLE]: -5_000 })).toEqual({
      [AVAILABLE]: 2_598,
      platform_shipping: -2_598,
    });
  });

  it('saldo za małe: saldo spada do 0, niedobór na seller_receivable', () => {
    expect(entriesOf(costs, { [AVAILABLE]: -1_000 })).toEqual({
      [AVAILABLE]: 1_000,
      [RECEIVABLE]: 1_598,
      platform_shipping: -2_598,
    });
  });

  it('saldo równe kosztom: bez należności', () => {
    expect(entriesOf(costs, { [AVAILABLE]: -2_598 })).not.toHaveProperty(RECEIVABLE);
  });
});

describe('chargebacki po zakończeniu', () => {
  it('ponosi Biddy (CHARGEBACK_ABSORBED): D platform_losses · C provider_cash', () => {
    expect(
      entriesOf({
        type: 'CHARGEBACK_ABSORBED',
        idempotencyKey: `chargeback:${ORDER}`,
        orderId: ORDER,
        provider: 'fake',
        amount: money(TOTAL),
      }),
    ).toEqual({ platform_losses: TOTAL, 'provider_cash:fake': -TOTAL });
  });

  it('oszustwo sprzedającego (CHARGEBACK_CHARGED_TO_SELLER): saldo, potem należność', () => {
    expect(
      entriesOf(
        {
          type: 'CHARGEBACK_CHARGED_TO_SELLER',
          idempotencyKey: `chargeback:${ORDER}`,
          orderId: ORDER,
          sellerId: SELLER,
          provider: 'fake',
          amount: money(TOTAL),
        },
        { [AVAILABLE]: -2_298 },
      ),
    ).toEqual({ [AVAILABLE]: 2_298, [RECEIVABLE]: 10_000, 'provider_cash:fake': -TOTAL });
  });
});

describe('rekompensata za zaginioną paczkę (PARCEL_COMPENSATION_PAID)', () => {
  const compensation = (channel: 'SELLER_BALANCE' | 'EXTERNAL_TRANSFER'): LedgerPosting => ({
    type: 'PARCEL_COMPENSATION_PAID',
    idempotencyKey: `compensation:${ORDER}`,
    orderId: ORDER,
    sellerId: SELLER,
    amount: money(10_000),
    channel,
  });

  it('na saldo sprzedającego: D carrier_claims_receivable · C seller_balance_available', () => {
    expect(entriesOf(compensation('SELLER_BALANCE'))).toEqual({
      carrier_claims_receivable: 10_000,
      [AVAILABLE]: -10_000,
    });
  });

  it('przelewem z rachunku firmowego: C platform_external', () => {
    expect(entriesOf(compensation('EXTERNAL_TRANSFER'))).toEqual({
      carrier_claims_receivable: 10_000,
      platform_external: -10_000,
    });
  });
});

describe('rozliczenie reklamacji (CARRIER_CLAIM_SETTLED)', () => {
  const settled = (recovered: number, unrecovered: number): LedgerPosting => ({
    type: 'CARRIER_CLAIM_SETTLED',
    idempotencyKey: `claim:${ORDER}:settled`,
    orderId: ORDER,
    recovered: money(recovered),
    unrecovered: money(unrecovered),
  });

  it('odszkodowanie do platform_external, nieodzyskana część do platform_losses', () => {
    expect(entriesOf(settled(8_000, 2_000), { carrier_claims_receivable: 10_000 })).toEqual({
      platform_external: 8_000,
      platform_losses: 2_000,
      carrier_claims_receivable: -10_000,
    });
  });

  it('ponad należność od przewoźnika: INSUFFICIENT_FUNDS; bez kwot: INVALID_POSTING', () => {
    expect(
      failure(() => entriesOf(settled(8_000, 2_001), { carrier_claims_receivable: 10_000 })).code,
    ).toBe('INSUFFICIENT_FUNDS');
    expect(failure(() => planPosting(settled(0, 0))).code).toBe('INVALID_POSTING');
  });
});

describe('spisanie należności (RECEIVABLE_WRITTEN_OFF)', () => {
  const writeOff = (amount: number): LedgerPosting => ({
    type: 'RECEIVABLE_WRITTEN_OFF',
    idempotencyKey: `receivable:${SELLER}:write-off`,
    sellerId: SELLER,
    amount: money(amount),
  });

  it('D platform_losses · C seller_receivable', () => {
    expect(entriesOf(writeOff(1_598), { [RECEIVABLE]: 1_598 })).toEqual({
      platform_losses: 1_598,
      [RECEIVABLE]: -1_598,
    });
  });

  it('ponad należność: INSUFFICIENT_FUNDS', () => {
    expect(failure(() => entriesOf(writeOff(1_599), { [RECEIVABLE]: 1_598 })).code).toBe(
      'INSUFFICIENT_FUNDS',
    );
  });
});

describe('walidacja danych księgowania', () => {
  const payment: LedgerPosting = {
    type: 'PAYMENT_RECEIVED',
    idempotencyKey: 'payment:1',
    orderId: ORDER,
    sellerId: SELLER,
    provider: 'fake',
    amount: money(TOTAL),
    sellerAmount: money(10_000),
  };

  it.each([
    ['kwota zerowa', { amount: money(0) }],
    ['kwota ujemna', { amount: money(-1) }],
    ['ułamek grosza', { amount: { amount: 1.5, currency: 'PLN' } }],
    ['nieobsługiwana waluta', { amount: { amount: 100, currency: 'EUR' } }],
    ['UUID wielkimi literami', { orderId: ORDER.toUpperCase() }],
    ['identyfikator, który nie jest UUID', { sellerId: 'seller-1' }],
    ['nazwa operatora', { provider: 'PayU' }],
    ['pusty klucz', { idempotencyKey: '' }],
    ['za długi klucz', { idempotencyKey: 'k'.repeat(201) }],
  ])('%s: INVALID_POSTING', (_case, change) => {
    const error = failure(() => planPosting({ ...payment, ...change } as LedgerPosting));
    expect(error.code).toBe('INVALID_POSTING');
  });

  it('nieznany powód zwrotu albo typ księgowania: INVALID_POSTING', () => {
    const refund = {
      type: 'ORDER_REFUNDED',
      idempotencyKey: 'refund:1',
      orderId: ORDER,
      provider: 'fake',
      amount: money(100),
      reason: 'NOT_PICKED_UP',
    };
    expect(failure(() => planPosting(refund as LedgerPosting)).code).toBe('INVALID_POSTING');
    expect(
      failure(() => planPosting({ ...refund, type: 'GIFT' } as unknown as LedgerPosting)).code,
    ).toBe('INVALID_POSTING');
  });
});

describe('konta i storno', () => {
  it('konta księgowania w stałej kolejności (kod, parametr), bez powtórzeń', () => {
    const plan = planPosting({
      type: 'ORDER_PARTIALLY_REFUNDED',
      idempotencyKey: 'partial:1',
      orderId: ORDER,
      sellerId: SELLER,
      provider: 'fake',
      amounts: AMOUNTS,
      refund: money(100),
    });
    expect(plan.accounts.map(accountLabel)).toEqual([
      HELD,
      'platform_revenue_pok',
      'platform_shipping',
      'provider_cash:fake',
      AVAILABLE,
      RECEIVABLE,
      'vat_payable',
    ]);
  });

  it('istniejące konto z innym sprzedającym albo inną częścią: ACCOUNT_MISMATCH', () => {
    const [held] = planPosting({
      type: 'PAYMENT_RECEIVED',
      idempotencyKey: 'payment:1',
      orderId: ORDER,
      sellerId: SELLER,
      provider: 'fake',
      amount: money(TOTAL),
      sellerAmount: money(10_000),
    }).accounts.filter((account) => account.code === 'buyer_funds_held');
    if (held === undefined) {
      throw new Error('brak konta buyer_funds_held w planie');
    }
    expect(() =>
      assertAccountMatches(held, { sellerId: SELLER, sellerAmount: 10_000 }),
    ).not.toThrow();
    expect(
      failure(() => assertAccountMatches(held, { sellerId: PAYOUT, sellerAmount: 10_000 })).code,
    ).toBe('ACCOUNT_MISMATCH');
    expect(
      failure(() => assertAccountMatches(held, { sellerId: SELLER, sellerAmount: 9_999 })).code,
    ).toBe('ACCOUNT_MISMATCH');
  });

  it('storno: te same konta z przeciwnym znakiem', () => {
    const plan = planPosting({
      type: 'PAYMENT_RECEIVED',
      idempotencyKey: 'payment:1',
      orderId: ORDER,
      sellerId: SELLER,
      provider: 'fake',
      amount: money(TOTAL),
      sellerAmount: money(10_000),
    });
    const reversed = reversalEntries(plan.entries(() => 0));
    expect(reversed.map((entry) => [accountLabel(entry.account), entry.amount])).toEqual([
      [HELD, TOTAL],
      ['provider_cash:fake', -TOTAL],
    ]);
  });
});

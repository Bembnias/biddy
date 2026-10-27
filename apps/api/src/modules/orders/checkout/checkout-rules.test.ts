import { describe, expect, it } from 'vitest';

import {
  checkoutBlocker,
  checkoutTotal,
  effectivePaymentDeadline,
  PENDING_PAYMENT_GRACE_MS,
  settlementFor,
} from './checkout-rules.js';

const dueAt = new Date('2026-10-28T12:00:00Z');
const before = new Date('2026-10-28T11:50:00Z');
const after = new Date('2026-10-28T12:10:00Z');

describe('termin efektywny (§6.8)', () => {
  it('płatność w toku założona przed terminem przedłuża go o 30 min', () => {
    expect(effectivePaymentDeadline(dueAt, [{ status: 'PENDING', createdAt: before }])).toEqual(
      new Date(dueAt.getTime() + PENDING_PAYMENT_GRACE_MS),
    );
  });

  it('bez przedłużenia: brak płatności, płatność nieudana albo założona po terminie', () => {
    expect(effectivePaymentDeadline(dueAt, [])).toEqual(dueAt);
    expect(effectivePaymentDeadline(dueAt, [{ status: 'FAILED', createdAt: before }])).toEqual(
      dueAt,
    );
    expect(effectivePaymentDeadline(dueAt, [{ status: 'PENDING', createdAt: after }])).toEqual(
      dueAt,
    );
  });
});

describe('blokady checkoutu', () => {
  const order = { status: 'AWAITING_PAYMENT' as const, paymentDueAt: dueAt };

  it('przed terminem bez płatności w toku można płacić; nieudana płatność nie blokuje', () => {
    expect(checkoutBlocker(order, [], before)).toBeUndefined();
    expect(checkoutBlocker(order, [{ status: 'FAILED', createdAt: before }], before)).toBe(
      undefined,
    );
  });

  it('płatność w toku albo udana blokuje kolejną (nie da się zapłacić dwa razy)', () => {
    for (const status of ['PENDING', 'SUCCEEDED'] as const) {
      expect(checkoutBlocker(order, [{ status, createdAt: before }], before)).toBe(
        'PAYMENT_IN_PROGRESS',
      );
    }
  });

  it('po terminie i poza AWAITING_PAYMENT nie można płacić', () => {
    expect(checkoutBlocker(order, [], dueAt)).toBe('PAYMENT_DEADLINE_PASSED');
    expect(checkoutBlocker({ ...order, status: 'PAID' }, [], before)).toBe(
      'ORDER_NOT_AWAITING_PAYMENT',
    );
    expect(checkoutBlocker({ ...order, status: 'CANCELLED_UNPAID' }, [], before)).toBe(
      'ORDER_NOT_AWAITING_PAYMENT',
    );
  });
});

describe('suma i rozliczenie udanej płatności', () => {
  it('suma = cena + POK + dostawa', () => {
    expect(checkoutTotal({ itemsTotal: 10_000, pokFee: 1_299, shippingFee: null })).toBe(11_299);
    expect(checkoutTotal({ itemsTotal: 10_000, pokFee: 1_299, shippingFee: 1_399 })).toBe(12_698);
  });

  it('opłacenie, zwrot spóźnionej albo zdublowanej płatności', () => {
    expect(settlementFor('AWAITING_PAYMENT')).toBe('PAY');
    expect(settlementFor('CANCELLED_UNPAID')).toBe('REFUND_LATE');
    expect(settlementFor('PAID')).toBe('REFUND_DUPLICATE');
    expect(settlementFor('SHIPPED')).toBe('REFUND_DUPLICATE');
  });
});

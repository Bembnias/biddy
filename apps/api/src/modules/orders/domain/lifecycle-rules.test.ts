import { describe, expect, it } from 'vitest';

import {
  inspectionEndsAt,
  nextRunnerUp,
  notReceivedBlocker,
  notReceivedFrom,
  secondChanceBlocker,
  secondChanceSendBy,
  shipmentSteps,
} from './lifecycle-rules.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = new Date('2026-11-02T12:00:00Z');

describe('kroki zamówienia ze statusu przesyłki', () => {
  const change = (
    status: Parameters<typeof shipmentSteps>[1]['status'],
    returnReason: 'NOT_COLLECTED' | 'OTHER' | null = null,
  ) => ({
    status,
    returnReason,
  });

  it('pierwszy status u przewoźnika nadaje opłacone zamówienie, a dalszy dokłada kolejny krok', () => {
    expect(shipmentSteps('PAID', change('CREATED'))).toEqual([]);
    expect(shipmentSteps('PAID', change('DROPPED_OFF'))).toEqual(['SHIP']);
    expect(shipmentSteps('PAID', change('IN_TRANSIT'))).toEqual(['SHIP']);
    expect(shipmentSteps('PAID', change('DELIVERED'))).toEqual(['SHIP', 'DELIVER']);
    expect(shipmentSteps('PAID', change('RETURNING', 'NOT_COLLECTED'))).toEqual([
      'SHIP',
      'NOT_PICKED_UP',
    ]);
  });

  it('odbiór, nieodebranie i powrót paczki', () => {
    expect(shipmentSteps('SHIPPED', change('DELIVERED'))).toEqual(['DELIVER']);
    expect(shipmentSteps('SHIPPED', change('RETURNING', 'NOT_COLLECTED'))).toEqual([
      'NOT_PICKED_UP',
    ]);
    expect(shipmentSteps('SHIPPED', change('RETURNING', 'OTHER'))).toEqual([]);
    expect(shipmentSteps('SHIPPED', change('RETURNED'))).toEqual([]);
    expect(shipmentSteps('NOT_PICKED_UP', change('RETURNED'))).toEqual(['REFUND_RETURNED']);
  });

  it('zamówienie już dalej albo anulowane: bez kroków', () => {
    expect(shipmentSteps('DELIVERED', change('DELIVERED'))).toEqual([]);
    expect(shipmentSteps('CANCELLED_NOT_SHIPPED', change('DROPPED_OFF'))).toEqual([]);
    expect(shipmentSteps('LOST', change('DELIVERED'))).toEqual([]);
  });
});

describe('okno 36 h i zgłoszenie braku paczki', () => {
  it('okno liczone od chwili wykrycia odbioru', () => {
    expect(inspectionEndsAt(now)).toEqual(new Date(now.getTime() + 36 * HOUR));
  });

  it('zgłoszenie tylko dla paczki w drodze, 14 dni po nadaniu, bez statusu końcowego', () => {
    const shippedAt = new Date(now.getTime() - 14 * DAY);
    expect(notReceivedFrom(shippedAt)).toEqual(now);
    expect(notReceivedBlocker({ status: 'PAID', shippedAt: null }, undefined, now)).toBe(
      'ORDER_NOT_SHIPPED_YET',
    );
    expect(notReceivedBlocker({ status: 'SHIPPED', shippedAt }, 'IN_TRANSIT', now)).toBeUndefined();
    expect(
      notReceivedBlocker(
        { status: 'SHIPPED', shippedAt },
        'IN_TRANSIT',
        new Date(now.getTime() - 1),
      ),
    ).toBe('NOT_RECEIVED_TOO_EARLY');
    expect(notReceivedBlocker({ status: 'SHIPPED', shippedAt }, 'DELIVERED', now)).toBe(
      'SHIPMENT_FINISHED',
    );
    expect(notReceivedBlocker({ status: 'DELIVERED', shippedAt }, 'DELIVERED', now)).toBe(
      'SHIPMENT_FINISHED',
    );
  });
});

describe('druga szansa', () => {
  const runnerUps = [
    { bidderId: 'b', maxAmount: 4_500 },
    { bidderId: 'c', maxAmount: 3_000 },
  ];

  it('kolejny kandydat pomija osoby z ofertą i kupujących', () => {
    expect(nextRunnerUp(runnerUps, new Set())).toEqual(runnerUps[0]);
    expect(nextRunnerUp(runnerUps, new Set(['b']))).toEqual(runnerUps[1]);
    expect(nextRunnerUp(runnerUps, new Set(['b', 'c']))).toBeUndefined();
  });

  it('wysłanie tylko po anulowaniu nieopłaconego, dla ostatniego zamówienia, bez oczekującej oferty, do 14 dni', () => {
    const base = {
      status: 'CANCELLED_UNPAID' as const,
      cancelledAt: now,
      latest: true,
      pendingOffer: false,
      candidate: runnerUps[0],
      now,
    };
    expect(secondChanceBlocker(base)).toBeUndefined();
    expect(secondChanceBlocker({ ...base, status: 'PAID', cancelledAt: null })).toBe(
      'NOT_CANCELLED_UNPAID',
    );
    expect(secondChanceBlocker({ ...base, latest: false })).toBe('NOT_LATEST_ORDER');
    expect(secondChanceBlocker({ ...base, pendingOffer: true })).toBe('OFFER_PENDING');
    expect(secondChanceBlocker({ ...base, now: secondChanceSendBy(now) })).toBe('WINDOW_PASSED');
    expect(secondChanceBlocker({ ...base, candidate: undefined })).toBe('NO_CANDIDATES');
  });
});

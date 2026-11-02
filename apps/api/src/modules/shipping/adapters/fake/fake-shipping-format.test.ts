import { describe, expect, it } from 'vitest';

import { isShippingProviderError } from '../../ports/shipping-provider.port.js';
import type { CarrierConfig } from '../../ports/shipping-provider.port.js';
import {
  FAKE_SHIPPING_SIGNATURE_HEADER,
  FAKE_STATUS_MAP,
  fakeScenarioPath,
  nextFakeStatus,
  parseFakeShippingWebhook,
  scenarioForPoint,
  signFakeShippingWebhook,
} from './fake-shipping-format.js';
import { fakeLabelPdf } from './fake-shipping-label.js';
import { fakePickupPoints } from './fake-shipping-points.js';

const SECRET = 'fake-shipping-secret';
const NOW = 1_790_000_000;

function webhook(body: string, signature: string | undefined) {
  return {
    headers: signature === undefined ? {} : { [FAKE_SHIPPING_SIGNATURE_HEADER]: signature },
    rawBody: Buffer.from(body),
  };
}

const body = JSON.stringify({
  id: 'fsw_1',
  type: 'parcel.updated',
  created: '2026-10-22T10:00:00.000Z',
  parcel_id: 'fsp_1',
});

describe('webhook FakeShipping', () => {
  it('poprawny podpis: ID przesyłki u dostawcy', () => {
    const parsed = parseFakeShippingWebhook(
      SECRET,
      webhook(body, signFakeShippingWebhook(SECRET, body, NOW)),
      NOW,
    );
    expect(parsed.parcel_id).toBe('fsp_1');
  });

  it.each([
    ['brak nagłówka', undefined, body, NOW],
    ['zły sekret', signFakeShippingWebhook('inny', body, NOW), body, NOW],
    [
      'zmienione body',
      signFakeShippingWebhook(SECRET, body, NOW),
      body.replace('fsp_1', 'fsp_2'),
      NOW,
    ],
    ['stary znacznik czasu', signFakeShippingWebhook(SECRET, body, NOW - 301), body, NOW],
  ])('%s: INVALID_SIGNATURE', (_label, signature, sent, now) => {
    expect(() => parseFakeShippingWebhook(SECRET, webhook(sent, signature), now)).toThrow(
      expect.objectContaining({ code: 'INVALID_SIGNATURE' }) as Error,
    );
  });

  it('podpisane, ale w złym formacie: INVALID_REQUEST', () => {
    const wrong = JSON.stringify({ id: 'x', type: 'parcel.created' });
    try {
      parseFakeShippingWebhook(
        SECRET,
        webhook(wrong, signFakeShippingWebhook(SECRET, wrong, NOW)),
        NOW,
      );
      expect.unreachable();
    } catch (error) {
      expect(isShippingProviderError(error, 'INVALID_REQUEST')).toBe(true);
    }
  });
});

describe('statusy i scenariusze FakeShipping', () => {
  it('mapowanie na statusy Biddy; zwrot po terminie odbioru niesie NOT_COLLECTED', () => {
    expect(FAKE_STATUS_MAP.awaiting_pickup.status).toBe('READY_FOR_PICKUP');
    expect(FAKE_STATUS_MAP.return_expired).toEqual({
      status: 'RETURNING',
      returnReason: 'NOT_COLLECTED',
    });
    expect(FAKE_STATUS_MAP.returning).toEqual({ status: 'RETURNING' });
  });

  it('ścieżki: punkt czeka na odbiór, kurier doręcza; nieodebrana wraca; zagubiona utyka', () => {
    expect(fakeScenarioPath('DELIVERED', 'LOCKER')).toEqual([
      'confirmed',
      'posted',
      'in_transit',
      'awaiting_pickup',
      'delivered',
    ]);
    expect(fakeScenarioPath('DELIVERED', 'COURIER')).toContain('out_for_delivery');
    expect(fakeScenarioPath('NOT_PICKED_UP', 'PICKUP_POINT').slice(-2)).toEqual([
      'return_expired',
      'returned',
    ]);
    expect(nextFakeStatus('LOST', 'LOCKER', 'in_transit')).toBeUndefined();
    expect(nextFakeStatus('MANUAL', 'LOCKER', 'confirmed')).toBeUndefined();
    expect(nextFakeStatus('DELIVERED', 'LOCKER', 'exception')).toBeUndefined();
    expect(nextFakeStatus('DELIVERED', 'COURIER', 'in_transit')).toBe('out_for_delivery');
  });

  it('magiczne punkty ustawiają scenariusz', () => {
    expect(scenarioForPoint('inpost-paczkomat-NOPICKUP')).toBe('NOT_PICKED_UP');
    expect(scenarioForPoint('inpost-paczkomat-LOST')).toBe('LOST');
    expect(scenarioForPoint('inpost-paczkomat-01')).toBe('DELIVERED');
    expect(scenarioForPoint(null)).toBe('DELIVERED');
  });
});

describe('punkty i etykieta FakeShipping', () => {
  const carrier: CarrierConfig = { id: 'inpost-paczkomat', kind: 'LOCKER', providerCodes: {} };

  it('lista z punktami magicznymi, limit, wyszukiwanie po ID; kurier bez punktów', () => {
    const points = fakePickupPoints({ carrier, limit: 50 });
    expect(points).toHaveLength(10);
    expect(points[0]).toMatchObject({
      id: 'inpost-paczkomat-01',
      name: 'Paczkomat testowy 01',
      openingHours: '24/7',
    });
    expect(points.map((point) => point.id)).toContain('inpost-paczkomat-NOPICKUP');
    expect(fakePickupPoints({ carrier, limit: 3 })).toHaveLength(3);
    expect(
      fakePickupPoints({ carrier, pointId: 'inpost-paczkomat-LOST', limit: 1 }).map((p) => p.id),
    ).toEqual(['inpost-paczkomat-LOST']);
    expect(fakePickupPoints({ carrier, pointId: 'nie-ma', limit: 1 })).toEqual([]);
    expect(fakePickupPoints({ carrier: { ...carrier, kind: 'COURIER' }, limit: 10 })).toEqual([]);
  });

  it('etykieta to poprawny PDF z tabelą xref (tekst bez polskich znaków)', () => {
    const pdf = fakeLabelPdf(['Nadawca: Łukasz Żółw (test)', 'ul. Testowa 1']).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toContain('(Nadawca: Lukasz Zolw \\(test\\)) Tj');
    const xref = Number(/startxref\n(\d+)\n/.exec(pdf)?.[1]);
    expect(pdf.slice(xref, xref + 4)).toBe('xref');
    const firstObject = Number(/0000000000 65535 f \n(\d{10}) 00000 n/.exec(pdf)?.[1]);
    expect(pdf.slice(firstObject, firstObject + 7)).toBe('1 0 obj');
  });
});

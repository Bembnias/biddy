import { describe, expect, it } from 'vitest';

import { type PaymentGatewayError } from '../../ports/payment-gateway.port.js';
import {
  FAKE_SIGNATURE_HEADER,
  FAKE_SIGNATURE_TOLERANCE_SECONDS,
  type FakeWebhookBody,
  normalizeFakeEvent,
  parseFakeWebhookBody,
  signFakeWebhook,
  verifyFakeSignature,
} from './fake-webhook-format.js';

const SECRET = 'sekret-testowy';
const NOW = 1_800_000_000;

function request(body: string, header: string | undefined) {
  return {
    headers: header === undefined ? {} : { [FAKE_SIGNATURE_HEADER]: header },
    rawBody: Buffer.from(body),
  };
}

function signatureError(run: () => void): PaymentGatewayError {
  try {
    run();
  } catch (error) {
    return error as PaymentGatewayError;
  }
  throw new Error('Oczekiwano błędu podpisu');
}

const body = JSON.stringify({
  id: 'fake_evt_1',
  type: 'payment.completed',
  created: '2026-10-22T10:00:00.000Z',
  object: { id: 'fake_pay_1', amount: { value: 12_345, currency: 'PLN' } },
});

describe('podpis webhooka FakeGateway', () => {
  it('przyjmuje poprawny podpis także na granicy tolerancji czasu', () => {
    for (const offset of [0, FAKE_SIGNATURE_TOLERANCE_SECONDS, -FAKE_SIGNATURE_TOLERANCE_SECONDS]) {
      const header = signFakeWebhook(SECRET, body, NOW + offset);
      expect(() => verifyFakeSignature(SECRET, request(body, header), NOW)).not.toThrow();
    }
  });

  it.each([
    ['zmieniony bajt treści', body.replace('12345', '12346'), signFakeWebhook(SECRET, body, NOW)],
    ['inny sekret', body, signFakeWebhook('inny-sekret', body, NOW)],
    [
      'stary znacznik czasu',
      body,
      signFakeWebhook(SECRET, body, NOW - FAKE_SIGNATURE_TOLERANCE_SECONDS - 1),
    ],
    [
      'znacznik z przyszłości',
      body,
      signFakeWebhook(SECRET, body, NOW + FAKE_SIGNATURE_TOLERANCE_SECONDS + 1),
    ],
    ['brak nagłówka', body, undefined],
    ['zły format nagłówka', body, `v1=${'a'.repeat(64)}`],
    [
      'podmieniony znacznik czasu (podpis z innego)',
      body,
      signFakeWebhook(SECRET, body, NOW).replace(`t=${NOW}`, `t=${NOW + 1}`),
    ],
  ])('odrzuca: %s', (_label, content, header) => {
    const error = signatureError(() => {
      verifyFakeSignature(SECRET, request(content, header), NOW);
    });
    expect(error.code).toBe('INVALID_SIGNATURE');
  });

  it('nagłówek podany kilka razy (tablica) to brak podpisu', () => {
    const header = signFakeWebhook(SECRET, body, NOW);
    const error = signatureError(() => {
      verifyFakeSignature(
        SECRET,
        { headers: { [FAKE_SIGNATURE_HEADER]: [header, header] }, rawBody: Buffer.from(body) },
        NOW,
      );
    });
    expect(error.code).toBe('INVALID_SIGNATURE');
  });
});

describe('parsowanie i mapowanie webhooków FakeGateway', () => {
  const base = { id: 'fake_evt_1', created: '2026-10-22T10:00:00.000Z' };
  const amount = { value: 10_000, currency: 'PLN' } as const;
  const money = { amount: 10_000, currency: 'PLN' };

  it.each<[FakeWebhookBody, Record<string, unknown>]>([
    [
      {
        ...base,
        type: 'payment.completed',
        object: { id: 'p1', amount, fee: { value: 120, currency: 'PLN' } },
      },
      {
        type: 'PAYMENT_SUCCEEDED',
        providerPaymentId: 'p1',
        amount: money,
        providerFee: { amount: 120, currency: 'PLN' },
      },
    ],
    [
      {
        ...base,
        type: 'payment.rejected',
        object: { id: 'p1', amount, failure_code: 'invalid_blik_code' },
      },
      { type: 'PAYMENT_FAILED', providerPaymentId: 'p1', reason: 'INVALID_BLIK_CODE' },
    ],
    [
      { ...base, type: 'refund.completed', object: { id: 'r1', payment_id: 'p1', amount } },
      { type: 'REFUND_SUCCEEDED', providerRefundId: 'r1', providerPaymentId: 'p1', amount: money },
    ],
    [
      { ...base, type: 'refund.rejected', object: { id: 'r1', payment_id: 'p1', amount } },
      { type: 'REFUND_FAILED', providerRefundId: 'r1' },
    ],
    [
      { ...base, type: 'payout.completed', object: { id: 'po1', seller_id: 's1', amount } },
      { type: 'PAYOUT_PAID', providerPayoutId: 'po1', amount: money },
    ],
    [
      { ...base, type: 'payout.rejected', object: { id: 'po1', seller_id: 's1', amount } },
      { type: 'PAYOUT_FAILED', providerPayoutId: 'po1' },
    ],
    [
      { ...base, type: 'seller.status_changed', object: { id: 's1', status: 'rejected' } },
      { type: 'SELLER_STATUS_CHANGED', providerSellerId: 's1', status: 'REJECTED' },
    ],
    [
      { ...base, type: 'chargeback.opened', object: { id: 'cb1', payment_id: 'p1', amount } },
      { type: 'CHARGEBACK_OPENED', providerChargebackId: 'cb1', providerPaymentId: 'p1' },
    ],
    [
      {
        ...base,
        type: 'chargeback.closed',
        object: { id: 'cb1', payment_id: 'p1', amount, outcome: 'won' },
      },
      { type: 'CHARGEBACK_CLOSED', providerChargebackId: 'cb1', outcome: 'WON' },
    ],
  ])('%j → zdarzenie znormalizowane', (event, expected) => {
    const parsed = parseFakeWebhookBody(Buffer.from(JSON.stringify(event)));
    expect(normalizeFakeEvent(parsed)).toMatchObject({
      eventId: 'fake_evt_1',
      occurredAt: new Date(base.created),
      ...expected,
    });
  });

  it.each([
    ['nie-JSON', 'to nie json'],
    ['nieznany typ', JSON.stringify({ ...base, type: 'payment.unknown', object: {} })],
    [
      'odrzucenie bez kodu powodu',
      JSON.stringify({ ...base, type: 'payment.rejected', object: { id: 'p1', amount } }),
    ],
    [
      'kwota w złotych z groszami',
      JSON.stringify({
        ...base,
        type: 'payment.completed',
        object: { id: 'p1', amount: { value: 12.5, currency: 'PLN' } },
      }),
    ],
  ])('odrzuca format: %s', (_label, raw) => {
    expect(() => parseFakeWebhookBody(Buffer.from(raw))).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' }) as Error,
    );
  });
});

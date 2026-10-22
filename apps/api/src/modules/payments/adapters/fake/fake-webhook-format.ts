// Format webhooków FakeGateway (F-23): „notacja operatora”, którą parseWebhook tłumaczy na
// zdarzenia znormalizowane Biddy, jak zrobi to prawdziwy adapter. Celowo różni się od naszych
// typów (snake_case, kwota jako { value, currency }, statusy małymi literami), żeby testy
// kontraktowe sprawdzały mapowanie, a nie przepisanie obiektu.
//
// Podpis: nagłówek `x-fake-signature: t={unix},v1={hex}`, gdzie hex = HMAC-SHA256(sekret,
// "{t}.{body}") z bajtów body (jak Stripe). Znacznik czasu ogranicza powtórzenie starego webhooka.
import { createHmac, timingSafeEqual } from 'node:crypto';

import { CURRENCIES, type CurrencyCode, type Money } from '@biddy/shared';
import { z } from 'zod';

import type { PaymentFailureReason, SellerStatus } from '../../domain/payment-values.js';
import {
  type NormalizedPaymentEvent,
  PaymentGatewayError,
  type RawWebhookRequest,
} from '../../ports/payment-gateway.port.js';

export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';

/** Największa różnica między znacznikiem czasu podpisu a zegarem odbiorcy. */
export const FAKE_SIGNATURE_TOLERANCE_SECONDS = 300;

export const FAKE_EVENT_TYPES = [
  'payment.completed',
  'payment.rejected',
  'refund.completed',
  'refund.rejected',
  'payout.completed',
  'payout.rejected',
  'seller.status_changed',
  'chargeback.opened',
  'chargeback.closed',
] as const;
export type FakeEventType = (typeof FAKE_EVENT_TYPES)[number];

/** Kody odrzucenia płatności w notacji FakeGateway. */
const FAILURE_CODES = {
  declined: 'DECLINED',
  invalid_blik_code: 'INVALID_BLIK_CODE',
  expired: 'EXPIRED',
  cancelled: 'CANCELLED',
  seller_not_verified: 'SELLER_NOT_VERIFIED',
  provider_error: 'PROVIDER_ERROR',
} as const satisfies Record<string, PaymentFailureReason>;

const SELLER_STATUS_CODES = {
  pending: 'PENDING',
  verified: 'VERIFIED',
  rejected: 'REJECTED',
} as const satisfies Record<string, SellerStatus>;

export type FakeFailureCode = keyof typeof FAILURE_CODES;
export type FakeSellerStatusCode = keyof typeof SELLER_STATUS_CODES;

export function fakeFailureCode(reason: PaymentFailureReason): FakeFailureCode {
  const entry = Object.entries(FAILURE_CODES).find(([, value]) => value === reason);
  return (entry?.[0] ?? 'provider_error') as FakeFailureCode;
}

export function fakeSellerStatusCode(status: SellerStatus): FakeSellerStatusCode {
  return status.toLowerCase() as FakeSellerStatusCode;
}

const currencyCodes = Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]];
const amountSchema = z.object({ value: z.int().positive(), currency: z.enum(currencyCodes) });
export type FakeAmount = z.infer<typeof amountSchema>;

export function fakeAmount(money: Money): FakeAmount {
  return { value: money.amount, currency: money.currency };
}

function toMoney(amount: FakeAmount): Money {
  return { amount: amount.value, currency: amount.currency };
}

const paymentObject = z.object({
  id: z.string().min(1),
  amount: amountSchema,
  fee: amountSchema.optional(),
  failure_code: z.enum(Object.keys(FAILURE_CODES) as [FakeFailureCode]).optional(),
});
const refundObject = z.object({
  id: z.string().min(1),
  payment_id: z.string().min(1),
  amount: amountSchema,
});
const payoutObject = z.object({
  id: z.string().min(1),
  seller_id: z.string().min(1),
  amount: amountSchema,
});
const sellerObject = z.object({
  id: z.string().min(1),
  status: z.enum(Object.keys(SELLER_STATUS_CODES) as [FakeSellerStatusCode]),
});
const chargebackObject = z.object({
  id: z.string().min(1),
  payment_id: z.string().min(1),
  amount: amountSchema,
  outcome: z.enum(['won', 'lost']).optional(),
});

const envelope = <TType extends FakeEventType, TObject extends z.ZodType>(
  type: TType,
  object: TObject,
) =>
  z.object({
    id: z.string().min(1).max(200),
    type: z.literal(type),
    created: z.iso.datetime(),
    object,
  });

export const fakeWebhookBodySchema = z.discriminatedUnion('type', [
  envelope('payment.completed', paymentObject),
  envelope('payment.rejected', paymentObject.required({ failure_code: true })),
  envelope('refund.completed', refundObject),
  envelope('refund.rejected', refundObject),
  envelope('payout.completed', payoutObject),
  envelope('payout.rejected', payoutObject),
  envelope('seller.status_changed', sellerObject),
  envelope('chargeback.opened', chargebackObject),
  envelope('chargeback.closed', chargebackObject.required({ outcome: true })),
]);

export type FakeWebhookBody = z.infer<typeof fakeWebhookBodySchema>;

/** Treść webhooka (bez `id` i `created`, które nadaje zapis zdarzenia). */
export type FakeWebhookContent = {
  [TBody in FakeWebhookBody as TBody['type']]: Pick<TBody, 'type' | 'object'>;
}[FakeWebhookBody['type']];

export function signFakeWebhook(secret: string, body: string, timestampSeconds: number): string {
  const digest = createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex');
  return `t=${timestampSeconds},v1=${digest}`;
}

function headerValue(request: RawWebhookRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

function invalidSignature(message: string): PaymentGatewayError {
  return new PaymentGatewayError('INVALID_SIGNATURE', message);
}

/** Sprawdza podpis webhooka; rzuca INVALID_SIGNATURE (zły format, podpis albo znacznik czasu). */
export function verifyFakeSignature(
  secret: string,
  request: RawWebhookRequest,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): void {
  const header = headerValue(request, FAKE_SIGNATURE_HEADER);
  const match = header === undefined ? null : /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header);
  if (match === null) {
    throw invalidSignature(`Brak albo zły format nagłówka ${FAKE_SIGNATURE_HEADER}`);
  }
  const timestamp = Number(match[1]);
  if (Math.abs(nowSeconds - timestamp) > FAKE_SIGNATURE_TOLERANCE_SECONDS) {
    throw invalidSignature('Znacznik czasu podpisu poza tolerancją (stary albo z przyszłości)');
  }
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(request.rawBody)
    .digest();
  const given = Buffer.from(match[2] ?? '', 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw invalidSignature('Podpis webhooka nie zgadza się z treścią');
  }
}

/** Parsuje zweryfikowane body; niezgodny format to INVALID_REQUEST (operator nie ponowi go lepiej). */
export function parseFakeWebhookBody(rawBody: Buffer): FakeWebhookBody {
  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString('utf8'));
  } catch (error) {
    throw new PaymentGatewayError('INVALID_REQUEST', 'Webhook nie jest poprawnym JSON-em', {
      cause: error,
    });
  }
  const parsed = fakeWebhookBodySchema.safeParse(json);
  if (!parsed.success) {
    throw new PaymentGatewayError(
      'INVALID_REQUEST',
      `Nieznany format webhooka: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  }
  return parsed.data;
}

/** Mapowanie zdarzenia w notacji FakeGateway na zdarzenie znormalizowane Biddy. */
export function normalizeFakeEvent(body: FakeWebhookBody): NormalizedPaymentEvent {
  const base = { eventId: body.id, occurredAt: new Date(body.created) };
  switch (body.type) {
    case 'payment.completed':
      return {
        ...base,
        type: 'PAYMENT_SUCCEEDED',
        providerPaymentId: body.object.id,
        amount: toMoney(body.object.amount),
        ...(body.object.fee === undefined ? {} : { providerFee: toMoney(body.object.fee) }),
      };
    case 'payment.rejected':
      return {
        ...base,
        type: 'PAYMENT_FAILED',
        providerPaymentId: body.object.id,
        reason: FAILURE_CODES[body.object.failure_code],
      };
    case 'refund.completed':
    case 'refund.rejected':
      return {
        ...base,
        type: body.type === 'refund.completed' ? 'REFUND_SUCCEEDED' : 'REFUND_FAILED',
        providerRefundId: body.object.id,
        providerPaymentId: body.object.payment_id,
        amount: toMoney(body.object.amount),
      };
    case 'payout.completed':
    case 'payout.rejected':
      return {
        ...base,
        type: body.type === 'payout.completed' ? 'PAYOUT_PAID' : 'PAYOUT_FAILED',
        providerPayoutId: body.object.id,
        amount: toMoney(body.object.amount),
      };
    case 'seller.status_changed':
      return {
        ...base,
        type: 'SELLER_STATUS_CHANGED',
        providerSellerId: body.object.id,
        status: SELLER_STATUS_CODES[body.object.status],
      };
    case 'chargeback.opened':
      return {
        ...base,
        type: 'CHARGEBACK_OPENED',
        providerChargebackId: body.object.id,
        providerPaymentId: body.object.payment_id,
        amount: toMoney(body.object.amount),
      };
    case 'chargeback.closed':
      return {
        ...base,
        type: 'CHARGEBACK_CLOSED',
        providerChargebackId: body.object.id,
        providerPaymentId: body.object.payment_id,
        amount: toMoney(body.object.amount),
        outcome: body.object.outcome === 'won' ? 'WON' : 'LOST',
      };
  }
}

// Format FakeShipping (F-24): „notacja dostawcy” (statusy małymi literami, snake_case), którą
// adapter tłumaczy na statusy Biddy jak prawdziwy adapter, oraz podpisany webhook-wskazówka.
// Podpis jak w FakeGateway: nagłówek `x-fake-signature: t={unix},v1={hex}`, gdzie
// hex = HMAC-SHA256(sekret, "{t}.{body}") z bajtów body.
import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import type { CarrierKind } from '../../db/shipping.schema.js';
import {
  FAKE_PARCEL_STATUSES,
  type FakeParcelStatus,
  type FakeShippingScenario,
} from '../../db/fake-shipping.schema.js';
import type { ReturnReason, TrackingStatus } from '../../domain/shipping-values.js';
import {
  type RawWebhookRequest,
  ShippingProviderError,
} from '../../ports/shipping-provider.port.js';

export const FAKE_SHIPPING_SIGNATURE_HEADER = 'x-fake-signature';
export const FAKE_SHIPPING_SIGNATURE_TOLERANCE_SECONDS = 300;

/** Status FakeShipping → status Biddy (i powód zwrotu, gdy dostawca go zna). */
export const FAKE_STATUS_MAP = {
  confirmed: { status: 'CREATED' },
  posted: { status: 'DROPPED_OFF' },
  in_transit: { status: 'IN_TRANSIT' },
  out_for_delivery: { status: 'OUT_FOR_DELIVERY' },
  awaiting_pickup: { status: 'READY_FOR_PICKUP' },
  delivered: { status: 'DELIVERED' },
  exception: { status: 'EXCEPTION' },
  return_expired: { status: 'RETURNING', returnReason: 'NOT_COLLECTED' },
  returning: { status: 'RETURNING' },
  returned: { status: 'RETURNED' },
  cancelled: { status: 'CANCELLED' },
} as const satisfies Record<
  FakeParcelStatus,
  { readonly status: TrackingStatus; readonly returnReason?: ReturnReason }
>;

/** Opisy statusów do historii przesyłki (jak opis przewoźnika). */
export const FAKE_STATUS_DESCRIPTIONS: Readonly<Record<FakeParcelStatus, string>> = {
  confirmed: 'Przesyłka przygotowana przez nadawcę',
  posted: 'Przesyłka nadana',
  in_transit: 'Przesyłka w drodze',
  out_for_delivery: 'Przesyłka wydana do doręczenia',
  awaiting_pickup: 'Przesyłka czeka na odbiór w punkcie',
  delivered: 'Przesyłka odebrana',
  exception: 'Problem z przesyłką w sortowni',
  return_expired: 'Upłynął termin odbioru: zwrot do nadawcy',
  returning: 'Przesyłka wraca do nadawcy',
  returned: 'Przesyłka zwrócona nadawcy',
  cancelled: 'Przesyłka anulowana',
};

/**
 * Kolejne statusy automatu według scenariusza; paczkomat i punkt czekają na odbiór
 * (`awaiting_pickup`), kurier wydaje paczkę do doręczenia (`out_for_delivery`).
 */
export function fakeScenarioPath(
  scenario: FakeShippingScenario,
  kind: CarrierKind,
): readonly FakeParcelStatus[] {
  const lastMile: FakeParcelStatus = kind === 'COURIER' ? 'out_for_delivery' : 'awaiting_pickup';
  switch (scenario) {
    case 'DELIVERED':
      return ['confirmed', 'posted', 'in_transit', lastMile, 'delivered'];
    case 'NOT_PICKED_UP':
      return ['confirmed', 'posted', 'in_transit', lastMile, 'return_expired', 'returned'];
    case 'LOST':
      return ['confirmed', 'posted', 'in_transit'];
    case 'MANUAL':
      return ['confirmed'];
  }
}

/** Następny status według scenariusza; undefined na końcu ścieżki albo poza nią. */
export function nextFakeStatus(
  scenario: FakeShippingScenario,
  kind: CarrierKind,
  current: FakeParcelStatus,
): FakeParcelStatus | undefined {
  const path = fakeScenarioPath(scenario, kind);
  const index = path.indexOf(current);
  return index === -1 ? undefined : path[index + 1];
}

/** Scenariusz z magicznego punktu odbioru (`…-NOPICKUP`, `…-LOST`). */
export function scenarioForPoint(pointId: string | null): FakeShippingScenario {
  if (pointId?.endsWith('-NOPICKUP') === true) {
    return 'NOT_PICKED_UP';
  }
  if (pointId?.endsWith('-LOST') === true) {
    return 'LOST';
  }
  return 'DELIVERED';
}

export const fakeShippingWebhookSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.literal('parcel.updated'),
  created: z.iso.datetime(),
  parcel_id: z.string().min(1).max(200),
});

export type FakeShippingWebhookBody = z.infer<typeof fakeShippingWebhookSchema>;

export function signFakeShippingWebhook(
  secret: string,
  body: string,
  timestampSeconds: number,
): string {
  const digest = createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex');
  return `t=${timestampSeconds},v1=${digest}`;
}

function invalidSignature(message: string): ShippingProviderError {
  return new ShippingProviderError('INVALID_SIGNATURE', message);
}

/** Sprawdza podpis i format; zwraca ID przesyłki u FakeShipping. */
export function parseFakeShippingWebhook(
  secret: string,
  request: RawWebhookRequest,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): FakeShippingWebhookBody {
  const header = request.headers[FAKE_SHIPPING_SIGNATURE_HEADER];
  const match = typeof header === 'string' ? /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header) : null;
  if (match === null) {
    throw invalidSignature(`Brak albo zły format nagłówka ${FAKE_SHIPPING_SIGNATURE_HEADER}`);
  }
  const timestamp = Number(match[1]);
  if (Math.abs(nowSeconds - timestamp) > FAKE_SHIPPING_SIGNATURE_TOLERANCE_SECONDS) {
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
  let json: unknown;
  try {
    json = JSON.parse(request.rawBody.toString('utf8'));
  } catch (error) {
    throw new ShippingProviderError('INVALID_REQUEST', 'Webhook nie jest poprawnym JSON-em', {
      cause: error,
    });
  }
  const parsed = fakeShippingWebhookSchema.safeParse(json);
  if (!parsed.success) {
    throw new ShippingProviderError('INVALID_REQUEST', 'Nieznany format webhooka FakeShipping');
  }
  return parsed.data;
}

export function isFakeParcelStatus(value: string): value is FakeParcelStatus {
  return (FAKE_PARCEL_STATUSES as readonly string[]).includes(value);
}

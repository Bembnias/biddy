// Wspólne operacje na stanie FakeGateway (F-23): identyfikatory w stylu operatora, odcisk danych
// do idempotencji i zapis webhooka w notacji operatora.
import { createHash } from 'node:crypto';

import type { Money } from '@biddy/shared';

import { newId, type Transaction } from '../../../../infra/db/index.js';
import {
  type FakeGatewayEventRow,
  fakeGatewayEvents,
  type FakeGatewayPaymentRow,
} from '../../db/fake-gateway.schema.js';
import { fakeAmount, fakeFailureCode, type FakeWebhookContent } from './fake-webhook-format.js';

/** Identyfikator obiektu FakeGateway, np. `fake_pay_0199…`: nieprzezroczysty tekst operatora. */
export function fakeId(
  prefix: 'fake_pay' | 'fake_ref' | 'fake_po' | 'fake_sel' | 'fake_evt' | 'fake_cb',
): string {
  return `${prefix}_${newId().replaceAll('-', '')}`;
}

/** JSON z kluczami w stałej kolejności (ten sam odcisk niezależnie od kolejności pól). */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Odcisk danych wywołania (SHA-256): ponowienie z tym samym kluczem idempotencji porównuje
 * odcisk, a nie same dane (np. kodu BLIK nie przechowujemy).
 */
export function requestHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function paymentMoney(row: FakeGatewayPaymentRow, amount: number): Money {
  return { amount, currency: row.currency };
}

/** Obiekt płatności w notacji FakeGateway (treść webhooków płatności). */
export function fakePaymentObject(row: FakeGatewayPaymentRow) {
  return {
    id: row.id,
    amount: fakeAmount(paymentMoney(row, row.amount)),
    ...(row.failureReason === null ? {} : { failure_code: fakeFailureCode(row.failureReason) }),
  };
}

/** Zapisuje webhook do wysłania; `created` to czas zapisu (moment zdarzenia u operatora). */
export async function insertFakeEvent(
  tx: Transaction,
  content: FakeWebhookContent,
): Promise<FakeGatewayEventRow> {
  const id = fakeId('fake_evt');
  const created = new Date();
  const [row] = await tx
    .insert(fakeGatewayEvents)
    .values({
      id,
      type: content.type,
      objectId: content.object.id,
      body: { id, type: content.type, created: created.toISOString(), object: content.object },
      createdAt: created,
    })
    .returning();
  if (row === undefined) {
    throw new Error('Nie zapisano zdarzenia FakeGateway');
  }
  return row;
}

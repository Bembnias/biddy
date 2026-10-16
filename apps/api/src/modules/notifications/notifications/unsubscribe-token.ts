// Token wypisania z e-maili (F-20): podpis HMAC użytkownika i zakresu (typ powiadomienia albo
// wszystkie). Bez wygasania: link w starym e-mailu też działa. Klucz wyprowadzony z sekretu
// sesji, więc nie wymaga osobnej zmiennej; zmiana sekretu unieważnia stare linki.
import { createHmac, timingSafeEqual } from 'node:crypto';

import { NOTIFICATION_TYPES, type NotificationType } from '@biddy/shared';

export type UnsubscribeScope = NotificationType | 'ALL';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const KEY_LABEL = 'biddy:notifications:unsubscribe:v1';
const SIGNATURE_LENGTH = 32;

function key(secret: string): Buffer {
  return createHmac('sha256', secret).update(KEY_LABEL).digest();
}

function signature(secret: string, data: string): string {
  return createHmac('sha256', key(secret))
    .update(data)
    .digest('base64url')
    .slice(0, SIGNATURE_LENGTH);
}

export function createUnsubscribeToken(
  secret: string,
  userId: string,
  scope: UnsubscribeScope,
): string {
  const data = `${userId}:${scope}`;
  return `${Buffer.from(data).toString('base64url')}.${signature(secret, data)}`;
}

/** Użytkownik i zakres z tokenu albo null (zły format albo podpis). */
export function verifyUnsubscribeToken(
  secret: string,
  token: string,
): { readonly userId: string; readonly scope: UnsubscribeScope } | null {
  const [encoded = '', given = ''] = token.split('.');
  const data = Buffer.from(encoded, 'base64url').toString('utf8');
  const [userId = '', scope = ''] = data.split(':');
  if (
    !UUID.test(userId) ||
    !(scope === 'ALL' || (NOTIFICATION_TYPES as readonly string[]).includes(scope))
  ) {
    return null;
  }
  const expected = Buffer.from(signature(secret, data));
  const actual = Buffer.from(given);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }
  return { userId, scope: scope as UnsubscribeScope };
}

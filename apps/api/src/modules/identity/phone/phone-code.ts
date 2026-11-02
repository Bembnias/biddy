// Kody SMS (F-08): 6 cyfr, w bazie tylko HMAC (z identyfikatorem weryfikacji, więc ten sam kod
// w dwóch weryfikacjach ma różne skróty), porównanie w czasie stałym.
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export const PHONE_CODE_LENGTH = 6;

export function generatePhoneCode(): string {
  return randomInt(0, 10 ** PHONE_CODE_LENGTH)
    .toString()
    .padStart(PHONE_CODE_LENGTH, '0');
}

export function hashPhoneCode(secret: string, verificationId: string, code: string): string {
  return createHmac('sha256', secret).update(`${verificationId}:${code}`).digest('hex');
}

export function phoneCodeMatches(
  secret: string,
  verificationId: string,
  code: string,
  expectedHash: string,
): boolean {
  const actual = Buffer.from(hashPhoneCode(secret, verificationId, code), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Treść SMS-a: bez polskich znaków (jeden segment GSM-7 do 160 znaków; z ogonkami SMS byłby
 * w UCS-2, po 70 znaków na segment) i z linią WebOTP `@host #kod`, dzięki której przeglądarka
 * na Androidzie podpowiada kod na stronie Biddy.
 */
export function phoneCodeSms(code: string, webUrl: string): string {
  const host = new URL(webUrl).hostname;
  return `Biddy: Twoj kod weryfikacyjny to ${code}. Wazny 5 minut. Nie podawaj go nikomu.\n\n@${host} #${code}`;
}

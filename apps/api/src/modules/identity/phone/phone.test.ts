import { describe, expect, it } from 'vitest';

import { generatePhoneCode, hashPhoneCode, phoneCodeMatches, phoneCodeSms } from './phone-code.js';
import { phoneSendWaitMs } from './phone-limits.js';
import { normalizePhoneNumber } from './phone-number.js';

describe('normalizePhoneNumber (polskie numery komórkowe w E.164)', () => {
  it.each([
    ['500600700', '+48500600700'],
    ['500 600 700', '+48500600700'],
    ['500-600-700', '+48500600700'],
    ['+48 500 600 700', '+48500600700'],
    ['+48500600700', '+48500600700'],
    ['0048500600700', '+48500600700'],
    [' (+48) 691 234 567 ', '+48691234567'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhoneNumber(input)).toBe(expected);
  });

  it.each([
    ['numer stacjonarny (Warszawa)', '22 123 45 67'],
    ['za krótki', '500 600 70'],
    ['za długi', '500 600 7001'],
    ['numer niemiecki', '+49 1512 3456789'],
    ['numer ukraiński', '+380 50 123 4567'],
    ['litery', 'zadzwoń do mnie'],
    ['pusty', ''],
  ])('odrzuca: %s', (_label, input) => {
    expect(normalizePhoneNumber(input)).toBeUndefined();
  });
});

describe('kod SMS', () => {
  it('ma 6 cyfr (także z zerami na początku)', () => {
    for (let index = 0; index < 200; index += 1) {
      expect(generatePhoneCode()).toMatch(/^\d{6}$/);
    }
  });

  it('HMAC zależy od sekretu i weryfikacji; porównanie przyjmuje tylko właściwy kod', () => {
    const hash = hashPhoneCode('sekret', 'weryfikacja-1', '123456');
    expect(hash).not.toBe(hashPhoneCode('sekret', 'weryfikacja-2', '123456'));
    expect(hash).not.toBe(hashPhoneCode('inny', 'weryfikacja-1', '123456'));
    expect(phoneCodeMatches('sekret', 'weryfikacja-1', '123456', hash)).toBe(true);
    expect(phoneCodeMatches('sekret', 'weryfikacja-1', '123457', hash)).toBe(false);
    expect(phoneCodeMatches('sekret', 'weryfikacja-1', '123456', 'zly-skrot')).toBe(false);
  });

  it('treść: ASCII (jeden segment GSM-7, maks. 160 znaków) i linia WebOTP z hostem aplikacji', () => {
    const text = phoneCodeSms('012345', 'https://biddy.pl');
    expect(text).toMatch(/^[\x20-\x7E\n]+$/);
    expect(text.length).toBeLessThanOrEqual(160);
    expect(text).toContain('012345');
    expect(text.split('\n').at(-1)).toBe('@biddy.pl #012345');
    expect(phoneCodeSms('1', 'http://localhost:3000').split('\n').at(-1)).toBe('@localhost #1');
  });
});

describe('phoneSendWaitMs (limity wysyłki)', () => {
  const now = new Date('2026-10-13T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const none = { byUser: [], byPhoneNumber: [], byIp: [] };
  const MINUTE = 60_000;

  it('bez historii można wysłać od razu', () => {
    expect(phoneSendWaitMs(none, now)).toBe(0);
  });

  it('odstęp 60 s między SMS-ami konta', () => {
    expect(phoneSendWaitMs({ ...none, byUser: [ago(20_000)] }, now)).toBe(40_000);
    expect(phoneSendWaitMs({ ...none, byUser: [ago(MINUTE)] }, now)).toBe(0);
  });

  it('3 SMS-y na numer na godzinę: czekamy, aż najstarszy wypadnie z okna', () => {
    const three = [ago(50 * MINUTE), ago(30 * MINUTE), ago(10 * MINUTE)];
    expect(phoneSendWaitMs({ ...none, byPhoneNumber: three.slice(1) }, now)).toBe(0);
    expect(phoneSendWaitMs({ ...none, byPhoneNumber: three }, now)).toBe(10 * MINUTE);
    expect(
      phoneSendWaitMs({ ...none, byPhoneNumber: [ago(61 * MINUTE), ...three.slice(1)] }, now),
    ).toBe(0);
  });

  it('10 SMS-ów z IP na godzinę i 10 na konto na dobę', () => {
    const tenIp = Array.from({ length: 10 }, (_, index) => ago((index + 1) * 5 * MINUTE));
    expect(phoneSendWaitMs({ ...none, byIp: tenIp }, now)).toBe(10 * MINUTE);
    const tenUser = Array.from({ length: 10 }, (_, index) => ago((index + 1) * 60 * MINUTE));
    expect(phoneSendWaitMs({ ...none, byUser: tenUser }, now)).toBe(14 * 60 * MINUTE);
  });

  it('obowiązuje najdłuższe z oczekiwań', () => {
    const wait = phoneSendWaitMs(
      {
        byUser: [ago(10_000)],
        byPhoneNumber: [ago(59 * MINUTE), ago(2 * MINUTE), ago(MINUTE)],
        byIp: [],
      },
      now,
    );
    expect(wait).toBe(MINUTE);
  });
});

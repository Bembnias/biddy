import { describe, expect, it } from 'vitest';

import { polishPhoneDigits } from './auth/schemas';
import { formatPhoneNumber } from './phone';

describe('numery telefonów w web', () => {
  it.each([
    '500600700',
    '500 600 700',
    '500-600-700',
    '+48 500 600 700',
    '0048500600700',
    '(+48)500600700',
  ])('polishPhoneDigits: %s → 500600700', (input) => {
    expect(polishPhoneDigits(input)).toBe('500600700');
  });

  it.each(['50060070', '5006007001', '+49 500600700', 'abc', ''])(
    'polishPhoneDigits odrzuca %s',
    (input) => {
      expect(polishPhoneDigits(input)).toBeUndefined();
    },
  );

  it('formatPhoneNumber grupuje polskie numery, inne zostawia', () => {
    expect(formatPhoneNumber('+48500600700')).toBe('+48 500 600 700');
    expect(formatPhoneNumber('+4915123456789')).toBe('+4915123456789');
  });
});

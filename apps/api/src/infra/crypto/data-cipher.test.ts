import { describe, expect, it } from 'vitest';

import { DEVELOPMENT_DATA_ENCRYPTION_KEY } from '../config/index.js';
import { DataCipher, DecryptionError } from './data-cipher.js';

const cipher = new DataCipher(DEVELOPMENT_DATA_ENCRYPTION_KEY);
const CONTEXT = 'payout-profile:personal-data:user-1';

describe('DataCipher', () => {
  it('szyfruje i odczytuje JSON; szyfrogram nie zawiera jawnych danych i za każdym razem jest inny', () => {
    const data = { lastName: 'Kowalska', taxId: '44051401359' };
    const first = cipher.encryptJson(data, CONTEXT);
    const second = cipher.encryptJson(data, CONTEXT);

    expect(cipher.decryptJson(first, CONTEXT)).toEqual(data);
    expect(first.equals(second)).toBe(false);
    expect(first.toString('latin1')).not.toContain('Kowalska');
    expect(first.toString('latin1')).not.toContain('44051401359');
    expect(first[0]).toBe(1);
  });

  it('odrzuca inny kontekst, inny klucz, zmieniony bajt i nieznaną wersję', () => {
    const encrypted = cipher.encrypt('PL61109010140000071219812874', CONTEXT);
    const otherKey = new DataCipher(Buffer.alloc(32, 7).toString('base64'));
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] = (tampered.at(-1) ?? 0) ^ 1;
    const unknownVersion = Buffer.from(encrypted);
    unknownVersion[0] = 2;

    expect(() => cipher.decrypt(encrypted, 'payout-profile:personal-data:user-2')).toThrow(
      DecryptionError,
    );
    expect(() => otherKey.decrypt(encrypted, CONTEXT)).toThrow(DecryptionError);
    expect(() => cipher.decrypt(tampered, CONTEXT)).toThrow(DecryptionError);
    expect(() => cipher.decrypt(unknownVersion, CONTEXT)).toThrow(DecryptionError);
    expect(() => cipher.decrypt(Buffer.alloc(4), CONTEXT)).toThrow(DecryptionError);
  });

  it('wymaga klucza 32-bajtowego', () => {
    expect(() => new DataCipher(Buffer.alloc(16).toString('base64'))).toThrow(/32 bajty/u);
  });
});

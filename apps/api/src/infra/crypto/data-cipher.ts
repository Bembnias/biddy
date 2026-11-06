// Szyfrowanie wrażliwych pól w bazie (PROJECT.md §16.1, F-27: dane DAC7 i rachunek do wypłat):
// AES-256-GCM z kluczem z DATA_ENCRYPTION_KEY. Format: wersja klucza (1 bajt) | iv (12) |
// tag (16) | szyfrogram. Bajt wersji pozwoli dodać rotację klucza bez zmiany kolumn.
//
// Kontekst (np. `payout-profile:personal-data:{userId}`) jest danymi uwierzytelnionymi (AAD):
// szyfrogramu przeniesionego do innego wiersza albo kolumny nie da się odszyfrować.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;

/** Szyfrogram nie pasuje do klucza albo kontekstu, albo jest uszkodzony. */
export class DecryptionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DecryptionError';
  }
}

export class DataCipher {
  private readonly key: Buffer;

  /** @param keyBase64 32 bajty w base64 (`AppConfig.payments.dataEncryptionKey`) */
  constructor(keyBase64: string) {
    this.key = Buffer.from(keyBase64, 'base64');
    if (this.key.length !== 32) {
      throw new Error('Klucz szyfrowania danych musi mieć 32 bajty (base64).');
    }
  }

  encrypt(value: string, context: string): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.of(KEY_VERSION), iv, cipher.getAuthTag(), encrypted]);
  }

  /** @throws {DecryptionError} zły klucz, kontekst albo uszkodzony szyfrogram */
  decrypt(value: Buffer, context: string): string {
    if (value.length < HEADER_BYTES || value[0] !== KEY_VERSION) {
      throw new DecryptionError('Nieznany format szyfrogramu.');
    }
    const iv = value.subarray(1, 1 + IV_BYTES);
    const tag = value.subarray(1 + IV_BYTES, HEADER_BYTES);
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(value.subarray(HEADER_BYTES)),
        decipher.final(),
      ]).toString('utf8');
    } catch (error) {
      throw new DecryptionError('Nie udało się odszyfrować danych.', { cause: error });
    }
  }

  encryptJson(value: unknown, context: string): Buffer {
    return this.encrypt(JSON.stringify(value), context);
  }

  /** @throws {DecryptionError} */
  decryptJson<T>(value: Buffer, context: string): T {
    return JSON.parse(this.decrypt(value, context)) as T;
  }
}

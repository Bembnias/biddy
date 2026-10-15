// Identyfikatory encji: UUIDv7 generowane w aplikacji (ADR-10, PROJECT.md §13.1). ID jest znane
// przed INSERT (outbox, idempotencja) i nie zależy od wersji Postgresa (natywne uuidv7() jest
// dopiero w PG 18). UUIDv7 zaczyna się od znacznika czasu, więc ID sortują się chronologicznie.
//
// Plik nie zależy od NestJS: importują go pliki tabel (*.schema.ts), które czyta też drizzle-kit.
import { randomInt } from 'node:crypto';

import { uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

/** Nowy identyfikator encji (UUIDv7, małe litery, format 8-4-4-4-12). */
export function newId(): string {
  return uuidv7();
}

/**
 * Kolumna klucza głównego: `uuid primary key`. Wartość nadaje aplikacja ({@link newId}) przy
 * INSERT bez jawnego `id`, baza nie ma wartości domyślnej. Nazwa kolumny wynika z klucza obiektu
 * (casing snake_case).
 *
 * @example
 * export const items = pgTable('items', { id: idColumn(), title: text().notNull() });
 */
export function idColumn() {
  return uuid().primaryKey().$defaultFn(newId);
}

/** Litery i cyfry bez łatwych do pomylenia (0/o, 1/l/i). */
const PUBLIC_ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const PUBLIC_ID_LENGTH = 8;

/**
 * Krótki identyfikator dla ludzi (adres aukcji `/a/{slug}-{publicId}`, numer zamówienia), np.
 * `k3x9qa7m`. 31^8 ≈ 8,5 · 10^11 możliwości; kolizję wyłapuje unikalny indeks (ponowienie zapisu).
 */
export function newPublicId(): string {
  let id = '';
  for (let index = 0; index < PUBLIC_ID_LENGTH; index += 1) {
    id += PUBLIC_ID_ALPHABET[randomInt(PUBLIC_ID_ALPHABET.length)] ?? '';
  }
  return id;
}

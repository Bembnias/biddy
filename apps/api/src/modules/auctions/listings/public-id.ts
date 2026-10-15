import { randomInt } from 'node:crypto';

/** Litery i cyfry bez łatwych do pomylenia (0/o, 1/l/i). */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const LENGTH = 8;

/**
 * Krótki publiczny identyfikator aukcji do adresu `/a/{slug}-{publicId}` (F-18), np. `k3x9qa7m`.
 * 31^8 ≈ 8,5 · 10^11 możliwości; kolizję wyłapuje unikalny indeks (ponowienie przy zapisie).
 */
export function newPublicId(): string {
  let id = '';
  for (let index = 0; index < LENGTH; index += 1) {
    id += ALPHABET[randomInt(ALPHABET.length)] ?? '';
  }
  return id;
}

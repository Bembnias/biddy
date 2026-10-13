// Identyfikator żądania: przyjmujemy x-request-id od klienta lub proxy tylko w bezpiecznym
// formacie (trafia do logów i odpowiedzi), w przeciwnym razie generujemy UUIDv7.
import type { IncomingMessage } from 'node:http';

import { v7 as uuidv7 } from 'uuid';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Litery, cyfry i `._:-`, 1–128 znaków: wystarcza dla UUID, ULID i identyfikatorów proxy. */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

/**
 * Identyfikator z nagłówka, jeśli jest bezpieczny; inaczej nowy UUIDv7. Kilka nagłówków
 * x-request-id (tablica albo wartości połączone przecinkiem) traktujemy jak niepoprawny.
 */
export function resolveRequestId(headerValue: string | readonly string[] | undefined): string {
  return isValidRequestId(headerValue) ? headerValue : uuidv7();
}

/** Generator `genReqId` dla Fastify (dostaje surowe żądanie Node). */
export function requestIdFor(request: Pick<IncomingMessage, 'headers'>): string {
  return resolveRequestId(request.headers[REQUEST_ID_HEADER]);
}

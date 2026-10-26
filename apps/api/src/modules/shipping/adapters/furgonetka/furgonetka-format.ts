// Format Furgonetki (F-24, REST API z mediami application/vnd.furgonetka.vN+json): mapowanie
// stanów trackingu na statusy Biddy, suma kontrolna webhooka, deterministyczne UUID komend,
// czas warszawski i błędy. Opis zachowań API: dokumentacja Furgonetki i notatki z sandboksu
// klienta very-code-com/furgonetka-api-php (wersja API 1.0.118, wrzesień 2026).
import { createHash, timingSafeEqual } from 'node:crypto';

import type { TrackingStatus } from '../../domain/shipping-values.js';
import type { TrackingEvent } from '../../ports/shipping-provider.port.js';

/**
 * Stan Furgonetki (`tracking.state`) → status Biddy. `returned` to zwrot do nadawcy; Furgonetka
 * ma jeden stan zwrotu, więc przyjmujemy „zwrot w drodze”, a późniejsze `delivered` traktujemy
 * jako doręczenie zwrotu nadawcy (do potwierdzenia na sandboksie, spec F-24).
 */
export const FURGONETKA_STATE_MAP: Readonly<Record<string, TrackingStatus>> = {
  waiting: 'CREATED',
  ordered: 'CREATED',
  'ready-for-transport': 'CREATED',
  collected: 'DROPPED_OFF',
  transit: 'IN_TRANSIT',
  delivery: 'OUT_FOR_DELIVERY',
  'waiting-for-receiver': 'READY_FOR_PICKUP',
  delivered: 'DELIVERED',
  'collect-problem': 'EXCEPTION',
  'delivery-problem': 'EXCEPTION',
  'unexpected-situation': 'EXCEPTION',
  returned: 'RETURNING',
  canceled: 'CANCELLED',
};

export interface FurgonetkaTrackingEntry {
  readonly state: string;
  /** Opis przewoźnika w jego języku (pokazujemy, nie dopasowujemy). */
  readonly description: string | null;
  readonly occurredAt: Date;
}

/**
 * Zdarzenia trackingu w kolejności chronologicznej. Nieznany stan pomijamy (`unknown`
 * dostaje go do logów), a `delivered` po `returned` to `RETURNED`.
 */
export function mapFurgonetkaTracking(
  entries: readonly FurgonetkaTrackingEntry[],
  unknown: (state: string) => void = () => undefined,
): TrackingEvent[] {
  const ordered = [...entries].sort(
    (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
  );
  let returning = false;
  const events: TrackingEvent[] = [];
  for (const entry of ordered) {
    const mapped = FURGONETKA_STATE_MAP[entry.state];
    if (mapped === undefined) {
      unknown(entry.state);
      continue;
    }
    const status: TrackingStatus = mapped === 'DELIVERED' && returning ? 'RETURNED' : mapped;
    returning ||= mapped === 'RETURNING';
    events.push({
      rawStatus: entry.state,
      status,
      occurredAt: entry.occurredAt,
      description: entry.description,
    });
  }
  return events;
}

/** Pola webhooka w kolejności sumy kontrolnej (dokumentacja Furgonetki). */
const CHECKSUM_TOP = ['package_id', 'package_no', 'partner_order_id'] as const;
const CHECKSUM_TRACKING = ['state', 'description', 'datetime', 'branch'] as const;

function text(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '';
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Suma kontrolna webhooka: md5(package_id . package_no . partner_order_id . state . description
 * . datetime . branch . token) z wartości tak, jak przyszły. To nie podpis kryptograficzny,
 * więc webhook jest tylko wskazówką, a stan pobieramy z API.
 */
export function furgonetkaChecksum(payload: Record<string, unknown>, token: string): string {
  const tracking = asRecord(payload['tracking']);
  const fields = [
    ...CHECKSUM_TOP.map((key) => text(payload, key)),
    ...CHECKSUM_TRACKING.map((key) => text(tracking, key)),
  ];
  return createHash('md5')
    .update(`${fields.join('')}${token}`)
    .digest('hex');
}

export function verifyFurgonetkaChecksum(payload: Record<string, unknown>, token: string): boolean {
  const control = text(payload, 'control').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(control)) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(control, 'hex'),
    Buffer.from(furgonetkaChecksum(payload, token), 'hex'),
  );
}

/**
 * UUID komendy z naszego klucza (format UUID v8 z SHA-256). Furgonetka wykonuje komendę
 * o danym UUID raz, a powtórka to `commandExists`, więc ponowienie po błędzie sieci nie tworzy
 * drugiej przesyłki.
 */
export function commandUuid(key: string): string {
  const bytes = createHash('sha256').update(key).digest().subarray(0, 16);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x80, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Przesunięcie strefy w minutach w danej chwili, np. 120 dla Warszawy latem. */
function offsetMinutes(timeZone: string, at: Date): number {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (match === null) {
    return 0;
  }
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

/**
 * Czas z Furgonetki: z przesunięciem (ISO) albo „naiwny” `2021-07-01 12:00:00`, który jest
 * czasem warszawskim. Undefined dla złego formatu.
 */
export function parseFurgonetkaDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  const trimmed = value.trim();
  if (/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed)) {
    const date = new Date(trimmed.replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (match === null) {
    return undefined;
  }
  const [, year, month, day, hour, minute, second] = match;
  const wall = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? 0),
  );
  const first = wall - offsetMinutes('Europe/Warsaw', new Date(wall)) * 60_000;
  // Drugi krok poprawia godzinę wokół zmiany czasu.
  return new Date(wall - offsetMinutes('Europe/Warsaw', new Date(first)) * 60_000);
}

/** Błąd z odpowiedzi Furgonetki: `{errors:[{path,message,code}]}` albo płaski `{code,message}`. */
export interface FurgonetkaApiError {
  readonly code: string;
  readonly message: string;
  readonly path: string;
}

export function furgonetkaErrors(body: unknown): FurgonetkaApiError[] {
  const data = asRecord(body);
  const list = Array.isArray(data['errors']) ? data['errors'] : [data];
  return list
    .map((entry) => {
      const error = asRecord(entry);
      return {
        code: text(error, 'code'),
        message: text(error, 'message'),
        path: text(error, 'path'),
      };
    })
    .filter((error) => error.code !== '' || error.message !== '');
}

const PARTY_PREFIXES: Readonly<Record<string, string>> = {
  pickup: 'sender',
  sender: 'sender',
  receiver: 'recipient',
};

const PARTY_FIELDS: Readonly<Record<string, string>> = {
  name: 'name',
  phone: 'phone',
  email: 'email',
  street: 'address.street',
  postcode: 'address.postalCode',
  city: 'address.city',
};

/** Ścieżka pola Furgonetki (`/pickup/phone`) → pole Biddy (`sender.phone`); undefined, gdy inne. */
export function furgonetkaField(path: string): string | undefined {
  const [prefix, field] = path.split('/').filter((part) => part !== '');
  if (prefix === undefined || field === undefined) {
    return undefined;
  }
  const party = PARTY_PREFIXES[prefix];
  if (party === undefined) {
    return undefined;
  }
  if (field === 'point') {
    return party === 'recipient' ? 'pickupPointId' : undefined;
  }
  const mapped = PARTY_FIELDS[field];
  return mapped === undefined ? undefined : `${party}.${mapped}`;
}

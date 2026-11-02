// Konwencja eventów domenowych (PROJECT.md §14.3, ADR-4).
//
// - Typ: PascalCase w czasie przeszłym, unikalny w całej aplikacji, np. `AuctionEnded`, `BidPlaced`.
// - Wersja: liczba całkowita od 1. Niezgodna wstecz zmiana payloadu = nowa wersja (i nowa
//   definicja obok starej, dopóki w outboxie i kolejkach mogą być eventy w starej wersji).
//   Dodanie pola opcjonalnego nie wymaga nowej wersji.
// - Agregat: encja, której dotyczy event (`auction` + ID aukcji).
// - Payload: schemat Zod z typami JSON (tekst, liczby, wartości logiczne, obiekty, tablice).
//   Kwoty jako { amount: grosze (int), currency }, daty jako ISO 8601 (z.iso.datetime()).
//   Payload jest walidowany przy zapisie i ponownie u konsumenta, więc schemat nie może mieć
//   transformacji ani typów spoza JSON (Date, BigInt): defineDomainEvent je odrzuca.
// - Payload niesie dane potrzebne konsumentom (ID, nowe wartości), ale nie dane osobowe ponad
//   konieczność (RODO): event zostaje w outboxie i w Redisie kolejek przez kilka dni.
// - Definicję eksportuje moduł, który publikuje event, przez swoje publiczne API (index.ts);
//   konsumenci z innych modułów importują ją stamtąd.
// - ID eventu (UUIDv7) jest kluczem idempotencji: konsument dostaje event co najmniej raz,
//   a wywołania usług zewnętrznych (np. Resend) przekazują event.id jako Idempotency-Key.
// - Kolejność dostarczania nie jest gwarantowana: konsument, dla którego ma znaczenie, porównuje
//   stan (np. wersję encji) zamiast polegać na kolejności eventów.
import { z } from 'zod';

/** Typ eventu: PascalCase, np. AuctionEnded. */
export const EVENT_TYPE_PATTERN = /^[A-Z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/;

/** Rodzaj agregatu: małe litery, cyfry i `-`, np. auction, order-item. */
export const AGGREGATE_TYPE_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Skąd pochodzi event; wypełnia Outbox.add z kontekstu logów (żądanie HTTP albo job). */
export interface DomainEventMetadata {
  /** Identyfikator żądania HTTP, w którym powstał event (albo łańcuch eventów). */
  readonly requestId?: string;
  /** ID eventu, którego konsument zapisał ten event. */
  readonly causationId?: string;
}

/** Event domenowy dostarczany konsumentowi (koperta z payloadem). */
export interface DomainEvent<TPayload = unknown, TType extends string = string> {
  readonly id: string;
  readonly type: TType;
  readonly version: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  /** Czas transakcji, w której powstał event (ISO 8601). */
  readonly occurredAt: string;
  readonly payload: TPayload;
  readonly metadata: DomainEventMetadata;
}

/** Event przygotowany do zapisu w outboxie (wynik `Definicja.create`). */
export interface NewDomainEvent {
  readonly type: string;
  readonly version: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  /** Payload po walidacji schematem. */
  readonly payload: unknown;
}

export interface DomainEventDefinition<
  TType extends string = string,
  TSchema extends z.ZodType = z.ZodType,
> {
  readonly type: TType;
  readonly version: number;
  readonly aggregateType: string;
  readonly payload: TSchema;
  /** Waliduje payload i zwraca event do zapisu przez Outbox.add (ZodError przy złym payloadzie). */
  create(input: {
    readonly aggregateId: string;
    readonly payload: z.input<TSchema>;
  }): NewDomainEvent;
}

/** Typ eventu dostarczanego konsumentowi dla danej definicji. */
export type DomainEventOf<TDefinition extends DomainEventDefinition> = DomainEvent<
  z.output<TDefinition['payload']>,
  TDefinition['type']
>;

export class InvalidDomainEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDomainEventError';
  }
}

/**
 * Definiuje event domenowy.
 *
 * @example
 * export const AuctionEnded = defineDomainEvent({
 *   type: 'AuctionEnded',
 *   version: 1,
 *   aggregateType: 'auction',
 *   payload: z.object({ winnerId: z.uuid().nullable(), finalPrice: moneySchema }),
 * });
 *
 * await outbox.add(tx, AuctionEnded.create({ aggregateId: auction.id, payload: { … } }));
 */
export function defineDomainEvent<const TType extends string, TSchema extends z.ZodType>(options: {
  readonly type: TType;
  readonly version: number;
  readonly aggregateType: string;
  readonly payload: TSchema;
}): DomainEventDefinition<TType, TSchema> {
  const { type, version, aggregateType, payload } = options;
  if (!EVENT_TYPE_PATTERN.test(type)) {
    throw new InvalidDomainEventError(
      `Typ eventu „${type}”: oczekiwano PascalCase w czasie przeszłym, np. AuctionEnded`,
    );
  }
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new InvalidDomainEventError(`Event ${type}: wersja musi być liczbą całkowitą ≥ 1`);
  }
  if (!AGGREGATE_TYPE_PATTERN.test(aggregateType)) {
    throw new InvalidDomainEventError(
      `Event ${type}: rodzaj agregatu „${aggregateType}” (oczekiwano np. auction, order-item)`,
    );
  }
  try {
    // Ten sam payload walidujemy przy zapisie i u konsumenta (po przejściu przez JSON), więc
    // wynik walidacji musi być czystym JSON-em i nie może zmieniać się przy drugiej walidacji.
    z.toJSONSchema(payload, { io: 'output' });
  } catch (error) {
    throw new InvalidDomainEventError(
      `Event ${type}: payload musi mieć typy JSON, bez transformacji (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  return {
    type,
    version,
    aggregateType,
    payload,
    create: (input) => ({
      type,
      version,
      aggregateType,
      aggregateId: input.aggregateId,
      payload: payload.parse(input.payload),
    }),
  };
}

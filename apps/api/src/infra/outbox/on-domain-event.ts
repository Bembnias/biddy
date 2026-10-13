import { SetMetadata } from '@nestjs/common';

import type { Transaction } from '../db/index.js';
import type { DomainEventDefinition } from './domain-event.js';

/** Nazwa konsumenta: `<moduł>.<co-robi>`, np. `notifications.outbid-email`, `search.reindex-auction`. */
export const CONSUMER_NAME_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;

export const DOMAIN_EVENT_HANDLER_METADATA = 'biddy:domain-event-handler';

export interface DomainEventHandlerMetadata {
  readonly event: DomainEventDefinition;
  readonly consumer: string;
}

/** Kontekst obsługi eventu przez konsumenta. */
export interface DomainEventContext {
  /**
   * Transakcja, w której worker zapisał, że ten konsument obsłużył event. Zmiany w bazie
   * zrobione w niej są atomowe z tym zapisem, więc ponowne dostarczenie nie powtórzy efektu.
   * Eventy wywołane obsługą zapisuj tu przez Outbox.add.
   */
  readonly tx: Transaction;
  /** Numer próby, od 1. */
  readonly attempt: number;
}

export class InvalidConsumerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidConsumerError';
  }
}

/**
 * Konsument eventu domenowego. Worker dostarcza mu każdy event `event` zapisany w outboxie, co
 * najmniej raz, w osobnym jobie kolejki `domain-events` (nazwa joba = nazwa konsumenta), więc
 * błąd jednego konsumenta nie ponawia pozostałych.
 *
 * Idempotencja: worker wykonuje metodę w transakcji, która najpierw zapisuje parę (konsument,
 * ID eventu) w `processed_events`; event już obsłużony jest pomijany bez wywołania metody.
 * Efekty poza bazą (mail, SMS, API zewnętrzne) nie są objęte transakcją: przekazuj `event.id`
 * jako klucz idempotencji dostawcy albo zleć je osobnym jobem.
 *
 * Wyjątek oznacza nieudaną próbę (ponowienie z backoffem, po ostatniej próbie dead-letter
 * queue). Nazwa konsumenta trafia do bazy i ID jobów, więc jej zmiana to nowy konsument.
 *
 * @example
 * @OnDomainEvent(AuctionEnded, { consumer: 'notifications.auction-ended' })
 * async onAuctionEnded(event: DomainEventOf<typeof AuctionEnded>, { tx }: DomainEventContext) { … }
 */
export function OnDomainEvent(
  event: DomainEventDefinition,
  options: { readonly consumer: string },
): MethodDecorator {
  if (!CONSUMER_NAME_PATTERN.test(options.consumer)) {
    throw new InvalidConsumerError(
      `Nazwa konsumenta „${options.consumer}”: oczekiwano <moduł>.<nazwa>, np. notifications.outbid-email`,
    );
  }
  return SetMetadata<string, DomainEventHandlerMetadata>(DOMAIN_EVENT_HANDLER_METADATA, {
    event,
    consumer: options.consumer,
  });
}

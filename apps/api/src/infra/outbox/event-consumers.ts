// Konsumenci eventów (@OnDomainEvent) jako handlery jobów kolejki `domain-events`. Relay tworzy
// osobny job dla każdej pary (konsument, event), a ten moduł wykonuje go idempotentnie: zapis
// w processed_events i obsługa eventu dzieją się w jednej transakcji.
import { Logger } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';

import type { Database } from '../db/index.js';
import type { DiscoveredMethod, RegisteredJobHandler } from '../queues/index.js';
import { DOMAIN_EVENTS_QUEUE } from '../queues/index.js';
import { processedEvents } from './db/outbox.schema.js';
import type { DomainEvent } from './domain-event.js';
import type { DomainEventContext, DomainEventHandlerMetadata } from './on-domain-event.js';

/** Wynik joba konsumenta (zapisywany przez BullMQ jako returnvalue). */
export type ConsumerOutcome = 'processed' | 'duplicate';

/** Typy eventów → nazwy konsumentów (dla relaya). */
export type EventSubscriptions = ReadonlyMap<string, readonly string[]>;

export function eventSubscriptions(
  consumers: readonly DiscoveredMethod<DomainEventHandlerMetadata>[],
): EventSubscriptions {
  const subscriptions = new Map<string, string[]>();
  for (const { metadata } of consumers) {
    const names = subscriptions.get(metadata.event.type) ?? [];
    names.push(metadata.consumer);
    subscriptions.set(metadata.event.type, names);
  }
  return subscriptions;
}

/**
 * Event z joba po sprawdzeniu, że to ten typ i wersja, której oczekuje konsument, a payload
 * pasuje do schematu. Inaczej UnrecoverableError: ponawianie nic nie zmieni, job trafia od razu
 * do dead-letter queue.
 */
export function parseDeliveredEvent(
  metadata: DomainEventHandlerMetadata,
  data: unknown,
): DomainEvent {
  const event = data as DomainEvent;
  const { event: definition, consumer } = metadata;
  if (event.type !== definition.type || event.version !== definition.version) {
    throw new UnrecoverableError(
      `Konsument ${consumer} obsługuje ${definition.type} v${definition.version}, a dostał ${String(event.type)} v${String(event.version)}`,
    );
  }
  const payload = definition.payload.safeParse(event.payload);
  if (!payload.success) {
    throw new UnrecoverableError(
      `Konsument ${consumer}: payload eventu ${event.type} ${event.id} nie pasuje do schematu: ${payload.error.message}`,
    );
  }
  return { ...event, payload: payload.data };
}

/** Handler joba dla konsumenta eventu. */
export function eventConsumerHandler(
  db: Database,
  consumer: DiscoveredMethod<DomainEventHandlerMetadata>,
  logger: Pick<Logger, 'debug'> = new Logger('EventConsumer'),
): RegisteredJobHandler {
  const { metadata, source, invoke } = consumer;
  const name = metadata.consumer;
  return {
    queue: DOMAIN_EVENTS_QUEUE,
    name,
    source,
    bindings: (job: Job) => {
      const event = job.data as Partial<DomainEvent>;
      return {
        consumer: name,
        eventId: event.id,
        eventType: event.type,
        ...(event.metadata?.requestId === undefined ? {} : { requestId: event.metadata.requestId }),
      };
    },
    handle: async (job: Job): Promise<ConsumerOutcome> => {
      const event = parseDeliveredEvent(metadata, job.data);
      return db.transaction(async (tx) => {
        const claimed = await tx
          .insert(processedEvents)
          .values({ consumer: name, eventId: event.id })
          .onConflictDoNothing()
          .returning({ eventId: processedEvents.eventId });
        if (claimed.length === 0) {
          logger.debug(`Event ${event.type} ${event.id} był już obsłużony przez ${name}: pomijam`);
          return 'duplicate';
        }
        const context: DomainEventContext = { tx, attempt: job.attemptsMade + 1 };
        await invoke(event, context);
        return 'processed';
      });
    },
  };
}

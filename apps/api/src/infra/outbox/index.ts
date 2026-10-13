// Publiczne API transactional outbox (ADR-4, PROJECT.md §14.3).
// - defineDomainEvent: definicja eventu (typ, wersja, agregat, schemat payloadu); konwencja
//   w domain-event.ts.
// - Outbox.add(tx, …events): zapis eventów w transakcji wywołującego.
// - @OnDomainEvent(definicja, { consumer }): konsument eventu (at-least-once, idempotentny
//   dzięki processed_events); wykonuje go worker.
// - OutboxRelay, eventConsumerHandler: używa ich worker (src/infra/worker).
// Tabele outbox i processed_events nie są częścią API: moduły zapisują eventy przez Outbox.
export {
  type CleanupResult,
  OUTBOX_RETENTION_DAYS,
  OutboxMaintenance,
  PROCESSED_EVENTS_RETENTION_DAYS,
} from './outbox-maintenance.js';
export {
  AGGREGATE_TYPE_PATTERN,
  EVENT_TYPE_PATTERN,
  InvalidDomainEventError,
  defineDomainEvent,
  type DomainEvent,
  type DomainEventDefinition,
  type DomainEventMetadata,
  type DomainEventOf,
  type NewDomainEvent,
} from './domain-event.js';
export {
  eventConsumerHandler,
  eventSubscriptions,
  parseDeliveredEvent,
  type ConsumerOutcome,
  type EventSubscriptions,
} from './event-consumers.js';
export {
  CONSUMER_NAME_PATTERN,
  DOMAIN_EVENT_HANDLER_METADATA,
  InvalidConsumerError,
  OnDomainEvent,
  type DomainEventContext,
  type DomainEventHandlerMetadata,
} from './on-domain-event.js';
export { Outbox, metadataFromLogBindings } from './outbox.js';
export { OutboxModule } from './outbox.module.js';
export {
  DEFAULT_RELAY_BATCH_SIZE,
  DEFAULT_RELAY_MAX_BACKOFF_MS,
  OutboxRelay,
  relayBackoff,
  toDomainEvent,
  type OutboxRelayOptions,
} from './outbox-relay.js';

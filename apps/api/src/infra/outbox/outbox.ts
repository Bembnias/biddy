import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { newId, type Transaction } from '../db/index.js';
import { outbox } from './db/outbox.schema.js';
import type { DomainEventMetadata, NewDomainEvent } from './domain-event.js';

/**
 * Metadane eventu z pól bieżącego kontekstu logów: `reqId` (żądanie HTTP w API) albo
 * `requestId` i `eventId` (job konsumenta w workerze, gdzie event wywołał kolejny).
 */
export function metadataFromLogBindings(
  bindings: Readonly<Record<string, unknown>>,
): DomainEventMetadata {
  const requestId = bindings['reqId'] ?? bindings['requestId'];
  const causationId = bindings['eventId'];
  return {
    ...(typeof requestId === 'string' ? { requestId } : {}),
    ...(typeof causationId === 'string' ? { causationId } : {}),
  };
}

/**
 * Zapis eventów domenowych (transactional outbox, ADR-4). Event trafia do tabeli `outbox`
 * w transakcji wywołującego: wycofana transakcja nie zostawia eventu, zatwierdzona zostawia go
 * na pewno. Do kolejki przekazuje go relay w workerze.
 */
@Injectable()
export class Outbox {
  constructor(private readonly logger: PinoLogger) {}

  /**
   * Zapisuje eventy w transakcji `tx`, tej samej, w której zmieniają się dane opisane eventem.
   * Zwraca ID eventów w kolejności argumentów.
   *
   * @example
   * await db.transaction(async (tx) => {
   *   await tx.update(auctions).set({ status: 'ENDED_SOLD' }).where(…);
   *   await outbox.add(tx, AuctionEnded.create({ aggregateId: auctionId, payload: { … } }));
   * });
   */
  async add(tx: Transaction, ...events: readonly NewDomainEvent[]): Promise<string[]> {
    if (events.length === 0) {
      return [];
    }
    const metadata = metadataFromLogBindings(this.currentBindings());
    const rows = events.map((event) => ({
      id: newId(),
      type: event.type,
      version: event.version,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event.payload,
      metadata,
    }));
    await tx.insert(outbox).values(rows);
    return rows.map((row) => row.id);
  }

  /** Pola logera z bieżącego kontekstu (żądanie albo job); pusto poza kontekstem. */
  private currentBindings(): Record<string, unknown> {
    // Poza żądaniem i jobem PinoLogger zwraca logger główny, a przed startem aplikacji żadnego.
    const logger = this.logger.logger as { bindings?: () => Record<string, unknown> } | undefined;
    return logger?.bindings?.() ?? {};
  }
}

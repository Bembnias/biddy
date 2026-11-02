// Reguły trackingu (F-24, PROJECT.md §8.3): jak nowe zdarzenia dostawcy zmieniają status
// przesyłki. Te same zdarzenia przychodzą z webhooka i z pollingu, czasem nie po kolei, więc
// status ustawia tylko zdarzenie nie starsze niż bieżący status, a statusy końcowe zostają.
// Czysta logika bez bazy (testy jednostkowe wszystkich przypadków).
import type { TrackingEvent } from '../ports/shipping-provider.port.js';
import {
  AWAITING_RECIPIENT_STATUSES,
  FINAL_SHIPMENT_STATUSES,
  type ReturnReason,
  type ShipmentStatus,
} from './shipping-values.js';

export interface TrackingState {
  readonly status: ShipmentStatus;
  /** Czas zdarzenia, które ustawiło bieżący status. */
  readonly statusChangedAt: Date;
  /** Statusy, które przesyłka już miała (z historii), do wyznaczenia powodu zwrotu. */
  readonly reached: ReadonlySet<ShipmentStatus>;
}

export interface StatusChange {
  readonly status: ShipmentStatus;
  readonly previousStatus: ShipmentStatus;
  readonly occurredAt: Date;
  /** Tylko przy RETURNING. */
  readonly returnReason: ReturnReason | null;
}

/**
 * Zmiany statusu z nowych zdarzeń, w kolejności chronologicznej (jedna zmiana na każde
 * przejście, żeby konsumenci dostali np. DROPPED_OFF przed DELIVERED także z jednego pollingu).
 * Zdarzenie starsze niż bieżący status, z tym samym statusem albo po statusie końcowym niczego
 * nie zmienia (zostaje tylko w historii).
 */
export function statusChanges(
  state: TrackingState,
  events: readonly TrackingEvent[],
): StatusChange[] {
  const ordered = [...events].sort(
    (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
  );
  const reached = new Set(state.reached);
  const changes: StatusChange[] = [];
  let status = state.status;
  let changedAt = state.statusChangedAt;
  for (const event of ordered) {
    if (
      FINAL_SHIPMENT_STATUSES.has(status) ||
      event.status === status ||
      event.occurredAt.getTime() < changedAt.getTime()
    ) {
      continue;
    }
    changes.push({
      status: event.status,
      previousStatus: status,
      occurredAt: event.occurredAt,
      returnReason: event.status === 'RETURNING' ? returnReason(event, reached) : null,
    });
    reached.add(event.status);
    status = event.status;
    changedAt = event.occurredAt;
  }
  return changes;
}

/**
 * Zwrot paczki, która czekała na kupującego (w punkcie albo u kuriera), to paczka nieodebrana
 * (§7.4). Dostawca może podać powód sam (FakeShipping `return_expired`).
 */
function returnReason(event: TrackingEvent, reached: ReadonlySet<ShipmentStatus>): ReturnReason {
  if (event.returnReason !== undefined) {
    return event.returnReason;
  }
  return [...AWAITING_RECIPIENT_STATUSES].some((status) => reached.has(status))
    ? 'NOT_COLLECTED'
    : 'OTHER';
}

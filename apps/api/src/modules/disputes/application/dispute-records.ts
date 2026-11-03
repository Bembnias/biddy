// Blokada i zmiana stanu sporu (F-28): każde przejście blokuje wiersz (`FOR UPDATE`), sprawdza parę
// stanów w maszynie stanów i zmienia status warunkowo (`WHERE status = from`). Trigger w bazie
// odrzuca niedozwoloną parę także poza tym helperem. Do tego wpisy historii sporu.
import type { DisputeActor, DisputeEventType, DisputeStatus } from '@biddy/shared';
import { and, eq } from 'drizzle-orm';

import type { Transaction } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import {
  type DisputeEventRow,
  disputeEvents,
  type DisputeRow,
  disputes,
} from '../db/disputes.schema.js';
import { assertDisputeTransition } from '../domain/dispute-state-machine.js';

export async function lockDispute(
  tx: Transaction,
  disputeId: string,
): Promise<DisputeRow | undefined> {
  const [dispute] = await tx
    .select()
    .from(disputes)
    .where(eq(disputes.id, disputeId))
    .for('update');
  return dispute;
}

/** Kolumny ustawiane razem ze zmianą stanu (terminy, etapy zwrotu, rozstrzygnięcie). */
export type DisputeColumns = Partial<
  Omit<
    typeof disputes.$inferInsert,
    | 'id'
    | 'orderId'
    | 'orderPublicId'
    | 'title'
    | 'buyerId'
    | 'sellerId'
    | 'status'
    | 'createdAt'
    | 'updatedAt'
  >
>;

/**
 * Zmiana stanu zablokowanego sporu. Niedozwolona para to błąd w kodzie
 * (IllegalDisputeTransitionError), a brak wiersza po warunkowym UPDATE oznacza zmianę bez blokady.
 */
export async function transitionDispute(
  tx: Transaction,
  dispute: DisputeRow,
  to: DisputeStatus,
  columns: DisputeColumns,
  now: Date,
): Promise<DisputeRow> {
  assertDisputeTransition(dispute.status, to);
  const [updated] = await tx
    .update(disputes)
    .set({ ...columns, status: to, updatedAt: now })
    .where(and(eq(disputes.id, dispute.id), eq(disputes.status, dispute.status)))
    .returning();
  if (updated === undefined) {
    throw new Error(`Spór ${dispute.id} zmienił stan bez blokady (${dispute.status} → ${to})`);
  }
  return updated;
}

export interface DisputeEventInput {
  readonly type: DisputeEventType;
  readonly actor: DisputeActor;
  /** Konto strony albo personelu; null dla systemu. */
  readonly actorId: string | null;
  readonly note?: string | null;
  readonly amount?: number | null;
  readonly mediaIds?: readonly string[];
}

export async function addDisputeEvent(
  tx: Transaction,
  disputeId: string,
  input: DisputeEventInput,
  now: Date,
): Promise<DisputeEventRow> {
  const [event] = await tx
    .insert(disputeEvents)
    .values({
      disputeId,
      type: input.type,
      actor: input.actor,
      actorId: input.actorId,
      note: input.note ?? null,
      amount: input.amount ?? null,
      mediaIds: [...(input.mediaIds ?? [])],
      createdAt: now,
    })
    .returning();
  if (event === undefined) {
    throw new Error(`Nie zapisano wpisu historii sporu ${disputeId}`);
  }
  return event;
}

/** Akcja niepasująca do bieżącego stanu: klient odświeża widok. */
export function stateChanged(status: DisputeStatus): DomainError {
  return new DomainError({ code: 'DISPUTE_STATE_CHANGED', extensions: { status } });
}

export function disputeNotFound(): DomainError {
  return new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono sporu.' });
}

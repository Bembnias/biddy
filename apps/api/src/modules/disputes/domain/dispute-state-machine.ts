// Maszyna stanów sporu (F-28, PROJECT.md §7.5): dozwolone przejścia według diagramu. Ta sama lista
// jest w triggerze `disputes_status_transition` (migracja 0022_disputes). Poza diagramem z §7.5
// dochodzą dwa przejścia do ESCALATED: przesyłka zwrotna, której nie da się utworzyć albo która
// wraca do kupującego (AWAITING_RETURN, RETURN_IN_TRANSIT). Obie sytuacje wymagają supportu.
//
// Plik nie zależy od NestJS ani od bazy.
import type { DisputeStatus } from '@biddy/shared';

export const DISPUTE_TRANSITIONS: Readonly<Record<DisputeStatus, readonly DisputeStatus[]>> = {
  AWAITING_SELLER: ['RESOLVED', 'AWAITING_RETURN', 'PARTIAL_OFFERED', 'ESCALATED'],
  PARTIAL_OFFERED: ['RESOLVED', 'ESCALATED'],
  ESCALATED: ['AWAITING_RETURN', 'RESOLVED'],
  AWAITING_RETURN: ['RETURN_IN_TRANSIT', 'RESOLVED', 'ESCALATED'],
  RETURN_IN_TRANSIT: ['RETURN_DELIVERED', 'ESCALATED'],
  RETURN_DELIVERED: ['RESOLVED', 'ESCALATED'],
  RESOLVED: [],
};

export function canDisputeTransition(from: DisputeStatus, to: DisputeStatus): boolean {
  return DISPUTE_TRANSITIONS[from].includes(to);
}

/** Niedozwolone przejście: błąd w kodzie, a nie w danych użytkownika. */
export class IllegalDisputeTransitionError extends Error {
  constructor(
    readonly from: DisputeStatus,
    readonly to: DisputeStatus,
  ) {
    super(`Niedozwolone przejście sporu: ${from} → ${to}`);
    this.name = 'IllegalDisputeTransitionError';
  }
}

export function assertDisputeTransition(from: DisputeStatus, to: DisputeStatus): void {
  if (!canDisputeTransition(from, to)) {
    throw new IllegalDisputeTransitionError(from, to);
  }
}

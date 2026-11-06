import { DISPUTE_STATUSES } from '@biddy/shared';
import { describe, expect, it } from 'vitest';

import {
  assertDisputeTransition,
  canDisputeTransition,
  IllegalDisputeTransitionError,
} from './dispute-state-machine.js';

/** Diagram z PROJECT.md §7.5 z dwiema eskalacjami zwrotu (F-28), przepisany niezależnie od kodu. */
const DIAGRAM = new Set([
  'AWAITING_SELLER → RESOLVED',
  'AWAITING_SELLER → AWAITING_RETURN',
  'AWAITING_SELLER → PARTIAL_OFFERED',
  'AWAITING_SELLER → ESCALATED',
  'PARTIAL_OFFERED → RESOLVED',
  'PARTIAL_OFFERED → ESCALATED',
  'ESCALATED → AWAITING_RETURN',
  'ESCALATED → RESOLVED',
  'AWAITING_RETURN → RETURN_IN_TRANSIT',
  'AWAITING_RETURN → RESOLVED',
  'AWAITING_RETURN → ESCALATED',
  'RETURN_IN_TRANSIT → RETURN_DELIVERED',
  'RETURN_IN_TRANSIT → ESCALATED',
  'RETURN_DELIVERED → RESOLVED',
  'RETURN_DELIVERED → ESCALATED',
]);

describe('maszyna stanów sporu (§7.5)', () => {
  it('wszystkie pary: dozwolone dokładnie te z diagramu', () => {
    const mismatches: string[] = [];
    for (const from of DISPUTE_STATUSES) {
      for (const to of DISPUTE_STATUSES) {
        const pair = `${from} → ${to}`;
        if (canDisputeTransition(from, to) !== DIAGRAM.has(pair)) {
          mismatches.push(pair);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('RESOLVED jest stanem końcowym', () => {
    expect(DISPUTE_STATUSES.filter((to) => canDisputeTransition('RESOLVED', to))).toEqual([]);
  });

  it('niedozwolone przejście rzuca błąd z parą stanów', () => {
    expect(() => {
      assertDisputeTransition('RESOLVED', 'ESCALATED');
    }).toThrow(IllegalDisputeTransitionError);
    expect(() => {
      assertDisputeTransition('ESCALATED', 'RESOLVED');
    }).not.toThrow();
  });
});

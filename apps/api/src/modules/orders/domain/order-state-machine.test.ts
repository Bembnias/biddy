import { describe, expect, it } from 'vitest';

import { ORDER_STATUSES, type OrderStatus } from '../db/orders.schema.js';
import {
  assertTransition,
  canTransition,
  FINAL_ORDER_STATUSES,
  IllegalOrderTransitionError,
} from './order-state-machine.js';

/** Diagram z PROJECT.md §7.3, przepisany niezależnie od tabeli w kodzie. */
const DIAGRAM = new Set([
  'AWAITING_PAYMENT → PAID',
  'AWAITING_PAYMENT → CANCELLED_UNPAID',
  'PAID → SHIPPED',
  'PAID → CANCELLED_NOT_SHIPPED',
  'SHIPPED → DELIVERED',
  'SHIPPED → NOT_PICKED_UP',
  'SHIPPED → LOST',
  'DELIVERED → COMPLETED',
  'DELIVERED → DISPUTED',
  'DISPUTED → COMPLETED',
  'DISPUTED → REFUNDED',
  'DISPUTED → PARTIALLY_REFUNDED',
  'CANCELLED_NOT_SHIPPED → REFUNDED',
  'LOST → REFUNDED',
  'NOT_PICKED_UP → REFUNDED',
  'NOT_PICKED_UP → LOST',
]);

describe('maszyna stanów zamówienia (§7.3)', () => {
  it('wszystkie 144 pary: dozwolone dokładnie te z diagramu', () => {
    const mismatches: string[] = [];
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        const pair = `${from} → ${to}`;
        if (canTransition(from, to) !== DIAGRAM.has(pair)) {
          mismatches.push(pair);
        }
      }
    }
    expect(ORDER_STATUSES).toHaveLength(12);
    expect(mismatches).toEqual([]);
  });

  it('stany końcowe nie mają wyjść', () => {
    expect([...FINAL_ORDER_STATUSES].sort()).toEqual<OrderStatus[]>([
      'CANCELLED_UNPAID',
      'COMPLETED',
      'PARTIALLY_REFUNDED',
      'REFUNDED',
    ]);
  });

  it('niedozwolone przejście rzuca błąd z parą stanów', () => {
    expect(() => assertTransition('PAID', 'PAID')).toThrow(IllegalOrderTransitionError);
    expect(() => assertTransition('COMPLETED', 'REFUNDED')).toThrow(
      'Niedozwolone przejście zamówienia: COMPLETED → REFUNDED',
    );
    expect(() => assertTransition('DELIVERED', 'COMPLETED')).not.toThrow();
  });
});

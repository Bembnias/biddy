// Maszyna stanów zamówienia (F-26, PROJECT.md §7.3): dozwolone przejścia dokładnie według
// diagramu. Ta sama lista jest w triggerze `orders_status_transition` (migracja
// 0020_order_lifecycle), który odrzuca niedozwolone przejście także przy ręcznym UPDATE.
//
// Plik nie zależy od NestJS ani od bazy.
import type { OrderStatus } from '../db/orders.schema.js';

export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  AWAITING_PAYMENT: ['PAID', 'CANCELLED_UNPAID'],
  PAID: ['SHIPPED', 'CANCELLED_NOT_SHIPPED'],
  SHIPPED: ['DELIVERED', 'NOT_PICKED_UP', 'LOST'],
  DELIVERED: ['COMPLETED', 'DISPUTED'],
  DISPUTED: ['COMPLETED', 'REFUNDED', 'PARTIALLY_REFUNDED'],
  CANCELLED_NOT_SHIPPED: ['REFUNDED'],
  LOST: ['REFUNDED'],
  NOT_PICKED_UP: ['REFUNDED', 'LOST'],
  COMPLETED: [],
  REFUNDED: [],
  PARTIALLY_REFUNDED: [],
  CANCELLED_UNPAID: [],
};

/** Stany końcowe: zamówienie już się nie zmienia (niezmiennik `buyer_funds_held` = 0). */
export const FINAL_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set(
  (Object.keys(ORDER_TRANSITIONS) as OrderStatus[]).filter(
    (status) => ORDER_TRANSITIONS[status].length === 0,
  ),
);

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Niedozwolone przejście: błąd w kodzie, a nie w danych użytkownika. */
export class IllegalOrderTransitionError extends Error {
  constructor(
    readonly from: OrderStatus,
    readonly to: OrderStatus,
  ) {
    super(`Niedozwolone przejście zamówienia: ${from} → ${to}`);
    this.name = 'IllegalOrderTransitionError';
  }
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new IllegalOrderTransitionError(from, to);
  }
}

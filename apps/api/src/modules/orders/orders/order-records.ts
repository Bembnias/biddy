// Blokada i zmiana stanu zamówienia (F-26, PROJECT.md §7.3): każde przejście blokuje wiersz
// (`FOR UPDATE`), sprawdza parę stanów w maszynie stanów i zmienia status warunkowo
// (`WHERE status = from`). Trigger w bazie odrzuca niedozwoloną parę także poza tym helperem.
import { money } from '@biddy/shared';
import { and, asc, eq } from 'drizzle-orm';

import type { Transaction } from '../../../infra/db/index.js';
import type { OrderAmounts } from '../../ledger/index.js';
import {
  type Order,
  type OrderItem,
  orderItems,
  orders,
  type OrderStatus,
} from '../db/orders.schema.js';
import { assertTransition } from '../domain/order-state-machine.js';

/** Zamówienie pod blokadą wiersza z jego pozycją (aukcja i snapshot przedmiotu). */
export interface LockedOrder {
  readonly order: Order;
  readonly item: OrderItem;
}

export async function lockOrder(
  tx: Transaction,
  orderId: string,
): Promise<LockedOrder | undefined> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
  if (order === undefined) {
    return undefined;
  }
  const [item] = await tx
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(orderItems.createdAt))
    .limit(1);
  if (item === undefined) {
    throw new Error(`Zamówienie ${order.id} bez pozycji`);
  }
  return { order, item };
}

/** Kolumny ustawiane razem ze zmianą stanu (czasy etapów). */
export type TransitionColumns = Partial<
  Pick<
    typeof orders.$inferInsert,
    | 'paidAt'
    | 'shipBy'
    | 'paymentId'
    | 'cancelledAt'
    | 'shippedAt'
    | 'deliveredAt'
    | 'inspectionEndsAt'
    | 'buyerConfirmedAt'
    | 'completedAt'
    | 'notPickedUpAt'
    | 'lostAt'
    | 'disputedAt'
    | 'refundedAt'
  >
>;

/**
 * Zmiana stanu zablokowanego zamówienia. Niedozwolona para to błąd w kodzie
 * (IllegalOrderTransitionError), a brak wiersza po warunkowym UPDATE oznacza zmianę bez blokady.
 */
export async function transitionOrder(
  tx: Transaction,
  order: Order,
  to: OrderStatus,
  columns: TransitionColumns,
  now: Date = new Date(),
): Promise<Order> {
  assertTransition(order.status, to);
  const [updated] = await tx
    .update(orders)
    .set({ ...columns, status: to, updatedAt: now })
    .where(and(eq(orders.id, order.id), eq(orders.status, order.status)))
    .returning();
  if (updated === undefined) {
    throw new Error(`Zamówienie ${order.id} zmieniło stan bez blokady (${order.status} → ${to})`);
  }
  return updated;
}

/** Kwoty zamówienia do księgowań (dostawa 0, gdy zamówienie jej nie ma). */
export function orderAmounts(order: Order): OrderAmounts {
  return {
    itemsTotal: money(order.itemsTotal, order.currency),
    pokFee: money(order.pokFee, order.currency),
    pokVat: money(order.pokVat, order.currency),
    shippingFee: money(order.shippingFee ?? 0, order.currency),
  };
}

/** Pola wspólne eventów zamówienia (numer, aukcja i strony). */
export function orderParties(order: Order, item: OrderItem) {
  return {
    publicId: order.publicId,
    auctionId: item.auctionId,
    buyerId: order.buyerId,
    sellerId: order.sellerId,
  };
}

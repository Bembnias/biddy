// Widok zamówienia (F-26) bez Reacta: ton stanu i kroki postępu „Opłacone · Nadane · Odebrane ·
// Zakończone” z datami. Strona zamówienia i testy liczą to samo.
import type { OrderDetailsDto } from '@biddy/api-client';

export type OrderStatus = OrderDetailsDto['status'];

/** Ton pigułki stanu (Badge). */
export const ORDER_TONES: Readonly<
  Record<OrderStatus, 'warning' | 'info' | 'success' | 'neutral' | 'danger'>
> = {
  AWAITING_PAYMENT: 'warning',
  PAID: 'info',
  SHIPPED: 'info',
  DELIVERED: 'info',
  COMPLETED: 'success',
  DISPUTED: 'warning',
  NOT_PICKED_UP: 'warning',
  LOST: 'warning',
  REFUNDED: 'neutral',
  PARTIALLY_REFUNDED: 'neutral',
  CANCELLED_UNPAID: 'neutral',
  CANCELLED_NOT_SHIPPED: 'neutral',
};

export const PROGRESS_STEPS = ['paid', 'shipped', 'delivered', 'completed'] as const;
export type ProgressStep = (typeof PROGRESS_STEPS)[number];

export interface ProgressItem {
  readonly step: ProgressStep;
  readonly at: string | null;
  readonly state: 'done' | 'current' | 'todo';
}

/**
 * Kroki postępu: zrobione mają datę, bieżący to pierwszy niezrobiony (tylko dla zamówienia
 * w toku). Zamówienie zakończone bez sprzedaży pokazuje tylko to, co się wydarzyło.
 */
export function orderProgress(order: OrderDetailsDto): ProgressItem[] {
  const dates: Readonly<Record<ProgressStep, string | null>> = {
    paid: order.paidAt,
    shipped: order.shippedAt,
    delivered: order.deliveredAt,
    completed: order.completedAt,
  };
  const inProgress = ['PAID', 'SHIPPED', 'DELIVERED', 'AWAITING_PAYMENT'].includes(order.status);
  let current = inProgress;
  return PROGRESS_STEPS.map((step) => {
    const at = dates[step];
    if (at !== null) {
      return { step, at, state: 'done' as const };
    }
    const state = current ? ('current' as const) : ('todo' as const);
    current = false;
    return { step, at, state };
  });
}

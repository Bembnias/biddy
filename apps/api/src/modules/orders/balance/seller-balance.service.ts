// Widok salda sprzedającego (F-27, PROJECT.md §7.6–7.7): salda z ledgera, stan wypłat
// i zamówienia w trakcie, a w historii ruchy salda z tytułami zamówień i stanem wypłat. Serwis
// jest w module orders, bo łączy ledger, wypłaty (payments) i zamówienia, a payments nie zależy
// od orders (decyzja nr 123).
import { DEFAULT_CURRENCY, type Money, money } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { LedgerService, type SellerBalanceMovement } from '../../ledger/index.js';
import { type Payout, type PayoutOverview, PayoutService } from '../../payments/index.js';
import { type OrderStatus, orderItems, orders } from '../db/orders.schema.js';
import type { OrderItemSnapshot } from '../orders/order-snapshot.js';

/** Zamówienia, których cena trafi na saldo po zakończeniu (bez zwrotów w toku). */
const IN_PROGRESS: readonly OrderStatus[] = ['PAID', 'SHIPPED', 'DELIVERED'];

const HISTORY_PAGE = 20;

export interface OrderRef {
  readonly publicId: string;
  readonly title: string;
  readonly photoUrl: string | null;
}

export interface InProgressOrder extends OrderRef {
  readonly status: OrderStatus;
  readonly amount: Money;
}

export interface SellerBalance extends PayoutOverview {
  /** Suma cen zamówień w trakcie. */
  readonly inProgressTotal: Money;
  readonly inProgress: readonly InProgressOrder[];
}

export interface BalanceHistoryItem extends SellerBalanceMovement {
  readonly order: OrderRef | null;
  readonly payout: Payout | null;
}

export interface BalanceHistory {
  readonly items: readonly BalanceHistoryItem[];
  readonly nextCursor: string | undefined;
}

function orderRef(publicId: string, snapshot: OrderItemSnapshot): OrderRef {
  const cover = snapshot.item.photos[0]?.urls;
  return {
    publicId,
    title: snapshot.item.title,
    photoUrl: cover?.['thumb'] ?? cover?.['medium'] ?? null,
  };
}

@Injectable()
export class SellerBalanceService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly payouts: PayoutService,
    private readonly ledger: LedgerService,
  ) {}

  async overview(sellerId: string): Promise<SellerBalance> {
    const overview = await this.payouts.overview(sellerId);
    const rows = await this.db
      .select({
        publicId: orders.publicId,
        status: orders.status,
        itemsTotal: orders.itemsTotal,
        currency: orders.currency,
        snapshot: orderItems.itemSnapshot,
      })
      .from(orders)
      .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
      .where(and(eq(orders.sellerId, sellerId), inArray(orders.status, [...IN_PROGRESS])))
      .orderBy(desc(orders.createdAt));
    const inProgress = rows.map((row) => ({
      ...orderRef(row.publicId, row.snapshot),
      status: row.status,
      amount: money(row.itemsTotal, row.currency),
    }));
    return {
      ...overview,
      inProgressTotal: money(
        inProgress.reduce((total, order) => total + order.amount.amount, 0),
        DEFAULT_CURRENCY,
      ),
      inProgress,
    };
  }

  async history(sellerId: string, before?: string): Promise<BalanceHistory> {
    const page = await this.ledger.sellerHistory(sellerId, {
      limit: HISTORY_PAGE,
      ...(before === undefined ? {} : { before }),
    });
    const orderIds = [
      ...new Set(page.items.flatMap((item) => (item.orderId === null ? [] : [item.orderId]))),
    ];
    const payoutIds = [
      ...new Set(page.items.flatMap((item) => (item.payoutId === null ? [] : [item.payoutId]))),
    ];
    const [orderRows, payouts] = await Promise.all([
      orderIds.length === 0
        ? []
        : this.db
            .select({
              id: orders.id,
              publicId: orders.publicId,
              snapshot: orderItems.itemSnapshot,
            })
            .from(orders)
            .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
            .where(and(eq(orders.sellerId, sellerId), inArray(orders.id, orderIds))),
      this.payouts.forSeller(sellerId, payoutIds),
    ]);
    const orderById = new Map(
      orderRows.map((row) => [row.id, orderRef(row.publicId, row.snapshot)]),
    );
    const payoutById = new Map(payouts.map((payout) => [payout.id, payout]));
    return {
      items: page.items.map((item) => ({
        ...item,
        order: item.orderId === null ? null : (orderById.get(item.orderId) ?? null),
        payout: item.payoutId === null ? null : (payoutById.get(item.payoutId) ?? null),
      })),
      nextCursor: page.nextCursor,
    };
  }
}

// Tabele modułu orders: zamówienia z pozycjami (F-16, PROJECT.md §7.3, §13.3), opłacenie
// i anulowanie nieopłaconych (F-25); pozostałe przejścia stanów i terminy dojdą w F-26. Kwoty w groszach (bigint).
//
// Plik nie zależy od NestJS: czyta go też drizzle-kit (drizzle.config.ts).
import type { CurrencyCode } from '@biddy/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { idColumn } from '../../../infra/db/ids.js';
import type { OrderItemSnapshot } from '../orders/order-snapshot.js';

/** Stany zamówienia z §7.3 (przejścia: F-26). */
export const ORDER_STATUSES = [
  'AWAITING_PAYMENT',
  'PAID',
  'SHIPPED',
  'DELIVERED',
  'COMPLETED',
  'DISPUTED',
  'NOT_PICKED_UP',
  'LOST',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'CANCELLED_UNPAID',
  'CANCELLED_NOT_SHIPPED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const money = () => bigint({ mode: 'number' });

export const orders = pgTable(
  'orders',
  {
    id: idColumn(),
    /** Krótki numer zamówienia dla ludzi (support, e-maile). */
    publicId: text().notNull(),
    /** Kupujący i sprzedający (konta z modułu identity; uuid bez FK między modułami). */
    buyerId: uuid().notNull(),
    sellerId: uuid().notNull(),
    status: text().$type<OrderStatus>().notNull().default('AWAITING_PAYMENT'),
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    /** Suma wylicytowanych kwot. */
    itemsTotal: money().notNull(),
    /** Pakiet Ochrony Kupujących brutto i jego VAT (F-13). */
    pokFee: money().notNull(),
    pokVat: money().notNull(),
    /** Dostawa: wybierana w checkout (F-25). */
    shippingFee: money(),
    /** Do zapłaty: kwota + POK (+ dostawa po checkout). */
    total: money().notNull(),
    /** Cennik POK, według którego policzono zamówienie (moduł payments; uuid bez FK). */
    feeScheduleId: uuid().notNull(),
    paymentDueAt: timestamp({ withTimezone: true }).notNull(),
    /** Opłacenie (F-25) i termin nadania: koniec 5. dnia roboczego od opłacenia (§7.4). */
    paidAt: timestamp({ withTimezone: true }),
    shipBy: timestamp({ withTimezone: true }),
    /** Anulowanie (CANCELLED_UNPAID w F-25, pozostałe w F-26). */
    cancelledAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('orders_public_id_key').on(table.publicId),
    index().on(table.buyerId, table.createdAt),
    index().on(table.sellerId, table.createdAt),
    index().on(table.status, table.paymentDueAt),
    check(
      'orders_status_check',
      sql.raw(`status in (${ORDER_STATUSES.map((status) => `'${status}'`).join(', ')})`),
    ),
    check(
      'orders_amounts_check',
      sql`${table.itemsTotal} >= 0 and ${table.pokFee} >= 0 and ${table.pokVat} >= 0 and ${table.total} >= ${table.itemsTotal} + ${table.pokFee}`,
    ),
    check('orders_paid_check', sql`(${table.paidAt} is null) = (${table.shipBy} is null)`),
    check(
      'orders_cancelled_check',
      sql`${table.cancelledAt} is null or ${table.status} like 'CANCELLED_%'`,
    ),
  ],
);

export type Order = typeof orders.$inferSelect;

/** Pozycje zamówienia: wylicytowana aukcja ze snapshotem przedmiotu z chwili zakupu. */
export const orderItems = pgTable(
  'order_items',
  {
    id: idColumn(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    /** Aukcja z modułu auctions (uuid bez FK między modułami). */
    auctionId: uuid().notNull(),
    hammerPrice: money().notNull(),
    itemSnapshot: jsonb().$type<OrderItemSnapshot>().notNull(),
    /** false po anulowaniu zamówienia (druga szansa tworzy nowe, F-26). */
    isActive: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index().on(table.orderId),
    // Najwyżej jedno aktywne zamówienie na aukcję (§6.8), także przy błędzie w kodzie.
    uniqueIndex('order_items_active_auction_key')
      .on(table.auctionId)
      .where(sql`${table.isActive}`),
  ],
);

export type OrderItem = typeof orderItems.$inferSelect;

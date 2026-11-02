// Tabele modułu orders: zamówienia z pozycjami (F-16, PROJECT.md §7.3, §13.3), opłacenie
// i anulowanie nieopłaconych (F-25), cykl życia z terminami i oferty drugiej szansy (F-26).
// Kwoty w groszach (bigint).
//
// Plik nie zależy od NestJS: czyta go też drizzle-kit (drizzle.config.ts). Trigger
// `orders_status_transition` (dozwolone przejścia, §7.3) jest w migracji 0020_order_lifecycle.
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

/** Stany zamówienia z §7.3 (przejścia: domain/order-state-machine.ts). */
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

/** Chargeback (§7.9): flaga, a nie stan; `OPEN` wstrzymuje zakończenie zamówienia. */
export const CHARGEBACK_STATUSES = ['OPEN', 'WON', 'LOST'] as const;
export type ChargebackStatus = (typeof CHARGEBACK_STATUSES)[number];

/** Stan oferty drugiej szansy (§6.8). */
export const SECOND_CHANCE_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED'] as const;
export type SecondChanceStatus = (typeof SECOND_CHANCE_STATUSES)[number];

/** Kandydat do drugiej szansy: licytujący z najwyższą ważną ofertą maksymalną (bez zwycięzcy). */
export interface RunnerUp {
  readonly bidderId: string;
  /** Maksimum licytującego w groszach: cena oferty drugiej szansy. */
  readonly maxAmount: number;
}

const sqlList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(', ');

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
    /** Płatność, która opłaciła zamówienie (moduł payments; uuid bez FK): zwroty i zwolnienie. */
    paymentId: uuid(),
    /** Anulowanie: CANCELLED_UNPAID (F-25), CANCELLED_NOT_SHIPPED (F-26). */
    cancelledAt: timestamp({ withTimezone: true }),
    /** Pierwszy status przesyłki u przewoźnika (czas u przewoźnika). */
    shippedAt: timestamp({ withTimezone: true }),
    /** Odbiór i koniec okna 36 h na sprawdzenie (od chwili wykrycia odbioru, §7.4). */
    deliveredAt: timestamp({ withTimezone: true }),
    inspectionEndsAt: timestamp({ withTimezone: true }),
    /** „Wszystko OK” kupującego; null przy auto-zakończeniu. */
    buyerConfirmedAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    notPickedUpAt: timestamp({ withTimezone: true }),
    lostAt: timestamp({ withTimezone: true }),
    refundedAt: timestamp({ withTimezone: true }),
    /** Rekompensata dla sprzedającego za zaginioną paczkę (§7.9). */
    sellerCompensatedAt: timestamp({ withTimezone: true }),
    chargebackStatus: text().$type<ChargebackStatus>(),
    /** Oferta drugiej szansy, z której powstało zamówienie (§6.8). */
    secondChanceOfferId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('orders_public_id_key').on(table.publicId),
    index().on(table.buyerId, table.createdAt),
    index().on(table.sellerId, table.createdAt),
    index().on(table.status, table.paymentDueAt),
    // Joby terminów (F-26): nienadane, okno 36 h, rekompensata za zaginioną paczkę.
    index('orders_ship_by_paid_idx')
      .on(table.shipBy)
      .where(sql`${table.status} = 'PAID'`),
    index('orders_inspection_ends_at_delivered_idx')
      .on(table.inspectionEndsAt)
      .where(sql`${table.status} = 'DELIVERED'`),
    index('orders_lost_at_uncompensated_idx')
      .on(table.lostAt)
      .where(sql`${table.lostAt} is not null and ${table.sellerCompensatedAt} is null`),
    check('orders_status_check', sql.raw(`status in (${sqlList(ORDER_STATUSES)})`)),
    check(
      'orders_chargeback_status_check',
      sql.raw(
        `chargeback_status is null or chargeback_status in (${sqlList(CHARGEBACK_STATUSES)})`,
      ),
    ),
    check(
      'orders_delivered_check',
      sql`(${table.deliveredAt} is null) = (${table.inspectionEndsAt} is null)`,
    ),
    check(
      'orders_amounts_check',
      sql`${table.itemsTotal} >= 0 and ${table.pokFee} >= 0 and ${table.pokVat} >= 0 and ${table.total} >= ${table.itemsTotal} + ${table.pokFee}`,
    ),
    check('orders_paid_check', sql`(${table.paidAt} is null) = (${table.shipBy} is null)`),
    // Anulowane nienadane po zwrocie jest REFUNDED, ale pamięta chwilę anulowania.
    check(
      'orders_cancelled_check',
      sql`${table.cancelledAt} is null or ${table.status} like 'CANCELLED_%' or ${table.status} = 'REFUNDED'`,
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
    /** Kandydaci do drugiej szansy z chwili zakończenia aukcji, kolejno (F-26). */
    runnerUps: jsonb().$type<RunnerUp[]>().notNull().default([]),
    /** false, gdy aukcja ma nowsze zamówienie (akceptacja drugiej szansy, F-26). */
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

/**
 * Oferty drugiej szansy (F-26, §6.8): po braku płatności sprzedający proponuje przedmiot kolejnemu
 * licytującemu za jego maksimum. Oferta jest ważna 24 h i niewiążąca; akceptacja tworzy nowe
 * zamówienie. Jedna oferta na licytującego i aukcję, najwyżej jedna oczekująca na aukcję.
 */
export const secondChanceOffers = pgTable(
  'second_chance_offers',
  {
    id: idColumn(),
    /** Aukcja z modułu auctions (uuid bez FK między modułami). */
    auctionId: uuid().notNull(),
    /** Zamówienie anulowane po braku płatności, z którego wyszła oferta. */
    sourceOrderId: uuid()
      .notNull()
      .references(() => orders.id),
    sellerId: uuid().notNull(),
    bidderId: uuid().notNull(),
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    /** Cena: maksimum licytującego (także poniżej ceny minimalnej, §6.8). */
    amount: money().notNull(),
    status: text().$type<SecondChanceStatus>().notNull().default('PENDING'),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    respondedAt: timestamp({ withTimezone: true }),
    /** Zamówienie po akceptacji. */
    orderId: uuid().references(() => orders.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('second_chance_offers_auction_bidder_key').on(table.auctionId, table.bidderId),
    uniqueIndex('second_chance_offers_pending_auction_key')
      .on(table.auctionId)
      .where(sql`${table.status} = 'PENDING'`),
    index().on(table.status, table.expiresAt),
    index().on(table.sourceOrderId),
    check(
      'second_chance_offers_status_check',
      sql.raw(`status in (${sqlList(SECOND_CHANCE_STATUSES)})`),
    ),
    check('second_chance_offers_amount_check', sql`${table.amount} > 0`),
    check(
      'second_chance_offers_order_check',
      sql`(${table.status} = 'ACCEPTED') = (${table.orderId} is not null)`,
    ),
  ],
);

export type SecondChanceOffer = typeof secondChanceOffers.$inferSelect;

// Tabele modułu disputes (F-28, PROJECT.md §7.5): spór o zamówienie i jego historia (oś czasu dla
// stron i personelu). Pieniądze i stan zamówienia są w modułach orders i payments, a przesyłka
// zwrotna w shipping; tu tylko ich ID (uuid bez FK między modułami).
//
// Plik nie zależy od NestJS: czyta go też drizzle-kit (drizzle.config.ts).
import {
  type CurrencyCode,
  DISPUTE_ACTORS,
  DISPUTE_DECIDERS,
  DISPUTE_EVENT_TYPES,
  DISPUTE_FAULTS,
  DISPUTE_OUTCOMES,
  DISPUTE_REASONS,
  DISPUTE_STATUSES,
  type DisputeActor,
  type DisputeDecider,
  type DisputeEventType,
  type DisputeFault,
  type DisputeOutcome,
  type DisputeReason,
  type DisputeStatus,
} from '@biddy/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { idColumn } from '../../../infra/db/ids.js';

const sqlList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(', ');

const money = () => bigint({ mode: 'number' });

/**
 * Spór o zamówienie (jeden na zamówienie). Rozstrzygnięcie (`outcome` z uzasadnieniem) zapisujemy
 * przy decyzji, także gdy wykona się dopiero po weryfikacji zwrotu (`AWAITING_RETURN`).
 */
export const disputes = pgTable(
  'disputes',
  {
    id: idColumn(),
    /** Zamówienie (moduł orders; uuid bez FK) z numerem i tytułem przedmiotu do eventów. */
    orderId: uuid().notNull(),
    orderPublicId: text().notNull(),
    title: text().notNull(),
    buyerId: uuid().notNull(),
    sellerId: uuid().notNull(),
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    /** Cena przedmiotu: górna granica zwrotu częściowego (§7.5). */
    itemsTotal: money().notNull(),
    /** Dostawa i suma zamówienia (pełny zwrot, koszty sprzedającego). */
    shippingFee: money().notNull(),
    orderTotal: money().notNull(),
    reason: text().$type<DisputeReason>().notNull(),
    description: text().notNull(),
    status: text().$type<DisputeStatus>().notNull().default('AWAITING_SELLER'),
    /** Termin odpowiedzi strony: sprzedającego na zgłoszenie, kupującego na propozycję. */
    responseDueAt: timestamp({ withTimezone: true }),
    /** Propozycja zwrotu części ceny od sprzedającego. */
    partialOfferAmount: money(),
    escalatedAt: timestamp({ withTimezone: true }),
    /** SLA decyzji zespołu Biddy: 72 h od eskalacji (bez automatu). */
    decisionDueAt: timestamp({ withTimezone: true }),
    outcome: text().$type<DisputeOutcome>(),
    fault: text().$type<DisputeFault>(),
    refundAmount: money(),
    /** Rozstrzygnięcie wymaga odesłania przedmiotu (zwrot pieniędzy po weryfikacji zwrotu). */
    returnRequired: boolean().notNull().default(false),
    decidedBy: text().$type<DisputeDecider>(),
    /** Personel, który wydał decyzję (moduł identity; uuid bez FK). */
    decidedByStaffId: uuid(),
    /** Uzasadnienie rozstrzygnięcia widoczne dla stron (DSA, statement of reasons). */
    statement: text(),
    decidedAt: timestamp({ withTimezone: true }),
    /** Przesyłka zwrotna (moduł shipping; uuid bez FK). */
    returnShipmentId: uuid(),
    returnShipBy: timestamp({ withTimezone: true }),
    returnShippedAt: timestamp({ withTimezone: true }),
    returnDeliveredAt: timestamp({ withTimezone: true }),
    returnInspectionEndsAt: timestamp({ withTimezone: true }),
    resolvedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('disputes_order_id_key').on(table.orderId),
    index().on(table.buyerId, table.createdAt),
    index().on(table.sellerId, table.createdAt),
    index('disputes_response_due_at_idx')
      .on(table.responseDueAt)
      .where(sql`${table.status} in ('AWAITING_SELLER', 'PARTIAL_OFFERED')`),
    index('disputes_return_ship_by_idx')
      .on(table.returnShipBy)
      .where(sql`${table.status} = 'AWAITING_RETURN'`),
    index('disputes_return_inspection_ends_at_idx')
      .on(table.returnInspectionEndsAt)
      .where(sql`${table.status} = 'RETURN_DELIVERED'`),
    index('disputes_escalated_at_idx')
      .on(table.escalatedAt)
      .where(sql`${table.status} = 'ESCALATED'`),
    check('disputes_status_check', sql.raw(`status in (${sqlList(DISPUTE_STATUSES)})`)),
    check('disputes_reason_check', sql.raw(`reason in (${sqlList(DISPUTE_REASONS)})`)),
    check(
      'disputes_outcome_check',
      sql.raw(`outcome is null or outcome in (${sqlList(DISPUTE_OUTCOMES)})`),
    ),
    check(
      'disputes_fault_check',
      sql.raw(
        `(fault is null or fault in (${sqlList(DISPUTE_FAULTS)})) and ((fault is not null) = (outcome = 'FULL_REFUND'))`,
      ),
    ),
    check(
      'disputes_decided_by_check',
      sql.raw(`decided_by is null or decided_by in (${sqlList(DISPUTE_DECIDERS)})`),
    ),
    check(
      'disputes_decision_check',
      sql`(${table.outcome} is null) = (${table.decidedBy} is null) and (${table.outcome} is null) = (${table.statement} is null) and (${table.outcome} is null) = (${table.decidedAt} is null)`,
    ),
    check(
      'disputes_refund_amount_check',
      sql`(${table.refundAmount} is not null) = (${table.outcome} = 'PARTIAL_REFUND') and (${table.refundAmount} is null or (${table.refundAmount} > 0 and ${table.refundAmount} <= ${table.itemsTotal}))`,
    ),
    check(
      'disputes_partial_offer_check',
      sql`${table.partialOfferAmount} is null or (${table.partialOfferAmount} > 0 and ${table.partialOfferAmount} <= ${table.itemsTotal})`,
    ),
    check(
      'disputes_resolved_check',
      sql`(${table.status} = 'RESOLVED') = (${table.resolvedAt} is not null) and (${table.status} <> 'RESOLVED' or ${table.outcome} is not null)`,
    ),
    check(
      'disputes_amounts_check',
      sql`${table.itemsTotal} > 0 and ${table.shippingFee} >= 0 and ${table.orderTotal} >= ${table.itemsTotal}`,
    ),
  ],
);

export type DisputeRow = typeof disputes.$inferSelect;

/** Historia sporu: każdy krok ze stroną, notatką, kwotą i zdjęciami (moduł media, bez FK). */
export const disputeEvents = pgTable(
  'dispute_events',
  {
    id: idColumn(),
    disputeId: uuid()
      .notNull()
      .references(() => disputes.id),
    type: text().$type<DisputeEventType>().notNull(),
    actor: text().$type<DisputeActor>().notNull(),
    /** Konto strony albo personelu; null dla systemu. */
    actorId: uuid(),
    note: text(),
    amount: money(),
    mediaIds: uuid()
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index().on(table.disputeId, table.createdAt),
    check('dispute_events_type_check', sql.raw(`type in (${sqlList(DISPUTE_EVENT_TYPES)})`)),
    check('dispute_events_actor_check', sql.raw(`actor in (${sqlList(DISPUTE_ACTORS)})`)),
    check(
      'dispute_events_actor_id_check',
      sql`(${table.actor} = 'SYSTEM') = (${table.actorId} is null)`,
    ),
  ],
);

export type DisputeEventRow = typeof disputeEvents.$inferSelect;

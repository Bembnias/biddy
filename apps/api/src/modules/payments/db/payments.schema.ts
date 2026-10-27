// Tabele modułu payments: cenniki POK (F-13), płatności u operatora, konta sprzedawców
// u operatora i idempotencja webhooków (F-23), zwroty (F-25); wypłaty i chargebacki dojdą
// w F-27 i F-28 (PROJECT.md §7.8). ID to UUIDv7 nadawane przez aplikację (ADR-10). Tabele FakeGateway są
// w fake-gateway.schema.ts.
//
// Plik nie zależy od NestJS: czyta go też drizzle-kit (drizzle.config.ts). Ograniczenie
// wykluczające nakładanie się okresów i trigger niezmienności cenników są w migracji
// 0008_fee_schedules (Drizzle ich nie opisuje).
import type { CurrencyCode, FeeTier } from '@biddy/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { idColumn } from '../../../infra/db/ids.js';
import {
  PAYMENT_FAILURE_REASONS,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type PaymentFailureReason,
  type PaymentMethodType,
  type PaymentStatus,
  REFUND_REASONS,
  REFUND_STATUSES,
  type RefundReason,
  type RefundStatus,
  SELLER_ACCOUNT_TYPES,
  SELLER_STATUSES,
  type SellerAccountType,
  type SellerStatus,
  sqlList,
  WEBHOOK_OUTCOMES,
  type WebhookOutcome,
} from '../domain/payment-values.js';

const money = () => bigint({ mode: 'number' });

/**
 * Wersje cennika POK (§3.1). Wiersz jest niezmienny: wolno tylko zamknąć otwarty cennik
 * (`valid_to`), bo zamówienia pamiętają `fee_schedule_id` i muszą dać się przeliczyć tak samo.
 * W danej walucie w każdej chwili obowiązuje dokładnie jeden cennik: `[valid_from, valid_to)`.
 */
export const feeSchedules = pgTable(
  'fee_schedules',
  {
    id: idColumn(),
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    /** Opłata stała w groszach (raz na zamówienie). */
    fixedFee: bigint({ mode: 'number' }).notNull(),
    /** Progi krańcowe (`feeScheduleSchema` z @biddy/shared), np. `[{"upTo":100000,"bp":700},…]`. */
    tiers: jsonb().$type<FeeTier[]>().notNull(),
    /** Stawka VAT od POK w punktach bazowych (2300 = 23%). */
    vatRateBp: integer().notNull(),
    validFrom: timestamp({ withTimezone: true }).notNull(),
    /** Koniec obowiązywania (wyłącznie); null = cennik bieżący bez końca. */
    validTo: timestamp({ withTimezone: true }),
    /** Opis zmiany, np. „Startowy cennik (PROJECT.md §3.1)”. */
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('fee_schedules_fixed_fee_check', sql`${table.fixedFee} >= 0`),
    check('fee_schedules_vat_rate_bp_check', sql`${table.vatRateBp} between 0 and 10000`),
    check(
      'fee_schedules_valid_range_check',
      sql`${table.validTo} is null or ${table.validTo} > ${table.validFrom}`,
    ),
    check(
      'fee_schedules_tiers_check',
      sql`jsonb_typeof(${table.tiers}) = 'array' and jsonb_array_length(${table.tiers}) > 0`,
    ),
  ],
);

export type FeeScheduleRow = typeof feeSchedules.$inferSelect;

/**
 * Płatność zamówienia u operatora (F-23). Wiersz powstaje przed wywołaniem operatora (idempotencja
 * po kluczu wywołującego), a `provider_payment_id` dostaje po jego odpowiedzi. Stan zmienia
 * webhook albo polling zapasowy (§7.8); `PENDING → SUCCEEDED | FAILED`, `FAILED → SUCCEEDED`.
 */
export const payments = pgTable(
  'payments',
  {
    id: idColumn(),
    /** Zamówienie i strony (moduły orders i identity; uuid bez FK, §13.1). */
    orderId: uuid().notNull(),
    buyerId: uuid().notNull(),
    sellerId: uuid().notNull(),
    /** Operator (adapter w GatewayRegistry), np. `fake`, `payu`. */
    provider: text().notNull(),
    /** ID płatności u operatora; null do czasu jego odpowiedzi. */
    providerPaymentId: text(),
    method: text().$type<PaymentMethodType>().notNull(),
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    /** Cała wpłata kupującego. */
    amount: money().notNull(),
    /** Podział: cena dla sprzedającego i część Biddy (POK + dostawa). */
    sellerAmount: money().notNull(),
    platformAmount: money().notNull(),
    status: text().$type<PaymentStatus>().notNull(),
    failureReason: text().$type<PaymentFailureReason>(),
    /** Strona operatora dla płatności z przekierowaniem (ACTION_REQUIRED). */
    redirectUrl: text(),
    /** Klucz wywołującego, np. `order:{orderId}:attempt:1`. */
    idempotencyKey: text().notNull(),
    /** Ostatnia surowa odpowiedź operatora (bez danych wrażliwych). */
    raw: jsonb().$type<Record<string, unknown>>(),
    /** Ostatnie sprawdzenie stanu przez polling zapasowy. */
    polledAt: timestamp({ withTimezone: true }),
    succeededAt: timestamp({ withTimezone: true }),
    failedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('payments_idempotency_key').on(table.idempotencyKey),
    uniqueIndex('payments_provider_payment_id').on(table.provider, table.providerPaymentId),
    index().on(table.status, table.createdAt),
    index().on(table.orderId),
    check('payments_status_check', sql.raw(`status in (${sqlList(PAYMENT_STATUSES)})`)),
    check('payments_method_check', sql.raw(`method in (${sqlList(PAYMENT_METHODS)})`)),
    check(
      'payments_failure_reason_check',
      sql.raw(
        `(status = 'FAILED') = (failure_reason is not null) and (failure_reason is null or failure_reason in (${sqlList(PAYMENT_FAILURE_REASONS)}))`,
      ),
    ),
    check(
      'payments_amounts_check',
      sql`${table.amount} > 0 and ${table.sellerAmount} >= 0 and ${table.platformAmount} >= 0 and ${table.sellerAmount} + ${table.platformAmount} = ${table.amount}`,
    ),
    check('payments_idempotency_key_check', sql`length(${table.idempotencyKey}) between 1 and 200`),
  ],
);

export type PaymentRow = typeof payments.$inferSelect;

/**
 * Zwrot płatności u operatora (F-25: spóźniona i zdublowana płatność; kolejne powody w F-26–F-28).
 * Wiersz powstaje w transakcji zlecającej (z eventem RefundRequested), operatora woła konsument
 * eventu, a stan końcowy i księgowanie przychodzą webhookiem.
 */
export const refunds = pgTable(
  'refunds',
  {
    id: idColumn(),
    paymentId: uuid()
      .notNull()
      .references(() => payments.id),
    /** Zamówienie (moduł orders; uuid bez FK). */
    orderId: uuid().notNull(),
    provider: text().notNull(),
    /** ID zwrotu u operatora; null do czasu jego odpowiedzi. */
    providerRefundId: text(),
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    amount: money().notNull(),
    reason: text().$type<RefundReason>().notNull(),
    status: text().$type<RefundStatus>().notNull().default('PENDING'),
    /** Klucz wywołującego, np. `refund:payment:{id}:late`. */
    idempotencyKey: text().notNull(),
    succeededAt: timestamp({ withTimezone: true }),
    failedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('refunds_idempotency_key').on(table.idempotencyKey),
    uniqueIndex('refunds_provider_refund_id').on(table.provider, table.providerRefundId),
    index().on(table.paymentId),
    check('refunds_status_check', sql.raw(`status in (${sqlList(REFUND_STATUSES)})`)),
    check('refunds_reason_check', sql.raw(`reason in (${sqlList(REFUND_REASONS)})`)),
    check('refunds_amount_check', sql`${table.amount} > 0`),
    check('refunds_idempotency_key_check', sql`length(${table.idempotencyKey}) between 1 and 200`),
  ],
);

export type RefundRow = typeof refunds.$inferSelect;

/**
 * Konto sprzedawcy u operatora (F-23, minimalne kolumny). Na jednego użytkownika najwyżej jedno
 * konto u danego operatora; dane wypłat, blokady i DAC7 dojdą w F-27 i F-32 (§13.3).
 */
export const sellerAccounts = pgTable(
  'seller_accounts',
  {
    id: idColumn(),
    /** Sprzedający (moduł identity; uuid bez FK). */
    userId: uuid().notNull(),
    provider: text().notNull(),
    providerAccountId: text().notNull(),
    type: text().$type<SellerAccountType>().notNull(),
    kycStatus: text().$type<SellerStatus>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('seller_accounts_user_provider').on(table.userId, table.provider),
    uniqueIndex('seller_accounts_provider_account').on(table.provider, table.providerAccountId),
    check('seller_accounts_type_check', sql.raw(`type in (${sqlList(SELLER_ACCOUNT_TYPES)})`)),
    check(
      'seller_accounts_kyc_status_check',
      sql.raw(`kyc_status in (${sqlList(SELLER_STATUSES)})`),
    ),
  ],
);

export type SellerAccountRow = typeof sellerAccounts.$inferSelect;

/**
 * Idempotencja webhooków (§7.8): wpis i obsługa zdarzenia to jedna transakcja, więc to samo
 * zdarzenie zmienia stan najwyżej raz, także przy równoległych dostarczeniach.
 */
export const processedWebhooks = pgTable(
  'processed_webhooks',
  {
    provider: text().notNull(),
    /** ID zdarzenia u operatora. */
    eventId: text().notNull(),
    /** Typ zdarzenia znormalizowanego, np. PAYMENT_SUCCEEDED. */
    eventType: text().notNull(),
    outcome: text().$type<WebhookOutcome>().notNull(),
    processedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.eventId] }),
    check('processed_webhooks_outcome_check', sql.raw(`outcome in (${sqlList(WEBHOOK_OUTCOMES)})`)),
  ],
);

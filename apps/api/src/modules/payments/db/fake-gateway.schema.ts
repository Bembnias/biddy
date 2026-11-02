// Tabele FakeGateway (F-23, PROJECT.md §7.8): stan symulowanego operatora płatności. Należą do
// adaptera testowego (adapters/fake), nie do domeny: domena widzi go wyłącznie przez port
// PaymentGateway. Są w Postgresie, bo płatność tworzy API, a rozlicza ją i wysyła webhooki
// worker. Na produkcji FakeGateway nie działa, więc tabele zostają puste.
//
// Plik nie zależy od NestJS: czyta go też drizzle-kit (drizzle.config.ts).
import type { CurrencyCode } from '@biddy/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  PAYMENT_FAILURE_REASONS,
  PAYMENT_STATUSES,
  type PaymentFailureReason,
  type PaymentMethodType,
  type PaymentStatus,
  SELLER_STATUSES,
  type SellerAccountType,
  type SellerStatus,
  sqlList,
} from '../domain/payment-values.js';

const money = () => bigint({ mode: 'number' });

/** Jak FakeGateway rozliczy płatność (magiczne kody BLIK, PROJECT.md §7.8). */
export const FAKE_PAYMENT_SCENARIOS = [
  /** BLIK 777123: udana po opóźnieniu. */
  'SUCCEED',
  /** BLIK 111111: odrzucona po opóźnieniu. */
  'DECLINE',
  /** BLIK 222222: zostaje w PENDING bez webhooka. */
  'HANG',
  /** Przekierowanie: wynik wybiera kupujący na testowej stronie płatności. */
  'BUYER',
  /** Nieznany kod BLIK: od razu FAILED. */
  'INVALID_CODE',
] as const;
export type FakePaymentScenario = (typeof FAKE_PAYMENT_SCENARIOS)[number];

export const FAKE_CHARGEBACK_STATUSES = ['OPEN', 'WON', 'LOST'] as const;
export type FakeChargebackStatus = (typeof FAKE_CHARGEBACK_STATUSES)[number];

export const FAKE_REFUND_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED'] as const;
export type FakeRefundStatus = (typeof FAKE_REFUND_STATUSES)[number];

export const FAKE_PAYOUT_STATUSES = ['PENDING', 'PAID', 'FAILED'] as const;
export type FakePayoutStatus = (typeof FAKE_PAYOUT_STATUSES)[number];

/** Konto sprzedawcy u FakeGateway z saldem (model SELLER_BALANCE, jak przewidujemy w PayU). */
export const fakeGatewaySellers = pgTable(
  'fake_gateway_sellers',
  {
    id: text().primaryKey(),
    /** Użytkownik Biddy, który się zarejestrował. */
    sellerRef: uuid().notNull(),
    email: text().notNull(),
    displayName: text().notNull(),
    type: text().$type<SellerAccountType>().notNull(),
    status: text().$type<SellerStatus>().notNull(),
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    /** Saldo u operatora: części sprzedawcy z udanych płatności minus zwroty i wypłaty. */
    balance: money().notNull().default(0),
    idempotencyKey: text().notNull(),
    /** Odcisk danych pierwszego wywołania (SHA-256), do wykrycia konfliktu klucza. */
    requestHash: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('fake_gateway_sellers_idempotency_key').on(table.idempotencyKey),
    check('fake_gateway_sellers_status_check', sql.raw(`status in (${sqlList(SELLER_STATUSES)})`)),
  ],
);

export type FakeGatewaySellerRow = typeof fakeGatewaySellers.$inferSelect;

export const fakeGatewayPayments = pgTable(
  'fake_gateway_payments',
  {
    id: text().primaryKey(),
    idempotencyKey: text().notNull(),
    requestHash: text().notNull(),
    /** Wynik pierwszego wywołania createPayment (ponowienie zwraca go bez zmian). */
    result: jsonb().$type<Record<string, unknown>>().notNull(),
    orderId: uuid().notNull(),
    buyerRef: uuid().notNull(),
    sellerId: text()
      .notNull()
      .references(() => fakeGatewaySellers.id),
    method: text().$type<PaymentMethodType>().notNull(),
    scenario: text().$type<FakePaymentScenario>().notNull(),
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    amount: money().notNull(),
    sellerAmount: money().notNull(),
    platformAmount: money().notNull(),
    status: text().$type<PaymentStatus>().notNull(),
    failureReason: text().$type<PaymentFailureReason>(),
    refundedAmount: money().notNull().default(0),
    returnUrl: text().notNull(),
    chargebackId: text(),
    chargebackStatus: text().$type<FakeChargebackStatus>(),
    settledAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('fake_gateway_payments_idempotency_key').on(table.idempotencyKey),
    index().on(table.createdAt),
    check(
      'fake_gateway_payments_status_check',
      sql.raw(
        `status in (${sqlList(PAYMENT_STATUSES)}) and (failure_reason is null or failure_reason in (${sqlList(PAYMENT_FAILURE_REASONS)}))`,
      ),
    ),
    check(
      'fake_gateway_payments_amounts_check',
      sql`${table.amount} > 0 and ${table.sellerAmount} + ${table.platformAmount} = ${table.amount} and ${table.refundedAmount} between 0 and ${table.amount}`,
    ),
  ],
);

export type FakeGatewayPaymentRow = typeof fakeGatewayPayments.$inferSelect;

export const fakeGatewayRefunds = pgTable(
  'fake_gateway_refunds',
  {
    id: text().primaryKey(),
    paymentId: text()
      .notNull()
      .references(() => fakeGatewayPayments.id),
    idempotencyKey: text().notNull(),
    requestHash: text().notNull(),
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    amount: money().notNull(),
    status: text().$type<FakeRefundStatus>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('fake_gateway_refunds_idempotency_key').on(table.idempotencyKey),
    index().on(table.paymentId),
    check('fake_gateway_refunds_amount_check', sql`${table.amount} > 0`),
  ],
);

export type FakeGatewayRefundRow = typeof fakeGatewayRefunds.$inferSelect;

export const fakeGatewayPayouts = pgTable(
  'fake_gateway_payouts',
  {
    id: text().primaryKey(),
    sellerId: text()
      .notNull()
      .references(() => fakeGatewaySellers.id),
    idempotencyKey: text().notNull(),
    requestHash: text().notNull(),
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull(),
    amount: money().notNull(),
    status: text().$type<FakePayoutStatus>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('fake_gateway_payouts_idempotency_key').on(table.idempotencyKey),
    check('fake_gateway_payouts_amount_check', sql`${table.amount} > 0`),
  ],
);

export type FakeGatewayPayoutRow = typeof fakeGatewayPayouts.$inferSelect;

/** Webhook w formacie FakeGateway wraz ze stanem dostarczenia (panel deweloperski). */
export const fakeGatewayEvents = pgTable(
  'fake_gateway_events',
  {
    id: text().primaryKey(),
    /** Typ w notacji operatora, np. `payment.completed`. */
    type: text().notNull(),
    /** Obiekt, którego dotyczy zdarzenie (płatność, zwrot, wypłata, sprzedawca). */
    objectId: text().notNull(),
    /** Treść webhooka wysyłana jako JSON (`{ id, type, created, object }`). */
    body: jsonb().$type<Record<string, unknown>>().notNull(),
    attempts: integer().notNull().default(0),
    lastError: text(),
    deliveredAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index().on(table.objectId), index().on(table.createdAt)],
);

export type FakeGatewayEventRow = typeof fakeGatewayEvents.$inferSelect;

// Tabele modułu identity: konta i sesje Better Auth (users, sessions, accounts, verifications),
// limit zapytań Better Auth (rate_limits), akceptacje regulaminu i nieudane logowania.
// ID to UUIDv7 nadawane przez aplikację (ADR-10, advanced.database.generateId w auth.ts).
//
// Plik nie zależy od NestJS: czyta go też drizzle-kit (drizzle.config.ts).
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { idColumn } from '../../../infra/db/ids.js';

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

export const USER_STATUSES = ['ACTIVE', 'LIMITED', 'BANNED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Role wewnętrzne (panel administracyjny, F-34); zwykły użytkownik ma null. */
export const STAFF_ROLES = ['support', 'moderator', 'finance', 'admin'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const users = pgTable(
  'users',
  {
    id: idColumn(),
    /** Imię wyświetlane (Better Auth: name). */
    name: text().notNull(),
    /** Zawsze małymi literami (Better Auth normalizuje przy rejestracji i logowaniu). */
    email: text().notNull(),
    emailVerified: boolean().notNull().default(false),
    image: text(),
    /** Oświadczenie 18+ przy rejestracji (weryfikacja z telefonem w F-08). */
    isAdultDeclaredAt: timestamp({ withTimezone: true }),
    status: text().$type<UserStatus>().notNull().default('ACTIVE'),
    staffRole: text().$type<StaffRole>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('users_email_key').on(table.email),
    check('users_status_check', sql`${table.status} in ('ACTIVE', 'LIMITED', 'BANNED')`),
    check(
      'users_staff_role_check',
      sql`${table.staffRole} is null or ${table.staffRole} in ('support', 'moderator', 'finance', 'admin')`,
    ),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: idColumn(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ipAddress: text(),
    userAgent: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('sessions_token_key').on(table.token), index().on(table.userId)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: idColumn(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Dostawca logowania: `credential` (e-mail i hasło), `google`, `apple`. */
    providerId: text().notNull(),
    /** Identyfikator konta u dostawcy (dla `credential`: ID użytkownika). */
    accountId: text().notNull(),
    /** Hash hasła (scrypt) dla `credential`. */
    password: text(),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('accounts_provider_account_key').on(table.providerId, table.accountId),
    index().on(table.userId),
  ],
);

/** Tokeny weryfikacji e-maila i resetu hasła (Better Auth). */
export const verifications = pgTable(
  'verifications',
  {
    id: idColumn(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index().on(table.identifier)],
);

/** Liczniki limitu zapytań Better Auth (rejestracja, reset hasła, ponowne wysłanie e-maila). */
export const rateLimits = pgTable(
  'rate_limits',
  {
    id: idColumn(),
    key: text().notNull(),
    count: integer().notNull(),
    lastRequest: bigint({ mode: 'number' }).notNull(),
  },
  (table) => [uniqueIndex('rate_limits_key_key').on(table.key)],
);

export const LEGAL_DOCUMENT_TYPES = ['TERMS', 'PRIVACY'] as const;

export const termsAcceptances = pgTable(
  'terms_acceptances',
  {
    id: idColumn(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    document: text().$type<(typeof LEGAL_DOCUMENT_TYPES)[number]>().notNull(),
    version: text().notNull(),
    acceptedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ip: text(),
  },
  (table) => [
    index().on(table.userId, table.document, table.acceptedAt),
    check('terms_acceptances_document_check', sql`${table.document} in ('TERMS', 'PRIVACY')`),
  ],
);

/**
 * Nieudane logowania (PROJECT.md §16.1): klucz `email:<adres>` albo `ip:<adres>`. Od 5. porażki
 * logowanie wymaga Turnstile i odczekania rosnącej przerwy; konto nie jest blokowane.
 */
export const loginFailures = pgTable(
  'login_failures',
  {
    key: text().primaryKey(),
    failures: integer().notNull(),
    lastFailureAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [index().on(table.lastFailureAt)],
);

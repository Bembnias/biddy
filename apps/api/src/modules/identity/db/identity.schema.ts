// Tabele modułu identity: konta i sesje Better Auth (users, sessions, accounts, verifications),
// limit zapytań Better Auth (rate_limits), akceptacje regulaminu, nieudane logowania,
// weryfikacje numeru telefonu (F-08) i adresy (F-10).
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
    /** Oświadczenie 18+: przy rejestracji e-mailem albo akceptacji regulaminu (Google, Apple). */
    isAdultDeclaredAt: timestamp({ withTimezone: true }),
    /** Zweryfikowany numer telefonu (E.164); jeden numer = jedno konto (F-08). */
    phoneNumber: text(),
    phoneNumberVerifiedAt: timestamp({ withTimezone: true }),
    status: text().$type<UserStatus>().notNull().default('ACTIVE'),
    staffRole: text().$type<StaffRole>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('users_email_key').on(table.email),
    uniqueIndex('users_phone_number_key').on(table.phoneNumber),
    check(
      'users_phone_number_check',
      sql`(${table.phoneNumber} is null) = (${table.phoneNumberVerifiedAt} is null)`,
    ),
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

/**
 * Kody SMS weryfikacji telefonu (F-08): HMAC kodu, licznik prób i termin. Z tej tabeli liczymy
 * limity wysyłki (per konto, numer i IP). Zweryfikowane wpisy zostają jako historia numerów
 * konta (sygnał powiązanych kont, F-36); niepotwierdzone usuwa job cykliczny po dobie.
 */
export const phoneVerifications = pgTable(
  'phone_verifications',
  {
    id: idColumn(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    phoneNumber: text().notNull(),
    codeHash: text().notNull(),
    ip: text(),
    attempts: integer().notNull().default(0),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    verifiedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index().on(table.userId, table.createdAt),
    index().on(table.phoneNumber, table.createdAt),
    index().on(table.ip, table.createdAt),
  ],
);

export type PhoneVerification = typeof phoneVerifications.$inferSelect;

/** Kraje adresów (MVP: Polska, przewoźnicy krajowi). */
export const ADDRESS_COUNTRIES = ['PL'] as const;
export type AddressCountry = (typeof ADDRESS_COUNTRIES)[number];

/**
 * Adresy użytkownika (F-10): dostawy i nadania. Najwyżej jeden domyślny adres dostawy i jeden
 * domyślny adres nadania na konto (indeksy unikalne częściowe). Zamówienia i przesyłki zapisują
 * kopię adresu, więc edycja i usunięcie nie zmieniają historii.
 */
export const addresses = pgTable(
  'addresses',
  {
    id: idColumn(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Imię i nazwisko albo nazwa firmy odbiorcy. */
    recipientName: text().notNull(),
    /** Ulica z numerem domu i lokalu. */
    street: text().notNull(),
    /** Kod pocztowy NN-NNN. */
    postalCode: text().notNull(),
    city: text().notNull(),
    country: text().$type<AddressCountry>().notNull().default('PL'),
    /** Telefon dla przewoźnika (E.164). */
    phone: text().notNull(),
    isDefault: boolean().notNull().default(false),
    isSenderDefault: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index().on(table.userId, table.createdAt),
    uniqueIndex('addresses_default_key')
      .on(table.userId)
      .where(sql`${table.isDefault}`),
    uniqueIndex('addresses_sender_default_key')
      .on(table.userId)
      .where(sql`${table.isSenderDefault}`),
    check('addresses_country_check', sql`${table.country} in ('PL')`),
  ],
);

export type Address = typeof addresses.$inferSelect;

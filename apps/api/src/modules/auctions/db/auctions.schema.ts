// Tabele modułu auctions: aukcje (F-14) i oferty (F-15); zamykanie w F-16.
// ID to UUIDv7 nadawane przez aplikację (ADR-10). Kwoty w groszach (bigint, PROJECT.md §13.1).
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
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { idColumn } from '../../../infra/db/ids.js';

/**
 * DRAFT → ACTIVE | PENDING_REVIEW (moderacja, F-35) → ACTIVE → ENDED_SOLD | ENDED_UNSOLD (F-16);
 * ACTIVE i PENDING_REVIEW → CANCELLED. SCHEDULED (planowany start) dojdzie w v1.
 */
export const AUCTION_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'ACTIVE',
  'ENDED_SOLD',
  'ENDED_UNSOLD',
  'CANCELLED',
] as const;
export type AuctionStatus = (typeof AUCTION_STATUSES)[number];

/** Dlaczego aukcja czeka na moderatora. */
export const REVIEW_REASONS = ['RESTRICTED_CATEGORY', 'WORD_FILTER'] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

const money = () => bigint({ mode: 'number' });

export const auctions = pgTable(
  'auctions',
  {
    id: idColumn(),
    /** Krótki publiczny identyfikator do adresu `/a/{slug}-{publicId}` (F-18). */
    publicId: text().notNull(),
    /** Przedmiot z modułu catalog (uuid bez FK między modułami). */
    itemId: uuid().notNull(),
    /** Sprzedający (konto z modułu identity). */
    sellerId: uuid().notNull(),
    type: text().$type<'TIMED'>().notNull().default('TIMED'),
    status: text().$type<AuctionStatus>().notNull().default('DRAFT'),
    currency: char({ length: 3 }).$type<CurrencyCode>().notNull().default('PLN'),
    startPrice: money(),
    /** Cena minimalna: ukryta przed kupującymi. */
    reservePrice: money(),
    buyNowPrice: money(),
    durationDays: integer(),
    /** Stan licytacji (F-15): aktualna cena, lider i jego ukryte maksimum, liczba ofert. */
    currentPrice: money(),
    leaderId: uuid(),
    leaderMaxAmount: money(),
    bidCount: integer().notNull().default(0),
    /** Ostatni numer oferty w aukcji (kolejność ofert niezależna od zegara, replay §15.6). */
    bidSequence: integer().notNull().default(0),
    reviewReasons: text()
      .array()
      .$type<ReviewReason[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Słowa z filtra, przez które aukcja trafiła do moderacji (dla moderatora, F-35). */
    reviewTerms: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    startsAt: timestamp({ withTimezone: true }),
    endsAt: timestamp({ withTimezone: true }),
    /** Koniec przed przedłużeniami anti-snipingu (F-15). */
    originalEndsAt: timestamp({ withTimezone: true }),
    publishedAt: timestamp({ withTimezone: true }),
    cancelledAt: timestamp({ withTimezone: true }),
    /** Licznik zmian (optymistyczne blokowanie i kolejność zdarzeń). */
    version: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('auctions_public_id_key').on(table.publicId),
    uniqueIndex('auctions_item_id_key').on(table.itemId),
    index().on(table.sellerId, table.status),
    index('auctions_active_ends_at_index')
      .on(table.endsAt)
      .where(sql`${table.status} = 'ACTIVE'`),
    check(
      'auctions_status_check',
      sql`${table.status} in ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'ENDED_SOLD', 'ENDED_UNSOLD', 'CANCELLED')`,
    ),
    check(
      'auctions_prices_check',
      sql`(${table.startPrice} is null or ${table.startPrice} >= 0) and (${table.reservePrice} is null or ${table.reservePrice} >= 0) and (${table.buyNowPrice} is null or ${table.buyNowPrice} >= 0)`,
    ),
    check(
      'auctions_published_check',
      sql`${table.status} in ('DRAFT', 'PENDING_REVIEW', 'CANCELLED') or (${table.startsAt} is not null and ${table.endsAt} is not null and ${table.startPrice} is not null)`,
    ),
  ],
);

export type Auction = typeof auctions.$inferSelect;

/** Oferta ręczna, automatyczna odpowiedź lidera (licytacja automatyczna) albo Kup teraz. */
export const BID_KINDS = ['MANUAL', 'AUTO', 'BUY_NOW'] as const;
export type BidKind = (typeof BID_KINDS)[number];

export const BID_STATUSES = ['VALID', 'CANCELLED'] as const;
export type BidStatus = (typeof BID_STATUSES)[number];

/** Literówka (support), oszustwo (np. shill bidding), pochodna przeliczenia (replay, §15.6). */
export const BID_CANCEL_REASONS = ['TYPO', 'FRAUD', 'REPLAY'] as const;
export type BidCancelReason = (typeof BID_CANCEL_REASONS)[number];

/** Oferty (F-15, §15.1). Kwoty w groszach; `max_amount` jest tajne (licytacja automatyczna). */
export const bids = pgTable(
  'bids',
  {
    id: idColumn(),
    auctionId: uuid()
      .notNull()
      .references(() => auctions.id),
    /** Licytujący (konto z modułu identity; uuid bez FK między modułami). */
    bidderId: uuid().notNull(),
    /** Numer kolejny w aukcji: kolejność rozstrzygania niezależna od zegarów serwerów. */
    sequence: integer().notNull(),
    amount: money().notNull(),
    maxAmount: money().notNull(),
    kind: text().$type<BidKind>().notNull(),
    status: text().$type<BidStatus>().notNull().default('VALID'),
    cancelReason: text().$type<BidCancelReason>(),
    /** Personel, który unieważnił ofertę (null dla REPLAY). */
    cancelledBy: uuid(),
    cancelledAt: timestamp({ withTimezone: true }),
    /** Nagłówek Idempotency-Key żądania (tylko oferty ręczne i Kup teraz). */
    idempotencyKey: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('bids_auction_id_sequence_key').on(table.auctionId, table.sequence),
    uniqueIndex('bids_bidder_id_idempotency_key_key').on(table.bidderId, table.idempotencyKey),
    index().on(table.bidderId, table.status),
    check('bids_kind_check', sql`${table.kind} in ('MANUAL', 'AUTO', 'BUY_NOW')`),
    check('bids_status_check', sql`${table.status} in ('VALID', 'CANCELLED')`),
    check(
      'bids_cancel_check',
      sql`(${table.status} = 'CANCELLED') = (${table.cancelReason} is not null)`,
    ),
    check('bids_amount_check', sql`${table.amount} >= 0 and ${table.amount} <= ${table.maxAmount}`),
  ],
);

export type Bid = typeof bids.$inferSelect;

/** Obserwowane aukcje (F-20): powiadomienie przed końcem, lista w Moje Biddy (F-21). */
export const watchlist = pgTable(
  'watchlist',
  {
    /** Konto z modułu identity (uuid bez FK między modułami). */
    userId: uuid().notNull(),
    auctionId: uuid()
      .notNull()
      .references(() => auctions.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.auctionId] }),
    index().on(table.auctionId),
  ],
);

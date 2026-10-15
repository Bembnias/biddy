// Eventy domenowe modułu auctions (F-14, PROJECT.md §14.3). Konsumenci: wyszukiwarka (F-19),
// powiadomienia, strike'i (F-61), moderacja (F-35), rewalidacja stron (F-18).
import { CURRENCIES, type CurrencyCode } from '@biddy/shared';
import { z } from 'zod';

import { defineDomainEvent } from '../../infra/outbox/index.js';
import { REVIEW_REASONS } from './db/auctions.schema.js';

const money = z.object({
  amount: z.int().nonnegative(),
  currency: z.enum(Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]]),
});

/** Aukcja jest aktywna: przyjmuje oferty do `endsAt`. */
export const AuctionPublished = defineDomainEvent({
  type: 'AuctionPublished',
  version: 1,
  aggregateType: 'auction',
  payload: z.object({
    sellerId: z.uuid(),
    itemId: z.uuid(),
    categoryId: z.uuid(),
    startPrice: money,
    buyNowPrice: money.nullable(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
  }),
});

/** Aukcja czeka na moderatora (kategoria z ograniczeniami albo filtr słów). */
export const AuctionSubmittedForReview = defineDomainEvent({
  type: 'AuctionSubmittedForReview',
  version: 1,
  aggregateType: 'auction',
  payload: z.object({
    sellerId: z.uuid(),
    itemId: z.uuid(),
    reasons: z.array(z.enum(REVIEW_REASONS)),
    terms: z.array(z.string()),
  }),
});

/** Sprzedający zmienił aktywną aukcję (przed pierwszą ofertą): reindeks i rewalidacja strony. */
export const AuctionUpdated = defineDomainEvent({
  type: 'AuctionUpdated',
  version: 1,
  aggregateType: 'auction',
  payload: z.object({ sellerId: z.uuid(), version: z.int().min(0) }),
});

/** Aukcja anulowana; `bidCount > 0` oznacza strike sprzedającego (F-61) i powiadomienia. */
export const AuctionCancelled = defineDomainEvent({
  type: 'AuctionCancelled',
  version: 1,
  aggregateType: 'auction',
  payload: z.object({
    sellerId: z.uuid(),
    bidCount: z.int().min(0),
    previousStatus: z.enum(['ACTIVE', 'PENDING_REVIEW']),
    cancelledBy: z.enum(['SELLER']),
  }),
});

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

/**
 * Aukcja anulowana przez sprzedającego (`bidCount > 0`: strike, F-61) albo moderatora (z
 * uzasadnieniem; strike tylko z decyzji moderatora). Licytujący dostają powiadomienie.
 */
export const AuctionCancelled = defineDomainEvent({
  type: 'AuctionCancelled',
  version: 1,
  aggregateType: 'auction',
  payload: z.object({
    sellerId: z.uuid(),
    bidCount: z.int().min(0),
    previousStatus: z.enum(['ACTIVE', 'PENDING_REVIEW']),
    cancelledBy: z.enum(['SELLER', 'MODERATOR']),
    /** Uzasadnienie moderatora (DSA: statement of reasons, F-35). */
    reason: z.string().min(1).max(500).optional(),
  }),
});

/** Przyjęta oferta (F-15): nowy stan aukcji. Maksima licytujących nie trafiają do eventu. */
export const BidPlaced = defineDomainEvent({
  type: 'BidPlaced',
  version: 1,
  aggregateType: 'auction',
  payload: z.object({
    bidId: z.uuid(),
    bidderId: z.uuid(),
    kind: z.enum(['MANUAL', 'BUY_NOW']),
    currentPrice: money,
    leaderId: z.uuid(),
    bidCount: z.int().min(1),
    endsAt: z.iso.datetime(),
    reserveMet: z.boolean().nullable(),
  }),
});

/** Poprzedni lider stracił prowadzenie (powiadomienie „przebito Cię”). */
export const UserOutbid = defineDomainEvent({
  type: 'UserOutbid',
  version: 1,
  aggregateType: 'auction',
  payload: z.object({
    userId: z.uuid(),
    currentPrice: money,
    endsAt: z.iso.datetime(),
  }),
});

/** Anti-sniping (§6.5): oferta w końcówce przesunęła koniec aukcji (F-16 planuje nowy job). */
export const AuctionExtended = defineDomainEvent({
  type: 'AuctionExtended',
  version: 1,
  aggregateType: 'auction',
  payload: z.object({
    previousEndsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
  }),
});

/** Aukcja zakończona: Kup teraz (F-15) albo czas (F-16). */
export const AuctionEnded = defineDomainEvent({
  type: 'AuctionEnded',
  version: 1,
  aggregateType: 'auction',
  payload: z.object({
    sellerId: z.uuid(),
    outcome: z.enum(['SOLD', 'UNSOLD']),
    winnerId: z.uuid().nullable(),
    finalPrice: money.nullable(),
    endedBy: z.enum(['BUY_NOW', 'TIME']),
    endedAt: z.iso.datetime(),
  }),
});

/** Unieważniona oferta (§15.6) i stan aukcji po przeliczeniu od zera. */
export const BidCancelled = defineDomainEvent({
  type: 'BidCancelled',
  version: 1,
  aggregateType: 'auction',
  payload: z.object({
    bidId: z.uuid(),
    bidderId: z.uuid(),
    reason: z.enum(['TYPO', 'FRAUD']),
    cancelledBy: z.uuid(),
    previousLeaderId: z.uuid().nullable(),
    leaderId: z.uuid().nullable(),
    currentPrice: money.nullable(),
    bidCount: z.int().min(0),
  }),
});

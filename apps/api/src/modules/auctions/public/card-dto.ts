// Karta aukcji w listach Moje Biddy (F-21).
import { z } from 'zod';

import { AUCTION_STATUSES } from '../db/auctions.schema.js';
import type { AuctionCard } from './auction-cards.js';

export const auctionCardSchema = z.object({
  id: z.uuid(),
  publicId: z.string().min(1),
  slug: z.string().min(1),
  title: z.string(),
  status: z.enum(AUCTION_STATUSES),
  currency: z.enum(['PLN']),
  price: z.int().describe('Aktualna albo wywoławcza cena (grosze)'),
  currentPrice: z.int().nullable(),
  bidCount: z.int().min(0),
  endsAt: z.iso.datetime().nullable(),
  coverUrl: z.url().nullable().describe('Zdjęcie główne, 800 px'),
  coverThumbUrl: z.url().nullable().describe('Zdjęcie główne, 320 px'),
});

export type AuctionCardDto = z.infer<typeof auctionCardSchema>;

export function auctionCardDto({ auction, title, slug, cover }: AuctionCard): AuctionCardDto {
  return {
    id: auction.id,
    publicId: auction.publicId,
    slug,
    title,
    status: auction.status,
    currency: auction.currency,
    price: auction.currentPrice ?? auction.startPrice ?? 0,
    currentPrice: auction.currentPrice,
    bidCount: auction.bidCount,
    endsAt: auction.endsAt?.toISOString() ?? null,
    coverUrl: cover?.medium ?? null,
    coverThumbUrl: cover?.thumb ?? null,
  };
}

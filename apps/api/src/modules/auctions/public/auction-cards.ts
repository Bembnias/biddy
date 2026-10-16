// Karty aukcji do list (Moje Biddy, F-21): tytuł, slug i zdjęcie główne dla wielu aukcji różnych
// sprzedających naraz (przedmioty jednym zapytaniem, zdjęcia według sprzedającego).
import { auctionSlug } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';

import { ItemService } from '../../catalog/index.js';
import { MediaService } from '../../media/index.js';
import type { Auction } from '../db/auctions.schema.js';

export interface AuctionCard {
  readonly auction: Auction;
  readonly title: string;
  readonly slug: string;
  /** Zdjęcie główne (warianty 320 i 800 px) albo null. */
  readonly cover: { readonly thumb: string; readonly medium: string } | null;
}

@Injectable()
export class AuctionCards {
  constructor(
    @Inject(ItemService) private readonly items: ItemService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  async cards(auctions: readonly Auction[]): Promise<AuctionCard[]> {
    const items = new Map(
      (await this.items.getMany(auctions.map((auction) => auction.itemId))).map((item) => [
        item.id,
        item,
      ]),
    );
    const coversBySeller = new Map<string, string[]>();
    for (const auction of auctions) {
      const cover = items.get(auction.itemId)?.mediaIds[0];
      if (cover !== undefined) {
        coversBySeller.set(auction.sellerId, [
          ...(coversBySeller.get(auction.sellerId) ?? []),
          cover,
        ]);
      }
    }
    const covers = new Map<string, { thumb: string; medium: string }>();
    for (const [sellerId, mediaIds] of coversBySeller) {
      for (const photo of await this.media.describe(sellerId, mediaIds)) {
        const thumb = photo.urls?.['thumb'];
        const medium = photo.urls?.['medium'];
        if (photo.status === 'READY' && thumb !== undefined && medium !== undefined) {
          covers.set(photo.id, { thumb, medium });
        }
      }
    }
    return auctions.map((auction) => {
      const item = items.get(auction.itemId);
      const cover = item?.mediaIds[0];
      return {
        auction,
        title: item?.title ?? '',
        slug: auctionSlug(item?.title),
        cover: (cover === undefined ? undefined : covers.get(cover)) ?? null,
      };
    });
  }
}

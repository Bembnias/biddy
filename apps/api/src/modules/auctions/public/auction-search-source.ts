// Dane aktywnych aukcji dla indeksu wyszukiwarki (F-19, moduł search): aukcja, przedmiot,
// ścieżka kategorii, atrybuty do wyświetlenia i zdjęcie główne, partiami (nocny reindeks czyta
// wszystkie aktywne aukcje). Bez maksimów, ceny minimalnej i danych licytujących.
import { auctionSlug, type CurrencyCode, type DescribedAttribute } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import {
  type CategoryCrumb,
  CategoryService,
  type ItemDetails,
  ItemService,
} from '../../catalog/index.js';
import { MediaService } from '../../media/index.js';
import { auctions } from '../db/auctions.schema.js';

/** Aktywna aukcja do zaindeksowania. */
export interface AuctionSearchEntry {
  readonly id: string;
  readonly publicId: string;
  readonly slug: string;
  readonly sellerId: string;
  readonly currency: CurrencyCode;
  readonly startPrice: number;
  readonly currentPrice: number | null;
  readonly bidCount: number;
  /** Cena Kup teraz, gdy dostępne (do pierwszej oferty). */
  readonly buyNowPrice: number | null;
  readonly endsAt: Date;
  readonly publishedAt: Date;
  readonly updatedAt: Date;
  readonly item: ItemDetails;
  readonly category: readonly CategoryCrumb[];
  readonly attributes: readonly DescribedAttribute[];
  /** Zdjęcie główne (warianty 320 i 800 px) albo null. */
  readonly cover: { readonly thumb: string; readonly medium: string } | null;
}

@Injectable()
export class AuctionSearchSource {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(ItemService) private readonly items: ItemService,
    @Inject(CategoryService) private readonly categories: CategoryService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  /** Aktywne aukcje spośród `auctionIds` (pozostałe pomija: do usunięcia z indeksu). */
  async entries(auctionIds: readonly string[]): Promise<AuctionSearchEntry[]> {
    if (auctionIds.length === 0) {
      return [];
    }
    const rows = await this.db
      .select()
      .from(auctions)
      .where(and(inArray(auctions.id, [...auctionIds]), eq(auctions.status, 'ACTIVE')));
    if (rows.length === 0) {
      return [];
    }
    const [items, lookup] = await Promise.all([
      this.items.getMany(rows.map((row) => row.itemId)),
      this.categories.lookup(),
    ]);
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const covers = new Map<string, { thumb: string; medium: string }>();
    for (const [sellerId, mediaIds] of groupBy(
      rows.flatMap((row) => {
        const cover = itemsById.get(row.itemId)?.mediaIds[0];
        return cover === undefined ? [] : [[row.sellerId, cover] as const];
      }),
    )) {
      for (const photo of await this.media.describe(sellerId, mediaIds)) {
        const thumb = photo.urls?.['thumb'];
        const medium = photo.urls?.['medium'];
        if (photo.status === 'READY' && thumb !== undefined && medium !== undefined) {
          covers.set(photo.id, { thumb, medium });
        }
      }
    }
    return rows.flatMap((row) => {
      const item = itemsById.get(row.itemId);
      if (item === undefined || row.endsAt === null || row.publishedAt === null) {
        return [];
      }
      const cover = item.mediaIds[0];
      return [
        {
          id: row.id,
          publicId: row.publicId,
          slug: auctionSlug(item.title),
          sellerId: row.sellerId,
          currency: row.currency,
          startPrice: row.startPrice ?? 0,
          currentPrice: row.currentPrice,
          bidCount: row.bidCount,
          buyNowPrice: row.bidCount === 0 ? row.buyNowPrice : null,
          endsAt: row.endsAt,
          publishedAt: row.publishedAt,
          updatedAt: row.updatedAt,
          item,
          category: item.categoryId === null ? [] : lookup.pathNodes(item.categoryId),
          attributes:
            item.categoryId === null
              ? []
              : lookup.describeAttributes(item.categoryId, item.attributes),
          cover: (cover === undefined ? undefined : covers.get(cover)) ?? null,
        },
      ];
    });
  }

  /** Identyfikatory aktywnych aukcji po `after` (stronicowanie po ID, nocny reindeks). */
  async activeIds(after: string | null, limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: auctions.id })
      .from(auctions)
      .where(
        and(eq(auctions.status, 'ACTIVE'), after === null ? undefined : gt(auctions.id, after)),
      )
      .orderBy(asc(auctions.id))
      .limit(limit);
    return rows.map((row) => row.id);
  }
}

function groupBy(pairs: readonly (readonly [string, string])[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const [key, value] of pairs) {
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  return groups;
}

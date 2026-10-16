// Dokument aukcji w indeksie Meilisearch (F-19, PROJECT.md §15.5) i ustawienia indeksu. Indeks
// zawiera tylko aktywne aukcje; po zakończeniu albo anulowaniu dokument jest usuwany.
import type { MeiliSettings } from '../../../infra/search/index.js';
import type { AuctionSearchEntry } from '../../auctions/index.js';

export interface AuctionDocument {
  readonly id: string;
  readonly publicId: string;
  readonly slug: string;
  readonly status: 'ACTIVE';
  readonly title: string;
  readonly description: string;
  readonly brand: string | null;
  /** Kategorie od głównej do kategorii przedmiotu (filtr obejmuje podkategorie). */
  readonly categoryIds: readonly string[];
  readonly categoryPath: readonly string[];
  /** Zapisane wartości atrybutów (filtry i fasety `attributes.{klucz}`). */
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
  /** Atrybuty do wyszukiwania pełnotekstowego, np. „Rozmiar: 42 EU”. */
  readonly attributeText: readonly string[];
  readonly condition: string | null;
  readonly currency: string;
  /** Aktualna cena albo wywoławcza (sortowanie i filtr ceny). */
  readonly price: number;
  readonly startPrice: number;
  readonly currentPrice: number | null;
  readonly bidCount: number;
  readonly buyNowPrice: number | null;
  readonly endsAt: string;
  readonly endsAtTs: number;
  readonly publishedAtTs: number;
  readonly updatedAt: string;
  readonly sellerId: string;
  readonly carriers: readonly string[];
  readonly coverThumb: string | null;
  readonly coverMedium: string | null;
}

/** Pola karty aukcji w wynikach (bez opisu i atrybutów). */
export const CARD_FIELDS = [
  'id',
  'publicId',
  'slug',
  'title',
  'condition',
  'currency',
  'price',
  'currentPrice',
  'bidCount',
  'buyNowPrice',
  'endsAt',
  'coverThumb',
  'coverMedium',
] as const satisfies readonly (keyof AuctionDocument)[];

export type AuctionCard = Pick<AuctionDocument, (typeof CARD_FIELDS)[number]>;

/** Najwięcej wyników jednego zapytania (paginacja Meilisearch). */
export const MAX_TOTAL_HITS = 1000;

export const AUCTION_INDEX_SETTINGS: MeiliSettings = {
  // Kolejność ważności pól przy dopasowaniu (reguła rankingu `attribute`).
  searchableAttributes: ['title', 'brand', 'attributeText', 'categoryPath', 'description'],
  filterableAttributes: [
    'status',
    'categoryIds',
    'condition',
    'attributes',
    'price',
    'endsAtTs',
    'sellerId',
    'buyNowPrice',
  ],
  sortableAttributes: ['endsAtTs', 'publishedAtTs', 'price', 'bidCount'],
  pagination: { maxTotalHits: MAX_TOTAL_HITS },
  faceting: { maxValuesPerFacet: 100 },
};

/** Nazwa indeksu aukcji, np. `biddy-auctions`. */
export function auctionIndexName(prefix: string): string {
  return `${prefix}-auctions`;
}

export function toAuctionDocument(entry: AuctionSearchEntry): AuctionDocument {
  const { item } = entry;
  return {
    id: entry.id,
    publicId: entry.publicId,
    slug: entry.slug,
    status: 'ACTIVE',
    title: item.title ?? '',
    description: item.description ?? '',
    brand: item.brand,
    categoryIds: entry.category.map((crumb) => crumb.id),
    categoryPath: entry.category.map((crumb) => crumb.name),
    attributes: { ...item.attributes },
    attributeText: entry.attributes.map((attribute) => `${attribute.label}: ${attribute.value}`),
    condition: item.condition,
    currency: entry.currency,
    price: entry.currentPrice ?? entry.startPrice,
    startPrice: entry.startPrice,
    currentPrice: entry.currentPrice,
    bidCount: entry.bidCount,
    buyNowPrice: entry.buyNowPrice,
    endsAt: entry.endsAt.toISOString(),
    endsAtTs: entry.endsAt.getTime(),
    publishedAtTs: entry.publishedAt.getTime(),
    updatedAt: entry.updatedAt.toISOString(),
    sellerId: entry.sellerId,
    carriers: [...item.allowedCarriers],
    coverThumb: entry.cover?.thumb ?? null,
    coverMedium: entry.cover?.medium ?? null,
  };
}

// Sitemap (F-19): strona główna, kategorie i aktywne aukcje (z indeksu wyszukiwarki, najnowsze
// najpierw, do 50 000). Renderowana przy żądaniu z danych w cache (10 min), a nie przy buildzie:
// sitemap zbudowany bez dostępu do API byłby pusty aż do rewalidacji. Błąd API: bez aukcji.
import { getSitemapAuctions } from '@biddy/api-client';
import type { MetadataRoute } from 'next';

import { config } from '@/config';
import { auctionUrl, categoryUrl, routes } from '@/lib/routes';
import { loadCategories } from '@/lib/search/load';

export const dynamic = 'force-dynamic';

const DATA_REVALIDATE_SECONDS = 600;

async function activeAuctions() {
  try {
    return (await getSitemapAuctions({ next: { revalidate: DATA_REVALIDATE_SECONDS } })).items;
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const absolute = (path: string) => new URL(path, config.siteUrl).toString();
  const [categories, auctions] = await Promise.all([loadCategories(), activeAuctions()]);
  return [
    { url: absolute(routes.home), changeFrequency: 'hourly', priority: 1 },
    ...categories.map((category) => ({
      url: absolute(categoryUrl(category.path)),
      changeFrequency: 'hourly' as const,
      priority: 0.7,
    })),
    ...auctions.map((auction) => ({
      url: absolute(auctionUrl(auction)),
      lastModified: auction.updatedAt,
      changeFrequency: 'hourly' as const,
      priority: 0.5,
    })),
  ];
}

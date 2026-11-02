// Dane strukturalne strony aukcji (F-18, PROJECT.md §11.3): schema.org Product z Offer, żeby
// wyszukiwarki pokazywały cenę i dostępność. Treść pochodzi od użytkownika, więc JSON w <script>
// escapujemy (bez `</script>` i komentarzy HTML).
import type { PublicAuctionDto } from '@biddy/api-client';
import { toDecimalString } from '@biddy/shared';

const CONDITIONS: Record<NonNullable<PublicAuctionDto['condition']>, string> = {
  NEW: 'https://schema.org/NewCondition',
  LIKE_NEW: 'https://schema.org/UsedCondition',
  VERY_GOOD: 'https://schema.org/UsedCondition',
  GOOD: 'https://schema.org/UsedCondition',
  FAIR: 'https://schema.org/UsedCondition',
  FOR_PARTS: 'https://schema.org/DamagedCondition',
};

const AVAILABILITY: Record<PublicAuctionDto['status'], string> = {
  ACTIVE: 'https://schema.org/InStock',
  ENDED_SOLD: 'https://schema.org/SoldOut',
  ENDED_UNSOLD: 'https://schema.org/OutOfStock',
  CANCELLED: 'https://schema.org/OutOfStock',
};

/** Product + Offer dla aukcji; `url` to adres kanoniczny strony. */
export function productJsonLd(auction: PublicAuctionDto, url: string): Record<string, unknown> {
  const price = auction.currentPrice ?? auction.startPrice;
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: auction.title,
    description: auction.description,
    image: auction.photos.map((photo) => photo.urls.large),
    sku: auction.publicId,
    ...(auction.brand === null ? {} : { brand: { '@type': 'Brand', name: auction.brand } }),
    ...(auction.category.length === 0
      ? {}
      : { category: auction.category.map((crumb) => crumb.name).join(' > ') }),
    offers: {
      '@type': 'Offer',
      url,
      price: toDecimalString({ amount: price, currency: auction.currency }),
      priceCurrency: auction.currency,
      availability: AVAILABILITY[auction.status],
      ...(auction.condition === null ? {} : { itemCondition: CONDITIONS[auction.condition] }),
      ...(auction.endsAt === null ? {} : { priceValidUntil: auction.endsAt.slice(0, 10) }),
      seller: { '@type': 'Person', name: auction.seller.name },
    },
  };
}

/** JSON do `<script type="application/ld+json">`: `<`, `>` i `&` jako sekwencje \u. */
export function jsonLdText(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</gu, '\\u003c')
    .replace(/>/gu, '\\u003e')
    .replace(/&/gu, '\\u0026');
}

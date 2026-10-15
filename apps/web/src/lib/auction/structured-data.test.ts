import { describe, expect, it } from 'vitest';

import { publicAuction } from '@/test/auctions';

import { jsonLdText, productJsonLd } from './structured-data';

describe('productJsonLd', () => {
  it('Product z Offer: cena aktualna albo wywoławcza, dostępność, stan, sprzedawca', () => {
    const url = 'https://biddy.pl/a/wazon-ceramiczny-k3x9qa7m';
    const auction = publicAuction({ endsAt: '2026-10-20T18:00:00.000Z' });
    expect(productJsonLd(auction, url)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Wazon ceramiczny',
      description: 'Ręcznie malowany wazon, bez pęknięć.',
      image: ['https://media.test/1-large.webp'],
      sku: 'k3x9qa7m',
      category: 'Dom i ogród > Dekoracje',
      offers: {
        '@type': 'Offer',
        url,
        price: '20.00',
        priceCurrency: 'PLN',
        availability: 'https://schema.org/InStock',
        itemCondition: 'https://schema.org/UsedCondition',
        priceValidUntil: '2026-10-20',
        seller: { '@type': 'Person', name: 'Sprzedawca Testowy' },
      },
    });
    const sold = productJsonLd(
      publicAuction({ status: 'ENDED_SOLD', currentPrice: 4_550, brand: 'Ćmielów' }),
      url,
    );
    expect(sold).toMatchObject({
      brand: { '@type': 'Brand', name: 'Ćmielów' },
      offers: { price: '45.50', availability: 'https://schema.org/SoldOut' },
    });
  });

  it('JSON w <script> bez zamykającego tagu z treści użytkownika', () => {
    const text = jsonLdText({ name: 'Wazon </script><script>alert(1)</script> & <!--' });
    expect(text).not.toContain('</script>');
    expect(text).not.toContain('<!--');
    expect(JSON.parse(text)).toEqual({
      name: 'Wazon </script><script>alert(1)</script> & <!--',
    });
  });
});

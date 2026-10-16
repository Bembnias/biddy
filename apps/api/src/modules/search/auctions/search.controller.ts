import { ITEM_CONDITIONS, type ItemCondition } from '@biddy/shared';
import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import type { AuctionCard } from './auction-document.js';
import { SEARCH_SORTS } from './auction-query.js';
import { type AuctionSearchResult, AuctionSearchService } from './auction-search.service.js';

/** ?x=a (jedna wartość) przychodzi jako tekst, ?x=a&x=b jako tablica. */
function repeated<T extends z.ZodType>(item: T, max: number) {
  return z.preprocess(
    (value) => (typeof value === 'string' ? [value] : value),
    z.array(item).max(max),
  );
}

const amount = () => z.coerce.number().int().min(0).max(100_000_000_000).describe('Grosze');

class SearchAuctionsQuery extends createZodDto(
  z.object({
    q: z.string().trim().max(200).optional().describe('Szukany tekst (tolerancja literówek)'),
    category: z.uuid().optional().describe('Kategoria (z podkategoriami)'),
    condition: repeated(z.enum(ITEM_CONDITIONS), ITEM_CONDITIONS.length)
      .optional()
      .describe('Stan przedmiotu (parametr można powtórzyć)'),
    priceMin: amount().optional(),
    priceMax: amount().optional(),
    attr: repeated(z.string().min(2).max(100), 30)
      .optional()
      .describe(
        'Filtr atrybutu kategorii: klucz:wartość (opcja, true/false) albo klucz:od..do (liczba); parametr można powtórzyć',
      ),
    seller: z.uuid().optional().describe('Aukcje jednego sprzedawcy'),
    sort: z
      .enum(SEARCH_SORTS)
      .optional()
      .describe('Domyślnie relevance z zapytaniem, ending bez zapytania'),
    page: z.coerce.number().int().min(1).max(1000).optional(),
    pageSize: z.coerce.number().int().min(1).max(48).optional(),
  }),
) {}

const cardSchema = z.object({
  id: z.uuid(),
  publicId: z.string().min(1),
  slug: z.string().min(1),
  title: z.string(),
  condition: z.enum(ITEM_CONDITIONS).nullable(),
  currency: z.enum(['PLN']),
  price: z.int().describe('Aktualna albo wywoławcza cena (grosze)'),
  currentPrice: z.int().nullable().describe('Aktualna cena albo null (brak ofert)'),
  bidCount: z.int().min(0),
  buyNowPrice: z.int().nullable().describe('Cena Kup teraz, gdy dostępne'),
  endsAt: z.iso.datetime(),
  coverUrl: z.url().nullable().describe('Zdjęcie główne, 800 px'),
  coverThumbUrl: z.url().nullable().describe('Zdjęcie główne, 320 px'),
});

const range = z.object({ min: z.number(), max: z.number() });

export class AuctionSearchDto extends createZodDto(
  z.object({
    items: z.array(cardSchema),
    total: z.int().min(0).describe('Liczba wyników (najwyżej 1000)'),
    totalPages: z.int().min(0),
    page: z.int().min(1),
    pageSize: z.int().min(1),
    sort: z.enum(SEARCH_SORTS),
    facets: z.object({
      categories: z
        .array(
          z.object({
            id: z.uuid(),
            slug: z.string(),
            name: z.string(),
            path: z.array(z.string()).describe('Slugi od kategorii głównej'),
            count: z.int().min(1),
          }),
        )
        .describe('Podkategorie wybranej kategorii (albo kategorie główne) z liczbą aukcji'),
      conditions: z.array(z.object({ value: z.enum(ITEM_CONDITIONS), count: z.int().min(1) })),
      price: range.nullable().describe('Zakres cen w wynikach (grosze)'),
      attributes: z
        .array(
          z.object({
            key: z.string(),
            label: z.string(),
            type: z.enum(['select', 'boolean', 'number']),
            unit: z.string().min(1).nullable().describe('Jednostka liczby, np. EU'),
            options: z.array(
              z.object({ value: z.string(), label: z.string(), count: z.int().min(1) }),
            ),
            range: range.nullable().describe('Zakres wartości liczbowych w wynikach'),
          }),
        )
        .describe('Atrybuty wybranej kategorii (bez kategorii: puste)'),
    }),
  }),
) {}

export class SitemapAuctionsDto extends createZodDto(
  z.object({
    items: z.array(
      z.object({ publicId: z.string(), slug: z.string(), updatedAt: z.iso.datetime() }),
    ),
  }),
) {}

type AuctionCardDto = z.infer<typeof cardSchema>;

function cardDto(card: AuctionCard): AuctionCardDto {
  return {
    id: card.id,
    publicId: card.publicId,
    slug: card.slug,
    title: card.title,
    condition: card.condition as ItemCondition | null,
    currency: 'PLN',
    price: card.price,
    currentPrice: card.currentPrice,
    bidCount: card.bidCount,
    buyNowPrice: card.buyNowPrice,
    endsAt: card.endsAt,
    coverUrl: card.coverMedium,
    coverThumbUrl: card.coverThumb,
  };
}

function toDto(result: AuctionSearchResult): AuctionSearchDto {
  return {
    items: result.items.map(cardDto),
    total: result.total,
    totalPages: result.totalPages,
    page: result.page,
    pageSize: result.pageSize,
    sort: result.sort,
    facets: {
      categories: result.categories.map((node) => ({
        id: node.id,
        slug: node.slug,
        name: node.name,
        path: [...node.path],
        count: node.count,
      })),
      conditions: result.conditions.map((entry) => ({ ...entry })),
      price: result.price === null ? null : { ...result.price },
      attributes: result.attributes.map(({ definition, options, range }) => ({
        key: definition.key,
        label: definition.label,
        type: definition.type,
        unit: definition.type === 'number' ? (definition.unit ?? null) : null,
        options: options.map((option) => ({ ...option })),
        range: range === null ? null : { ...range },
      })),
    },
  };
}

/** Wyszukiwarka aukcji (F-19). */
@ApiTags('search')
@Controller()
export class SearchController {
  constructor(private readonly search: AuctionSearchService) {}

  @Get('auctions')
  @Header('cache-control', 'public, max-age=10')
  @ApiOperation({
    summary: 'Wyszukiwanie aukcji',
    description:
      'Aktywne aukcje z filtrami, fasetami i sortowaniem. Filtry atrybutów tylko z atrybutów wybranej kategorii.',
  })
  @ZodResponse({ status: 200, description: 'Wyniki', type: AuctionSearchDto })
  async searchAuctions(@Query() query: SearchAuctionsQuery): Promise<AuctionSearchDto> {
    return toDto(
      await this.search.search({
        q: query.q,
        categoryId: query.category,
        conditions: query.condition,
        priceMin: query.priceMin,
        priceMax: query.priceMax,
        attributes: query.attr,
        sellerId: query.seller,
        sort: query.sort,
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 24,
      }),
    );
  }

  @Get('sitemap/auctions')
  @Header('cache-control', 'public, max-age=300')
  @ApiOperation({
    summary: 'Aktywne aukcje do sitemap',
    description: 'Najnowsze najpierw, najwyżej 50 000.',
  })
  @ZodResponse({ status: 200, description: 'Aukcje', type: SitemapAuctionsDto })
  async getSitemapAuctions(): Promise<SitemapAuctionsDto> {
    return { items: await this.search.sitemap() };
  }
}

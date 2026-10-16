// Wyszukiwanie aukcji (F-19): zapytanie do Meilisearch z filtrami i fasetami. Fasety atrybutów
// pochodzą ze schematu wybranej kategorii (F-11), więc filtry odpowiadają kategorii.
import { ITEM_CONDITIONS, type ItemCondition } from '@biddy/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../../infra/config/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { MeiliClient, MeiliError, type MeiliSearchResponse } from '../../../infra/search/index.js';
import { type CategoryNode, CategoryService } from '../../catalog/index.js';
import { type AuctionCard, CARD_FIELDS, auctionIndexName } from './auction-document.js';
import {
  AttributeFilterError,
  type FacetableAttribute,
  type SearchSort,
  buildFilter,
  effectiveSort,
  isFacetable,
  parseAttributeFilters,
  sortRules,
} from './auction-query.js';

export interface AuctionSearchParams {
  readonly q?: string | undefined;
  readonly categoryId?: string | undefined;
  readonly conditions?: readonly ItemCondition[] | undefined;
  readonly priceMin?: number | undefined;
  readonly priceMax?: number | undefined;
  readonly attributes?: readonly string[] | undefined;
  readonly sellerId?: string | undefined;
  readonly sort?: SearchSort | undefined;
  readonly page: number;
  readonly pageSize: number;
}

export interface AttributeFacet {
  readonly definition: FacetableAttribute;
  /** Opcje (wybór, tak/nie) z liczbą aukcji; puste dla liczb. */
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
    readonly count: number;
  }[];
  /** Zakres wartości liczbowych w wynikach albo null. */
  readonly range: { readonly min: number; readonly max: number } | null;
}

export interface AuctionSearchResult {
  readonly items: readonly AuctionCard[];
  readonly total: number;
  readonly totalPages: number;
  readonly page: number;
  readonly pageSize: number;
  readonly sort: SearchSort;
  readonly categories: readonly (CategoryNode & { readonly count: number })[];
  readonly conditions: readonly { readonly value: ItemCondition; readonly count: number }[];
  readonly price: { readonly min: number; readonly max: number } | null;
  readonly attributes: readonly AttributeFacet[];
}

export interface SitemapAuction {
  readonly publicId: string;
  readonly slug: string;
  readonly updatedAt: string;
}

/** Najwięcej aukcji w sitemap (limit jednego pliku sitemap). */
export const SITEMAP_LIMIT = 50_000;
const SITEMAP_BATCH = 1_000;

const BOOLEAN_LABELS: Record<string, string> = { true: 'Tak', false: 'Nie' };

/** Błędy zapytania, które zwraca też indeks bez ustawień (zaraz po utworzeniu). */
const INVALID_QUERY_CODES = new Set([
  'invalid_search_filter',
  'invalid_search_facets',
  'invalid_search_sort',
]);

function unavailable(error: unknown): DomainError {
  return new DomainError({
    code: 'SERVICE_UNAVAILABLE',
    detail: 'Wyszukiwarka jest chwilowo niedostępna. Spróbuj ponownie za chwilę.',
    cause: error,
  });
}

@Injectable()
export class AuctionSearchService {
  private readonly logger = new Logger(AuctionSearchService.name);
  private readonly index: string;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(MeiliClient) private readonly meili: MeiliClient,
    @Inject(CategoryService) private readonly categories: CategoryService,
  ) {
    this.index = auctionIndexName(config.search.indexPrefix);
  }

  async search(
    params: AuctionSearchParams,
    now: number = Date.now(),
  ): Promise<AuctionSearchResult> {
    const nodes = await this.categories.list();
    const schema =
      params.categoryId === undefined ? undefined : await this.categories.schema(params.categoryId);
    if (params.categoryId !== undefined && schema === undefined) {
      throw new DomainError({
        code: 'VALIDATION_FAILED',
        detail: 'Nie ma takiej kategorii.',
        errors: [{ path: 'category', code: 'custom', message: 'Nie ma takiej kategorii.' }],
      });
    }
    const facetable = (schema?.attributes ?? []).filter(isFacetable);
    let attributes;
    try {
      attributes = parseAttributeFilters(params.attributes ?? [], facetable);
    } catch (error) {
      if (error instanceof AttributeFilterError) {
        throw new DomainError({
          code: 'VALIDATION_FAILED',
          detail: error.message,
          errors: [{ path: 'attr', code: 'custom', message: error.message }],
        });
      }
      throw error;
    }
    const q = params.q?.trim() ?? '';
    const sort = effectiveSort(params.sort, q);
    let response: MeiliSearchResponse<AuctionCard>;
    try {
      response = await this.meili.search<AuctionCard>(this.index, {
        q,
        filter: buildFilter({
          categoryId: params.categoryId,
          conditions: params.conditions ?? [],
          priceMin: params.priceMin,
          priceMax: params.priceMax,
          attributes,
          sellerId: params.sellerId,
          now,
        }),
        sort: sortRules(sort),
        facets: [
          'categoryIds',
          'condition',
          'price',
          ...facetable.map((definition) => `attributes.${definition.key}`),
        ],
        page: params.page,
        hitsPerPage: params.pageSize,
        attributesToRetrieve: CARD_FIELDS,
      });
    } catch (error) {
      if (await this.indexNotReady(error)) {
        return emptyResult(params, sort);
      }
      this.logger.error({ err: error }, 'Wyszukiwarka nie odpowiada');
      throw unavailable(error);
    }
    const distribution = response.facetDistribution ?? {};
    const stats = response.facetStats ?? {};
    const counts = distribution['categoryIds'] ?? {};
    return {
      items: response.hits,
      total: response.totalHits,
      totalPages: response.totalPages,
      page: response.page,
      pageSize: response.hitsPerPage,
      sort,
      categories: childrenOf(nodes, params.categoryId).flatMap((node) => {
        const count = counts[node.id] ?? 0;
        return count > 0 ? [{ ...node, count }] : [];
      }),
      conditions: ITEM_CONDITIONS.flatMap((value) => {
        const count = distribution['condition']?.[value] ?? 0;
        return count > 0 ? [{ value, count }] : [];
      }),
      price: rangeOf(stats['price']),
      attributes: facetable.map((definition) => {
        const field = `attributes.${definition.key}`;
        const values = distribution[field] ?? {};
        return {
          definition,
          options:
            definition.type === 'select'
              ? definition.options.flatMap((option) => {
                  const count = values[option.value] ?? 0;
                  return count > 0 ? [{ value: option.value, label: option.label, count }] : [];
                })
              : definition.type === 'boolean'
                ? ['true', 'false'].flatMap((value) => {
                    const count = values[value] ?? 0;
                    return count > 0
                      ? [{ value, label: BOOLEAN_LABELS[value] ?? value, count }]
                      : [];
                  })
                : [],
          range: definition.type === 'number' ? rangeOf(stats[field]) : null,
        };
      }),
    };
  }

  /**
   * Indeks jeszcze nie istnieje albo powstaje: worker tworzy go przy pierwszym zapisie, a przez
   * chwilę po utworzeniu nie ma ustawień filtrów (Meilisearch odrzuca wtedy filtr). Wtedy brak
   * wyników zamiast błędu; ten sam błąd przy gotowym indeksie to błąd zapytania (503 i log).
   */
  private async indexNotReady(error: unknown): Promise<boolean> {
    if (!(error instanceof MeiliError)) {
      return false;
    }
    if (error.code === 'index_not_found') {
      return true;
    }
    if (!INVALID_QUERY_CODES.has(error.code ?? '')) {
      return false;
    }
    try {
      const settings = await this.meili.getSettings(this.index);
      return !(settings.filterableAttributes ?? []).includes('status');
    } catch {
      return false;
    }
  }

  /** Aktywne aukcje do sitemap, najnowsze najpierw (z indeksu, bez limitu 1000 wyników). */
  async sitemap(now: number = Date.now()): Promise<SitemapAuction[]> {
    const documents: (SitemapAuction & { publishedAtTs: number; endsAtTs: number })[] = [];
    try {
      for (let offset = 0; offset < SITEMAP_LIMIT; offset += SITEMAP_BATCH) {
        const page = await this.meili.fetchDocuments<
          SitemapAuction & { publishedAtTs: number; endsAtTs: number }
        >(this.index, {
          fields: ['publicId', 'slug', 'updatedAt', 'publishedAtTs', 'endsAtTs'],
          limit: SITEMAP_BATCH,
          offset,
        });
        documents.push(...page.results);
        if (offset + SITEMAP_BATCH >= page.total) {
          break;
        }
      }
    } catch (error) {
      if (error instanceof MeiliError && error.code === 'index_not_found') {
        return [];
      }
      throw unavailable(error);
    }
    return documents
      .filter((document) => document.endsAtTs > now)
      .sort((left, right) => right.publishedAtTs - left.publishedAtTs)
      .map(({ publicId, slug, updatedAt }) => ({ publicId, slug, updatedAt }));
  }
}

function emptyResult(params: AuctionSearchParams, sort: SearchSort): AuctionSearchResult {
  return {
    items: [],
    total: 0,
    totalPages: 0,
    page: params.page,
    pageSize: params.pageSize,
    sort,
    categories: [],
    conditions: [],
    price: null,
    attributes: [],
  };
}

/** Podkategorie wybranej kategorii albo kategorie główne. */
function childrenOf(
  nodes: readonly CategoryNode[],
  categoryId: string | undefined,
): CategoryNode[] {
  return nodes.filter((node) => node.parentId === (categoryId ?? null));
}

function rangeOf(
  stats: { readonly min: number; readonly max: number } | undefined,
): { readonly min: number; readonly max: number } | null {
  return stats === undefined ? null : { min: stats.min, max: stats.max };
}

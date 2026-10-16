// Zapytanie wyszukiwarki aukcji (F-19): parametry API → wyrażenie filtra, sortowanie i fasety
// Meilisearch. Filtr powstaje wyłącznie z walidowanych wartości (enumy, UUID, opcje atrybutów
// ze schematu kategorii, liczby), a teksty dodatkowo w cudzysłowach z escapowaniem.
import type { AttributeDefinition, ItemCondition } from '@biddy/shared';

export const SEARCH_SORTS = [
  'relevance',
  'ending',
  'newest',
  'price_asc',
  'price_desc',
  'bids',
] as const;

export type SearchSort = (typeof SEARCH_SORTS)[number];

/** Atrybuty, po których da się filtrować (tekst swobodny nie). */
export type FacetableAttribute = Exclude<AttributeDefinition, { type: 'text' }>;

export type AttributeFilter =
  | { readonly key: string; readonly kind: 'values'; readonly values: readonly string[] }
  | {
      readonly key: string;
      readonly kind: 'range';
      readonly min: number | undefined;
      readonly max: number | undefined;
    };

export interface AuctionQuery {
  readonly categoryId: string | undefined;
  readonly conditions: readonly ItemCondition[];
  readonly priceMin: number | undefined;
  readonly priceMax: number | undefined;
  readonly attributes: readonly AttributeFilter[];
  readonly sellerId: string | undefined;
  /** Czas serwera (ms): aukcje po końcu nie trafiają do wyników, zanim job je usunie. */
  readonly now: number;
}

/** Błąd parametru `attr` do pokazania w Problem Details (ścieżka `attr`). */
export class AttributeFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttributeFilterError';
  }
}

export function isFacetable(definition: AttributeDefinition): definition is FacetableAttribute {
  return definition.type !== 'text';
}

const NUMBER = /^-?\d+(?:[.,]\d+)?$/u;

function parseNumber(text: string, label: string): number | undefined {
  if (text === '') {
    return undefined;
  }
  if (!NUMBER.test(text)) {
    throw new AttributeFilterError(`${label}: oczekiwano liczby, np. 42 albo 40..44.`);
  }
  return Number(text.replace(',', '.'));
}

/**
 * Filtry atrybutów z parametrów `attr` (`klucz:wartość`, `klucz:od..do`). Dozwolone tylko
 * atrybuty wybranej kategorii; opcje muszą istnieć w jej schemacie. Kilka wartości tego samego
 * atrybutu to „lub”.
 */
export function parseAttributeFilters(
  raw: readonly string[],
  definitions: readonly AttributeDefinition[],
): AttributeFilter[] {
  const byKey = new Map(definitions.filter(isFacetable).map((item) => [item.key, item]));
  const values = new Map<string, Set<string>>();
  const ranges = new Map<string, { min: number | undefined; max: number | undefined }>();
  for (const entry of raw) {
    const separator = entry.indexOf(':');
    const key = separator === -1 ? entry : entry.slice(0, separator);
    const value = separator === -1 ? '' : entry.slice(separator + 1).trim();
    const definition = byKey.get(key);
    if (definition === undefined) {
      throw new AttributeFilterError(
        byKey.size === 0
          ? 'Filtry atrybutów wymagają kategorii, która je ma.'
          : `Kategoria nie ma atrybutu „${key}” do filtrowania.`,
      );
    }
    if (value === '') {
      throw new AttributeFilterError(`${definition.label}: podaj wartość, np. ${key}:wartość.`);
    }
    switch (definition.type) {
      case 'select': {
        if (!definition.options.some((option) => option.value === value)) {
          throw new AttributeFilterError(`${definition.label}: nieznana opcja „${value}”.`);
        }
        values.set(key, (values.get(key) ?? new Set()).add(value));
        break;
      }
      case 'boolean': {
        if (value !== 'true' && value !== 'false') {
          throw new AttributeFilterError(`${definition.label}: oczekiwano true albo false.`);
        }
        values.set(key, (values.get(key) ?? new Set()).add(value));
        break;
      }
      case 'number': {
        const [from = '', to] = value.split('..');
        const min = parseNumber(from.trim(), definition.label);
        const max = to === undefined ? min : parseNumber(to.trim(), definition.label);
        if (min !== undefined && max !== undefined && min > max) {
          throw new AttributeFilterError(`${definition.label}: „od” jest większe niż „do”.`);
        }
        ranges.set(key, { min, max });
        break;
      }
    }
  }
  return [
    ...[...values].map(([key, set]) => ({ key, kind: 'values' as const, values: [...set] })),
    ...[...ranges].map(([key, range]) => ({ key, kind: 'range' as const, ...range })),
  ];
}

/** Tekst w cudzysłowach dla wyrażenia filtra Meilisearch. */
export function quote(value: string): string {
  return `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
}

/** Wyrażenie filtra: zawsze tylko aktywne aukcje przed końcem. */
export function buildFilter(query: AuctionQuery): string {
  const parts = ['status = "ACTIVE"', `endsAtTs > ${String(query.now)}`];
  if (query.categoryId !== undefined) {
    parts.push(`categoryIds = ${quote(query.categoryId)}`);
  }
  if (query.conditions.length > 0) {
    parts.push(`condition IN [${query.conditions.map(quote).join(', ')}]`);
  }
  if (query.priceMin !== undefined) {
    parts.push(`price >= ${String(query.priceMin)}`);
  }
  if (query.priceMax !== undefined) {
    parts.push(`price <= ${String(query.priceMax)}`);
  }
  if (query.sellerId !== undefined) {
    parts.push(`sellerId = ${quote(query.sellerId)}`);
  }
  for (const filter of query.attributes) {
    const field = `attributes.${filter.key}`;
    if (filter.kind === 'values') {
      parts.push(
        filter.values.length === 1
          ? `${field} = ${quote(filter.values[0] ?? '')}`
          : `${field} IN [${filter.values.map(quote).join(', ')}]`,
      );
    } else {
      if (filter.min !== undefined) {
        parts.push(`${field} >= ${String(filter.min)}`);
      }
      if (filter.max !== undefined) {
        parts.push(`${field} <= ${String(filter.max)}`);
      }
    }
  }
  return parts.join(' AND ');
}

/** Sortowanie domyślne: trafność przy zapytaniu, kończące się bez zapytania. */
export function effectiveSort(sort: SearchSort | undefined, q: string | undefined): SearchSort {
  return sort ?? (q === undefined || q === '' ? 'ending' : 'relevance');
}

/** Reguły sortowania Meilisearch (trafność: kolejność rankingu, bez sortowania). */
export function sortRules(sort: SearchSort): string[] {
  switch (sort) {
    case 'relevance':
      return [];
    case 'ending':
      return ['endsAtTs:asc'];
    case 'newest':
      return ['publishedAtTs:desc'];
    case 'price_asc':
      return ['price:asc'];
    case 'price_desc':
      return ['price:desc'];
    case 'bids':
      return ['bidCount:desc', 'endsAtTs:asc'];
  }
}

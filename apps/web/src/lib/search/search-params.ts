// Parametry wyszukiwarki w adresie strony (F-19): po polsku i czytelne, np.
// `/kategoria/moda/sneakersy?stan=NEW&a.rozmiarEu.od=40&a.kolor=czarny&sort=koniec&strona=2`.
// Ten sam stan buduje zapytanie do API (`GET /v1/auctions`), linki paginacji i filtrów, a zwykły
// formularz GET z filtrami (bez JavaScriptu) wysyła dokładnie te nazwy pól.
import type { SearchAuctionsParams } from '@biddy/api-client';
import { ITEM_CONDITIONS, type ItemCondition } from '@biddy/shared';

import { parseBidAmount } from '@/lib/auction/auction-state';
import type { RawSearchParams } from '@/lib/page-params';

/** Sortowania w adresie i odpowiadające im wartości API. */
export const WEB_SORTS = {
  trafnosc: 'relevance',
  koniec: 'ending',
  nowe: 'newest',
  cena_rosnaco: 'price_asc',
  cena_malejaco: 'price_desc',
  oferty: 'bids',
} as const satisfies Record<string, NonNullable<SearchAuctionsParams['sort']>>;

export type WebSort = keyof typeof WEB_SORTS;

export const PAGE_SIZE = 24;

/** Najwięcej wyników jednego zapytania (limit wyszukiwarki, F-19). */
export const MAX_RESULTS = 1000;

/** Prefiks parametrów atrybutów: `a.{klucz}` (opcje), `a.{klucz}.od` i `a.{klucz}.do` (liczby). */
const ATTRIBUTE_PREFIX = 'a.';
const ATTRIBUTE_KEY = /^[a-z][a-zA-Z0-9]{0,39}$/u;

export interface SearchState {
  readonly q: string;
  /** Ścieżka slugów kategorii z parametru `kategoria` (tylko /szukaj), np. `moda/sneakersy`. */
  readonly category: string;
  readonly conditions: readonly ItemCondition[];
  /** Ceny w złotych tak, jak je wpisano. */
  readonly priceFrom: string;
  readonly priceTo: string;
  /** Wybrane opcje atrybutów (wybór, tak/nie). */
  readonly values: Readonly<Record<string, readonly string[]>>;
  /** Zakresy atrybutów liczbowych tak, jak je wpisano. */
  readonly ranges: Readonly<Record<string, { readonly from: string; readonly to: string }>>;
  readonly sort: WebSort | undefined;
  readonly page: number;
}

function all(raw: RawSearchParams, name: string): string[] {
  const value = raw[name];
  return (Array.isArray(value) ? value : value === undefined ? [] : [value]).filter(
    (entry) => entry.trim() !== '',
  );
}

function first(raw: RawSearchParams, name: string): string {
  return all(raw, name)[0]?.trim() ?? '';
}

export function parseSearchState(raw: RawSearchParams): SearchState {
  const values: Record<string, string[]> = {};
  const ranges: Record<string, { from: string; to: string }> = {};
  for (const name of Object.keys(raw)) {
    if (!name.startsWith(ATTRIBUTE_PREFIX)) {
      continue;
    }
    const [key = '', bound] = name.slice(ATTRIBUTE_PREFIX.length).split('.');
    if (!ATTRIBUTE_KEY.test(key)) {
      continue;
    }
    if (bound === 'od' || bound === 'do') {
      const range = (ranges[key] ??= { from: '', to: '' });
      range[bound === 'od' ? 'from' : 'to'] = first(raw, name);
    } else if (bound === undefined) {
      values[key] = [...new Set(all(raw, name).map((entry) => entry.trim()))];
    }
  }
  const sort = first(raw, 'sort');
  const page = Number(first(raw, 'strona'));
  return {
    q: first(raw, 'q').slice(0, 200),
    category: first(raw, 'kategoria'),
    conditions: all(raw, 'stan').filter((value): value is ItemCondition =>
      (ITEM_CONDITIONS as readonly string[]).includes(value),
    ),
    priceFrom: first(raw, 'cena_od'),
    priceTo: first(raw, 'cena_do'),
    values,
    ranges: Object.fromEntries(
      Object.entries(ranges).filter(([, range]) => range.from !== '' || range.to !== ''),
    ),
    sort: Object.hasOwn(WEB_SORTS, sort) ? (sort as WebSort) : undefined,
    page: Number.isSafeInteger(page) && page >= 1 ? Math.min(page, 1000) : 1,
  };
}

/** Liczba w polu zakresu („40”, „42,5”) albo undefined. */
function rangeNumber(text: string): string | undefined {
  const normalized = text.trim().replace(',', '.');
  return /^-?\d+(?:\.\d+)?$/u.test(normalized) ? normalized : undefined;
}

function price(text: string): number | undefined {
  const parsed = parseBidAmount(text);
  return typeof parsed === 'number' ? parsed : undefined;
}

/** Liczba wybranych filtrów (bez zapytania, kategorii i sortowania). */
export function filterCount(state: SearchState): number {
  return (
    state.conditions.length +
    (state.priceFrom === '' ? 0 : 1) +
    (state.priceTo === '' ? 0 : 1) +
    Object.values(state.values).reduce((sum, list) => sum + list.length, 0) +
    Object.keys(state.ranges).length
  );
}

/** Zapytanie do API; niepoprawne ceny i zakresy są pomijane (nie psują wyszukiwania). */
export function toApiParams(
  state: SearchState,
  options: { readonly categoryId?: string | undefined; readonly withAttributes?: boolean } = {},
): SearchAuctionsParams {
  const attr: string[] = [];
  if (options.withAttributes !== false) {
    for (const [key, list] of Object.entries(state.values)) {
      attr.push(...list.map((value) => `${key}:${value}`));
    }
    for (const [key, range] of Object.entries(state.ranges)) {
      const from = rangeNumber(range.from);
      const to = rangeNumber(range.to);
      if (from !== undefined || to !== undefined) {
        attr.push(`${key}:${from ?? ''}..${to ?? ''}`);
      }
    }
  }
  const priceMin = price(state.priceFrom);
  const priceMax = price(state.priceTo);
  return {
    ...(state.q === '' ? {} : { q: state.q }),
    ...(options.categoryId === undefined ? {} : { category: options.categoryId }),
    ...(state.conditions.length === 0 ? {} : { condition: [...state.conditions] }),
    ...(priceMin === undefined ? {} : { priceMin }),
    ...(priceMax === undefined ? {} : { priceMax }),
    ...(attr.length === 0 ? {} : { attr }),
    ...(state.sort === undefined ? {} : { sort: WEB_SORTS[state.sort] }),
    page: state.page,
    pageSize: PAGE_SIZE,
  };
}

/** Sortowanie API → nazwa w adresie. */
export function webSort(sort: NonNullable<SearchAuctionsParams['sort']>): WebSort {
  return (Object.keys(WEB_SORTS) as WebSort[]).find((key) => WEB_SORTS[key] === sort) ?? 'koniec';
}

/** Parametry adresu dla stanu (bez pustych wartości), np. do linków paginacji. */
export function toUrlParams(state: SearchState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q !== '') {
    params.set('q', state.q);
  }
  if (state.category !== '') {
    params.set('kategoria', state.category);
  }
  for (const condition of state.conditions) {
    params.append('stan', condition);
  }
  if (state.priceFrom !== '') {
    params.set('cena_od', state.priceFrom);
  }
  if (state.priceTo !== '') {
    params.set('cena_do', state.priceTo);
  }
  for (const [key, list] of Object.entries(state.values)) {
    for (const value of list) {
      params.append(`${ATTRIBUTE_PREFIX}${key}`, value);
    }
  }
  for (const [key, range] of Object.entries(state.ranges)) {
    if (range.from !== '') {
      params.set(`${ATTRIBUTE_PREFIX}${key}.od`, range.from);
    }
    if (range.to !== '') {
      params.set(`${ATTRIBUTE_PREFIX}${key}.do`, range.to);
    }
  }
  if (state.sort !== undefined) {
    params.set('sort', state.sort);
  }
  if (state.page > 1) {
    params.set('strona', String(state.page));
  }
  return params;
}

/** Adres strony wyników dla stanu ze zmianami (np. inna strona, bez filtrów). */
export function searchHref(
  basePath: string,
  state: SearchState,
  changes: Partial<SearchState> = {},
): string {
  const query = toUrlParams({ ...state, ...changes }).toString();
  return query === '' ? basePath : `${basePath}?${query}`;
}

/** Stan bez filtrów (zostają zapytanie, kategoria i sortowanie). */
export function withoutFilters(state: SearchState): SearchState {
  return {
    ...state,
    conditions: [],
    priceFrom: '',
    priceTo: '',
    values: {},
    ranges: {},
    page: 1,
  };
}

/** Wybrany filtr jako chip nad wynikami (F-63) i stan bez niego (link „Usuń filtr”). */
export type ActiveFilter = { readonly without: SearchState } & (
  | { readonly kind: 'condition'; readonly values: readonly ItemCondition[] }
  | { readonly kind: 'price'; readonly from: string; readonly to: string }
  | { readonly kind: 'values'; readonly key: string; readonly values: readonly string[] }
  | { readonly kind: 'range'; readonly key: string; readonly from: string; readonly to: string }
);

/** Wybrane filtry: stan jako jeden chip, cena jako jeden, każdy atrybut osobno. */
export function activeFilters(state: SearchState): ActiveFilter[] {
  const without = (changes: Partial<SearchState>): SearchState => ({
    ...state,
    ...changes,
    page: 1,
  });
  const filters: ActiveFilter[] = [];
  if (state.conditions.length > 0) {
    filters.push({
      kind: 'condition',
      values: state.conditions,
      without: without({ conditions: [] }),
    });
  }
  if (state.priceFrom !== '' || state.priceTo !== '') {
    filters.push({
      kind: 'price',
      from: state.priceFrom,
      to: state.priceTo,
      without: without({ priceFrom: '', priceTo: '' }),
    });
  }
  for (const [key, values] of Object.entries(state.values)) {
    if (values.length > 0) {
      const { [key]: _removed, ...rest } = state.values;
      filters.push({ kind: 'values', key, values, without: without({ values: rest }) });
    }
  }
  for (const [key, range] of Object.entries(state.ranges)) {
    const { [key]: _removed, ...rest } = state.ranges;
    filters.push({ kind: 'range', key, ...range, without: without({ ranges: rest }) });
  }
  return filters;
}

/** Nazwa pola formularza dla atrybutu. */
export function attributeField(key: string, bound?: 'od' | 'do'): string {
  return bound === undefined ? `${ATTRIBUTE_PREFIX}${key}` : `${ATTRIBUTE_PREFIX}${key}.${bound}`;
}

/** Numery stron: pierwsza, ostatnia i dwie wokół bieżącej; null to przerwa („…”). */
export function pageWindow(current: number, total: number): (number | null)[] {
  const pages = new Set([1, total, current - 1, current, current + 1]);
  const sorted = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
  return sorted.flatMap((page, index) => {
    const previous = sorted[index - 1];
    return previous !== undefined && page - previous > 1 ? [null, page] : [page];
  });
}

// Dane wyszukiwarki w Server Components (F-19): kategorie i wyniki z API z krótkim cache Next.js
// (wyniki są publiczne, bez ciasteczek). Niedostępna wyszukiwarka nie psuje strony: wynik null.
import {
  type AuctionSearchDto,
  type CategoryDto,
  type SearchAuctionsParams,
  getCategories,
  isApiError,
  searchAuctions,
} from '@biddy/api-client';
import { cache } from 'react';

import { type SearchState, toApiParams } from './search-params';
// Klient API po stronie serwera (adres API, także API_INTERNAL_URL).
import '@/lib/api/server';

/** Aktywne kategorie (drzewo zmienia się rzadko); błąd API: pusta lista. */
export const loadCategories = cache(async (): Promise<CategoryDto[]> => {
  try {
    return await getCategories({ next: { revalidate: 300 } });
  } catch {
    return [];
  }
});

/** Kategoria ze ścieżki slugów, np. ['moda', 'sneakersy']. */
export function categoryByPath(
  categories: readonly CategoryDto[],
  path: readonly string[],
): CategoryDto | undefined {
  const joined = path.join('/');
  return categories.find((category) => category.path.join('/') === joined);
}

/** Kategoria i jej przodkowie od głównej (okruszki). */
export function categoryTrail(
  categories: readonly CategoryDto[],
  category: CategoryDto,
): CategoryDto[] {
  return category.path.flatMap((_, index) => {
    const found = categoryByPath(categories, category.path.slice(0, index + 1));
    return found === undefined ? [] : [found];
  });
}

/** Zapytanie do API z cache Next.js (krótkim: ceny i liczba ofert się zmieniają). */
export async function searchCached(
  params: SearchAuctionsParams,
  revalidate = 30,
): Promise<AuctionSearchDto | null> {
  try {
    return await searchAuctions(params, { next: { revalidate } });
  } catch {
    return null;
  }
}

/** Okno paska „kończy się w ciągu godziny” nad wynikami (F-63). */
export const ENDING_SOON_MS = 60 * 60 * 1000;

/**
 * Liczba aukcji z wyników (te same filtry), które kończą się w ciągu godziny: `total` przy
 * `pageSize=1`. Koniec okna zaokrąglamy w dół do minuty, więc przez minutę adres zapytania jest
 * ten sam i działa cache (60 s). Błąd wyszukiwarki: 0 (paska nie ma).
 */
export async function countEndingSoon(
  state: SearchState,
  categoryId: string | undefined,
  now: number = Date.now(),
): Promise<number> {
  const minute = Math.floor(now / 60_000) * 60_000;
  const { sort: _sort, ...params } = toApiParams(state, { categoryId });
  const result = await searchCached(
    {
      ...params,
      endsBefore: new Date(minute + ENDING_SOON_MS).toISOString(),
      page: 1,
      pageSize: 1,
    },
    60,
  );
  return result?.total ?? 0;
}

export interface SearchOutcome {
  /** Wyniki albo null, gdy wyszukiwarka nie odpowiada. */
  readonly result: AuctionSearchDto | null;
  /** Filtry atrybutów z adresu nie pasowały do kategorii i zostały pominięte. */
  readonly droppedAttributes: boolean;
}

/**
 * Wyniki dla stanu z adresu. Atrybuty spoza kategorii (np. stary link po zmianie kategorii)
 * API odrzuca (400): wtedy szukamy bez nich i mówimy o tym użytkownikowi.
 */
export async function runSearch(
  state: SearchState,
  categoryId: string | undefined,
): Promise<SearchOutcome> {
  try {
    return {
      result: await searchAuctions(toApiParams(state, { categoryId }), {
        next: { revalidate: 30 },
      }),
      droppedAttributes: false,
    };
  } catch (error) {
    if (isApiError(error) && error.status === 400) {
      return {
        result: await searchCached(toApiParams(state, { categoryId, withAttributes: false })),
        droppedAttributes: true,
      };
    }
    return { result: null, droppedAttributes: false };
  }
}

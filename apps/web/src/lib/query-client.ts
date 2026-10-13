import { isApiError } from '@biddy/api-client';
import { QueryClient } from '@tanstack/react-query';

/** Ile razy ponawiamy zapytanie po błędzie sieci albo serwera (5xx). */
export const MAX_QUERY_RETRIES = 2;

/**
 * Błędy klienta (4xx: walidacja, brak uprawnień, nie znaleziono) się nie zmienią, więc ich nie
 * ponawiamy. Brak odpowiedzi (status 0) i 5xx ponawiamy najwyżej {@link MAX_QUERY_RETRIES} razy.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < MAX_QUERY_RETRIES;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: shouldRetryQuery, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

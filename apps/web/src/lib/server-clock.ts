// Synchronizacja zegara z serwerem (PROJECT.md §15.4): liczniki końca aukcji liczymy od czasu
// serwera, a nie od zegara urządzenia, który może się spieszyć albo spóźniać o minuty.
// Ostateczną decyzję o tym, czy oferta zdążyła, i tak podejmuje serwer.
import { getGetServerTimeQueryKey, getServerTime } from '@biddy/api-client';

/** Jak często odświeżamy przesunięcie zegara. */
export const CLOCK_SYNC_INTERVAL_MS = 5 * 60_000;

/**
 * Przesunięcie zegara: czas serwera minus czas lokalny w połowie żądania (t0 przed wysłaniem,
 * t1 po odebraniu odpowiedzi), czyli `serverTime − (t0 + t1) / 2`.
 */
export function clockOffset(serverTime: string, sentAt: number, receivedAt: number): number {
  return Date.parse(serverTime) - (sentAt + receivedAt) / 2;
}

/** Mierzy przesunięcie jednym żądaniem GET /v1/time (wygenerowany klient API). */
export async function measureClockOffset(
  signal?: AbortSignal,
  now: () => number = Date.now,
): Promise<number> {
  const sentAt = now();
  const { serverTime } = await getServerTime(signal === undefined ? {} : { signal });
  return clockOffset(serverTime, sentAt, now());
}

/** Klucz zapytania o przesunięcie (pochodny od klucza wygenerowanego dla GET /v1/time). */
export const CLOCK_OFFSET_QUERY_KEY = [...getGetServerTimeQueryKey(), 'offset'] as const;

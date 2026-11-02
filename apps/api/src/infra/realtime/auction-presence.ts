// „X osób ogląda” (F-63, decyzja D1): połączenia ze stroną aukcji w Redisie cache, zbiór
// posortowany na aukcję, w którym wynik to czas ostatniego potwierdzenia obecności. Działa przy
// wielu instancjach API: każda odnawia swoje połączenia co PRESENCE_REFRESH_MS, a wpisy instancji,
// która padła, wypadają po PRESENCE_STALE_MS. Trzymamy identyfikatory gniazd, nie użytkowników,
// a na zewnątrz wychodzi tylko liczba. Najlepszy wysiłek: błąd Redisa obsługuje wywołujący.
import type { Redis } from 'ioredis';

/** Co tyle instancja potwierdza obecność swoich połączeń. */
export const PRESENCE_REFRESH_MS = 30_000;
/** Wpis bez potwierdzenia dłużej niż tyle przestaje się liczyć (instancja padła). */
export const PRESENCE_STALE_MS = 90_000;
/** Klucz aukcji, której nikt nie ogląda, znika sam. */
const KEY_TTL_SECONDS = 120;

export function presenceKey(auctionId: string): string {
  return `realtime:viewers:${auctionId}`;
}

/** Wynik ostatniej komendy z MULTI/pipeline (ZCARD) jako liczba. */
function lastCount(results: [Error | null, unknown][] | null): number {
  const last = results?.at(-1);
  if (last === undefined || last[0] !== null) {
    throw last?.[0] ?? new Error('Redis nie zwrócił wyniku');
  }
  return Number(last[1]);
}

export class AuctionPresence {
  constructor(
    private readonly redis: Redis,
    private readonly now: () => number = Date.now,
  ) {}

  /** Dodaje połączenie do oglądających aukcję; zwraca liczbę oglądających. */
  async add(auctionId: string, member: string): Promise<number> {
    const key = presenceKey(auctionId);
    const now = this.now();
    return lastCount(
      await this.redis
        .multi()
        .zadd(key, now, member)
        .expire(key, KEY_TTL_SECONDS)
        .zremrangebyscore(key, '-inf', now - PRESENCE_STALE_MS)
        .zcard(key)
        .exec(),
    );
  }

  /** Usuwa połączenie z oglądających; zwraca liczbę oglądających. */
  async remove(auctionId: string, member: string): Promise<number> {
    const key = presenceKey(auctionId);
    return lastCount(
      await this.redis
        .multi()
        .zrem(key, member)
        .zremrangebyscore(key, '-inf', this.now() - PRESENCE_STALE_MS)
        .zcard(key)
        .exec(),
    );
  }

  /** Liczba oglądających (po usunięciu wpisów bez potwierdzenia). */
  async count(auctionId: string): Promise<number> {
    const key = presenceKey(auctionId);
    return lastCount(
      await this.redis
        .multi()
        .zremrangebyscore(key, '-inf', this.now() - PRESENCE_STALE_MS)
        .zcard(key)
        .exec(),
    );
  }

  /** Potwierdza obecność połączeń tej instancji (jedno zapytanie dla wszystkich). */
  async refresh(entries: readonly { readonly auctionId: string; readonly member: string }[]) {
    if (entries.length === 0) {
      return;
    }
    const now = this.now();
    const pipeline = this.redis.pipeline();
    for (const { auctionId, member } of entries) {
      const key = presenceKey(auctionId);
      pipeline.zadd(key, now, member).expire(key, KEY_TTL_SECONDS);
    }
    await pipeline.exec();
  }
}

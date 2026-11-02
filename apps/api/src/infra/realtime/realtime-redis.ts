// Połączenia z Redisem cache (pub/sub Socket.IO, F-17; PROJECT.md §11.2: instancja allkeys-lru,
// osobna od kolejek). Łączą się leniwie i z ponowieniami, więc API startuje także wtedy, gdy
// Redis chwilowo nie działa; zdarzenia na żywo to najlepszy wysiłek, a nie źródło prawdy.
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

/** Jak często najwyżej logujemy ten sam błąd połączenia. */
const ERROR_LOG_INTERVAL_MS = 60_000;

export function createCacheRedis(
  url: string,
  name: string,
  options: {
    /**
     * Komendy czekają na połączenie bez limitu (klient subskrypcji: subskrypcja po awarii
     * Redisa ma się udać, a nie przepaść). Domyślnie kilka ponowień i błąd (publikacja).
     */
    readonly waitForConnection?: boolean;
    readonly logger?: Pick<Logger, 'warn'>;
  } = {},
): Redis {
  const logger = options.logger ?? new Logger('CacheRedis');
  const redis = new Redis(url, {
    connectionName: `biddy-${name}`,
    lazyConnect: true,
    maxRetriesPerRequest: options.waitForConnection === true ? null : 2,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
  });
  let lastMessage: string | undefined;
  let lastLoggedAt = 0;
  redis.on('error', (error: Error) => {
    const now = Date.now();
    if (error.message !== lastMessage || now - lastLoggedAt >= ERROR_LOG_INTERVAL_MS) {
      lastMessage = error.message;
      lastLoggedAt = now;
      logger.warn(`Błąd połączenia z Redisem cache (${name}): ${error.message}`);
    }
  });
  return redis;
}

/** Zamyka połączenie: QUIT, a gdy Redis nie odpowiada, rozłączenie bez czekania. */
export async function closeCacheRedis(redis: Redis): Promise<void> {
  if (redis.status === 'end') {
    return;
  }
  if (redis.status !== 'ready') {
    redis.disconnect();
    return;
  }
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
}

/** Komendy, które biblioteki Socket.IO (adapter, emitter) wywołują bez obsługi błędu. */
const FIRE_AND_FORGET = new Set([
  'publish',
  'subscribe',
  'psubscribe',
  'unsubscribe',
  'punsubscribe',
]);

/**
 * Klient Redisa, w którym odrzucenia komend pub/sub są logowane zamiast zostać nieobsłużone.
 * Adapter i emitter Socket.IO nie obsługują błędów tych komend, a nieobsłużone odrzucenie
 * (np. „Connection is closed” przy wyłączaniu albo awarii Redisa) zakończyłoby proces.
 */
export function withHandledRejections(
  redis: Redis,
  logger: Pick<Logger, 'warn'> = new Logger('CacheRedis'),
): Redis {
  return new Proxy(redis, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') {
        return value;
      }
      const method = value as (...args: unknown[]) => unknown;
      if (typeof property !== 'string' || !FIRE_AND_FORGET.has(property)) {
        return method.bind(target);
      }
      return (...args: unknown[]) => {
        const result = method.apply(target, args);
        return result instanceof Promise
          ? result.catch((error: unknown) => {
              logger.warn(
                `Redis cache: ${property} nie powiódł się (${error instanceof Error ? error.message : String(error)})`,
              );
              return undefined;
            })
          : result;
      };
    },
  });
}

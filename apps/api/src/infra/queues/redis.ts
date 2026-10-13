// Połączenia z Redisem kolejek (BullMQ). Osobna instancja z maxmemory-policy noeviction
// (PROJECT.md §11.2): przy eviction Redis po zapełnieniu pamięci usuwa klucze, czyli joby, np.
// zaplanowane zamknięcie aukcji. Dlatego worker sprawdza politykę przy starcie
// (assertNoEviction) i bez noeviction nie startuje.
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * Rola połączenia:
 * - `producer`: dodawanie jobów (API, relay outboxa, handlery). Komenda czeka na Redisa
 *   najwyżej kilka ponowień połączenia, potem kończy się błędem (relay spróbuje później).
 * - `worker`: workery BullMQ. BullMQ wymaga maxRetriesPerRequest = null (komendy blokujące
 *   czekają na połączenie bez limitu).
 */
export type QueueConnectionRole = 'producer' | 'worker';

/** Odstęp między próbami połączenia: rośnie o 200 ms do 5 s. */
export function reconnectDelay(attempt: number): number {
  return Math.min(attempt * 200, 5_000);
}

/** Jak często najwyżej logujemy ten sam błąd połączenia (ioredis zgłasza go przy każdej próbie). */
const ERROR_LOG_INTERVAL_MS = 60_000;

/**
 * Tworzy połączenie z Redisem kolejek. Łączy się leniwie (przy pierwszej komendzie), więc API
 * startuje także wtedy, gdy Redis chwilowo nie działa. Błędy połączenia loguje (najwyżej raz na
 * minutę dla tego samego komunikatu); bez nasłuchu zdarzenie `error` zakończyłoby proces.
 */
export function createQueueRedis(
  url: string,
  role: QueueConnectionRole,
  logger: Pick<Logger, 'warn'> = new Logger('QueueRedis'),
): Redis {
  const redis = new Redis(url, {
    connectionName: `biddy-${role}`,
    lazyConnect: true,
    maxRetriesPerRequest: role === 'worker' ? null : 3,
    retryStrategy: reconnectDelay,
  });
  let lastMessage: string | undefined;
  let lastLoggedAt = 0;
  redis.on('error', (error: Error) => {
    const now = Date.now();
    if (error.message !== lastMessage || now - lastLoggedAt >= ERROR_LOG_INTERVAL_MS) {
      lastMessage = error.message;
      lastLoggedAt = now;
      logger.warn(`Błąd połączenia z Redisem kolejek (${role}): ${error.message}`);
    }
  });
  return redis;
}

/** Zamyka połączenie: QUIT, a gdy Redis nie odpowiada, rozłączenie bez czekania. */
export async function closeQueueRedis(redis: Redis): Promise<void> {
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

/** Wartość pola z odpowiedzi INFO Redisa (linie `nazwa:wartość`). */
export function infoField(info: string, field: string): string | undefined {
  for (const line of info.split(/\r?\n/)) {
    if (line.startsWith(`${field}:`)) {
      return line.slice(field.length + 1).trim();
    }
  }
  return undefined;
}

/** Redis kolejek nie ma maxmemory-policy noeviction (albo nie dało się jej odczytać). */
export class EvictionPolicyError extends Error {
  readonly policy: string | undefined;

  constructor(policy: string | undefined) {
    super(
      `Redis kolejek (REDIS_QUEUE_URL) ma maxmemory-policy ${policy ?? '(nie udało się odczytać z INFO memory)'}, ` +
        'a BullMQ wymaga noeviction: przy innej polityce Redis po zapełnieniu pamięci usuwa joby ' +
        '(np. zaplanowane zamknięcia aukcji). Ustaw maxmemory-policy noeviction na tej instancji ' +
        '(lokalnie robi to infra/docker-compose.yml, na Render: Key Value → Maxmemory Policy).',
    );
    this.name = 'EvictionPolicyError';
    this.policy = policy;
  }
}

/** Odczytuje maxmemory-policy z INFO memory; odrzuca {@link EvictionPolicyError}, gdy to nie noeviction. */
export async function assertNoEviction(redis: Pick<Redis, 'info'>): Promise<void> {
  const policy = infoField(await redis.info('memory'), 'maxmemory_policy');
  if (policy !== 'noeviction') {
    throw new EvictionPolicyError(policy);
  }
}

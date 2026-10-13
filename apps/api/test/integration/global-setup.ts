// Globalny setup testów integracyjnych: jeden Postgres 17 i jeden Redis kolejek (noeviction)
// w kontenerach (Testcontainers) na cały przebieg. Migracje Drizzle stosuje ta sama funkcja co
// `db:migrate` (runMigrations), a adresy trafiają do testów przez provide/inject
// (support/app.ts, support/database.ts, support/worker.ts). Kontenery zatrzymuje teardown;
// gdyby proces zginął wcześniej, sprząta je Ryuk z Testcontainers.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';

import { runMigrations } from '../../src/infra/db/migrations.js';

/** Te same obrazy co w infra/docker-compose.yml. */
const POSTGRES_IMAGE = 'postgres:17-alpine';
export const REDIS_IMAGE = 'redis:7.4-alpine';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Adres bazy w kontenerze (już po migracjach), z uprawnieniami superużytkownika. */
    databaseUrl: string;
    /** Adres Redisa kolejek w kontenerze (maxmemory-policy noeviction, jak w docker-compose). */
    redisUrl: string;
  }
}

/**
 * Redis w kontenerze z podaną polityką pamięci. Testy kolejek dzielą jedną instancję
 * (noeviction) i rozdzielają dane prefiksem kluczy BullMQ (QUEUE_PREFIX).
 */
export async function startRedis(maxmemoryPolicy = 'noeviction'): Promise<StartedTestContainer> {
  try {
    return await new GenericContainer(REDIS_IMAGE)
      .withCommand(['redis-server', '--maxmemory-policy', maxmemoryPolicy, '--save', ''])
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start();
  } catch (error) {
    throw new Error(
      `Nie udało się uruchomić kontenera ${REDIS_IMAGE} (przyczyna niżej). Testy integracyjne ` +
        'wymagają działającego Dockera (sprawdź `docker info`).',
      { cause: error },
    );
  }
}

export function redisUrlOf(container: StartedTestContainer): string {
  return `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
}

async function startPostgres(): Promise<StartedPostgreSqlContainer> {
  try {
    return await new PostgreSqlContainer(POSTGRES_IMAGE)
      .withDatabase('biddy')
      .withUsername('biddy')
      .withPassword('biddy')
      .start();
  } catch (error) {
    throw new Error(
      `Nie udało się uruchomić kontenera ${POSTGRES_IMAGE} (przyczyna niżej). Testy ` +
        'integracyjne wymagają działającego Dockera (sprawdź `docker info`), a przy pierwszym ' +
        'uruchomieniu także dostępu do rejestru obrazów.',
      { cause: error },
    );
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [postgres, redis] = await Promise.allSettled([startPostgres(), startRedis()]);
  const started = [postgres, redis].flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
  const stopAll = async () => {
    await Promise.all(started.map((container) => container.stop()));
  };
  if (postgres.status === 'rejected' || redis.status === 'rejected') {
    await stopAll();
    throw postgres.status === 'rejected'
      ? postgres.reason
      : (redis as PromiseRejectedResult).reason;
  }
  try {
    const databaseUrl = postgres.value.getConnectionUri();
    await runMigrations(databaseUrl);
    project.provide('databaseUrl', databaseUrl);
    project.provide('redisUrl', redisUrlOf(redis.value));
  } catch (error) {
    await stopAll();
    throw error;
  }
  return stopAll;
}

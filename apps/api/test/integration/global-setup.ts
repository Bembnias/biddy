// Globalny setup testów integracyjnych: jeden Postgres 17, jeden Redis kolejek (noeviction)
// i jeden Meilisearch w kontenerach (Testcontainers) na cały przebieg. Migracje Drizzle stosuje ta sama funkcja co
// `db:migrate` (runMigrations), a adresy trafiają do testów przez provide/inject
// (support/app.ts, support/database.ts, support/worker.ts). Kontenery zatrzymuje teardown;
// gdyby proces zginął wcześniej, sprząta je Ryuk z Testcontainers.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';

import { runMigrations } from '../../src/infra/db/migrations.js';
import { TEST_MEILI_KEY } from './support/meili.js';

/** Te same obrazy co w infra/docker-compose.yml. */
const POSTGRES_IMAGE = 'postgres:17-alpine';
export const REDIS_IMAGE = 'redis:7.4-alpine';
const MEILI_IMAGE = 'getmeili/meilisearch:v1.52';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Adres bazy w kontenerze (już po migracjach), z uprawnieniami superużytkownika. */
    databaseUrl: string;
    /** Adres Redisa kolejek w kontenerze (maxmemory-policy noeviction, jak w docker-compose). */
    redisUrl: string;
    /** Adres Meilisearch w kontenerze (klucz TEST_MEILI_KEY). */
    meiliUrl: string;
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

async function startMeili(): Promise<StartedTestContainer> {
  try {
    return await new GenericContainer(MEILI_IMAGE)
      .withEnvironment({ MEILI_MASTER_KEY: TEST_MEILI_KEY, MEILI_NO_ANALYTICS: 'true' })
      .withExposedPorts(7700)
      .withWaitStrategy(Wait.forHttp('/health', 7700))
      .start();
  } catch (error) {
    throw new Error(
      `Nie udało się uruchomić kontenera ${MEILI_IMAGE} (przyczyna niżej). Testy integracyjne ` +
        'wymagają działającego Dockera (sprawdź `docker info`).',
      { cause: error },
    );
  }
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
  const [postgres, redis, meili] = await Promise.allSettled([
    startPostgres(),
    startRedis(),
    startMeili(),
  ]);
  const started = [postgres, redis, meili].flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
  const stopAll = async () => {
    await Promise.all(started.map((container) => container.stop()));
  };
  if (
    postgres.status === 'rejected' ||
    redis.status === 'rejected' ||
    meili.status === 'rejected'
  ) {
    await stopAll();
    throw [postgres, redis, meili].flatMap((result) =>
      result.status === 'rejected' ? [result.reason as unknown] : [],
    )[0];
  }
  try {
    const databaseUrl = postgres.value.getConnectionUri();
    await runMigrations(databaseUrl);
    project.provide('databaseUrl', databaseUrl);
    project.provide('redisUrl', redisUrlOf(redis.value));
    project.provide(
      'meiliUrl',
      `http://${meili.value.getHost()}:${String(meili.value.getMappedPort(7700))}`,
    );
  } catch (error) {
    await stopAll();
    throw error;
  }
  return stopAll;
}

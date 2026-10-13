// Globalny setup testów integracyjnych: jeden Postgres 17 w kontenerze (Testcontainers) na cały
// przebieg. Migracje Drizzle stosuje ta sama funkcja co `db:migrate` (runMigrations), a adres
// bazy trafia do testów przez provide/inject (support/app.ts, support/database.ts).
// Kontener zatrzymuje teardown; gdyby proces zginął wcześniej, sprząta go Ryuk z Testcontainers.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

import { runMigrations } from '../../src/infra/db/migrations.js';

/** Ten sam obraz co w infra/docker-compose.yml. */
const POSTGRES_IMAGE = 'postgres:17-alpine';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Adres bazy w kontenerze (już po migracjach), z uprawnieniami superużytkownika. */
    databaseUrl: string;
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
  const container = await startPostgres();
  try {
    const databaseUrl = container.getConnectionUri();
    await runMigrations(databaseUrl);
    project.provide('databaseUrl', databaseUrl);
  } catch (error) {
    await container.stop();
    throw error;
  }
  return async () => {
    await container.stop();
  };
}

import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';

import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { DatabaseHealth } from './database-health.js';
import { createDatabase, createPool, DRIZZLE, PG_POOL } from './database.js';

/**
 * Połączenie z Postgresem dla całej aplikacji: pula pg (PG_POOL), Drizzle (DRIZZLE) i health
 * check (DatabaseHealth). Moduł globalny, wymaga APP_CONFIG (ConfigModule). Pulę zamyka przy
 * zamykaniu aplikacji (`app.close()` albo sygnał przy włączonych shutdown hooks).
 */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createPool(config.database),
    },
    {
      provide: DRIZZLE,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => createDatabase(pool),
    },
    DatabaseHealth,
  ],
  exports: [PG_POOL, DRIZZLE, DatabaseHealth],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    // pool.end() wywołane drugi raz rzuca błąd, a zamknięcie może przyjść z kilku stron.
    if (!this.pool.ended) {
      await this.pool.end();
    }
  }
}

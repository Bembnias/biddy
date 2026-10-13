import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { integer, pgTable, uuid } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { APP_CONFIG, type AppConfig } from '../../src/infra/config/index.js';
import { createPool } from '../../src/infra/db/database.js';
import {
  DATABASE_HEALTH_TIMEOUT_MS,
  type Database,
  DatabaseHealth,
  DbModule,
  DRIZZLE,
  PG_POOL,
} from '../../src/infra/db/index.js';

/** Tabele przykładowego modułu (jak src/modules/<moduł>/db/*.schema.ts). */
const ownTables = {
  bids: pgTable('bids', { id: uuid().primaryKey(), amount: integer().notNull() }),
};

describe('typ Database (instancja Drizzle widziana przez moduł)', () => {
  // Sprawdza tsc (pnpm typecheck obejmuje katalog test/); w Vitest to tylko wywołania.
  it('zna wyłącznie tabele podane przez moduł', () => {
    // Moduł typuje wstrzykniętą instancję (@Inject(DRIZZLE)) własnym schematem.
    const db: Database<typeof ownTables> = drizzle.mock({ schema: ownTables });

    expectTypeOf<keyof typeof db.query>().toEqualTypeOf<'bids'>();
    expect(Object.keys(db.query)).toEqual(['bids']);
  });

  it('bez schematu modułu nie daje zapytań relacyjnych do żadnej tabeli', () => {
    expectTypeOf<Database['query']>().not.toHaveProperty('bids');
    expectTypeOf<Database['query']>().not.toHaveProperty('users');
  });
});

/** Atrapa puli: DatabaseHealth używa tylko `query`. */
function healthWithQuery(query: () => Promise<unknown>) {
  const pool = { query: vi.fn(query) };
  return { pool, health: new DatabaseHealth(pool as unknown as Pool) };
}

describe('DatabaseHealth', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('kończy się sukcesem, gdy baza odpowiada na select 1', async () => {
    const { pool, health } = healthWithQuery(() => Promise.resolve({ rows: [{ '?column?': 1 }] }));

    await expect(health.check()).resolves.toBeUndefined();
    expect(pool.query).toHaveBeenCalledWith('select 1');
  });

  it('odrzuca z przyczyną, gdy zapytanie kończy się błędem', async () => {
    const cause = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    const { health } = healthWithQuery(() => Promise.reject(cause));

    const error: unknown = await health.check().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      'Baza danych jest niedostępna: connect ECONNREFUSED 127.0.0.1:5432',
    );
    expect((error as Error).cause).toBe(cause);
  });

  it('odrzuca po 2 s, gdy baza nie odpowiada', async () => {
    vi.useFakeTimers();
    const { health } = healthWithQuery(() => new Promise(() => {}));
    let settled = false;
    const result = health.check().finally(() => {
      settled = true;
    });
    const assertion = expect(result).rejects.toThrow(
      'Baza danych nie odpowiedziała na select 1 w ciągu 2000 ms',
    );

    await vi.advanceTimersByTimeAsync(DATABASE_HEALTH_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(DATABASE_HEALTH_TIMEOUT_MS).toBe(2_000);
  });

  it('błąd zapytania po upływie limitu nie zostawia nieobsłużonego odrzucenia', async () => {
    vi.useFakeTimers();
    let failQuery: (error: Error) => void = () => {};
    const { health } = healthWithQuery(
      () =>
        new Promise((_, reject) => {
          failQuery = reject;
        }),
    );
    const assertion = expect(health.check()).rejects.toThrow('nie odpowiedziała');

    await vi.advanceTimersByTimeAsync(DATABASE_HEALTH_TIMEOUT_MS);
    await assertion;
    // Vitest zgłasza nieobsłużone odrzucenia jako błąd przebiegu testów.
    failQuery(new Error('Connection terminated'));
    await vi.advanceTimersByTimeAsync(0);
  });

  it('nie zostawia aktywnego timera po sprawdzeniu', async () => {
    vi.useFakeTimers();
    const { health } = healthWithQuery(() => Promise.resolve({ rows: [] }));

    await health.check();

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('createPool', () => {
  it('ustawia rozmiar puli z konfiguracji i nazwę aplikacji biddy-api', async () => {
    const pool = createPool({ url: 'postgres://biddy:biddy@localhost:5432/biddy', poolMax: 7 });
    try {
      expect(pool.options.max).toBe(7);
      expect(pool.options.application_name).toBe('biddy-api');
    } finally {
      await pool.end();
    }
  });

  it('loguje błąd bezczynnego połączenia zamiast kończyć proces', async () => {
    const logger = { error: vi.fn() };
    const pool = createPool({ url: 'postgres://localhost/biddy', poolMax: 1 }, logger);
    try {
      pool.emit('error', new Error('terminating connection due to administrator command'));

      expect(logger.error).toHaveBeenCalledWith(
        'Błąd bezczynnego połączenia z bazą danych: terminating connection due to administrator command',
        expect.any(String),
      );
    } finally {
      await pool.end();
    }
  });
});

describe('DbModule', () => {
  const config = {
    database: { url: 'postgres://biddy:biddy@localhost:5432/biddy', poolMax: 3 },
  } as AppConfig;

  @Global()
  @Module({ providers: [{ provide: APP_CONFIG, useValue: config }], exports: [APP_CONFIG] })
  class TestConfigModule {}

  it('udostępnia pulę, Drizzle i health check, a przy zamknięciu aplikacji zamyka pulę', async () => {
    // Pula łączy się leniwie, więc moduł startuje bez działającej bazy.
    const moduleRef = await Test.createTestingModule({
      imports: [TestConfigModule, DbModule],
    }).compile();
    const pool = moduleRef.get<Pool>(PG_POOL);

    expect(pool).toBeInstanceOf(Pool);
    expect(pool.options.max).toBe(3);
    expect(moduleRef.get(DRIZZLE)).toBeInstanceOf(NodePgDatabase);
    expect(moduleRef.get(DatabaseHealth)).toBeInstanceOf(DatabaseHealth);

    await moduleRef.close();

    expect(pool.ended).toBe(true);
  });
});

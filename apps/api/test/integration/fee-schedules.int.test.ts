// Kryteria F-13 na prawdziwym Postgresie (Testcontainers): startowy cennik POK z migracji,
// endpoint bieżącego cennika, publikacja nowego cennika bez przerwy i nakładania okresów,
// przeliczenie zamówienia według jego cennika po zmianie stawek i niezmienność wierszy w bazie.
import { type FeeSchedule, money } from '@biddy/shared';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DomainError } from '../../src/infra/http/index.js';
import { FeeScheduleService } from '../../src/modules/payments/index.js';
import { integrationConfig, problemOf, startTestApp, type TestApp } from './support/app.js';
import type { ScratchDatabase } from './support/database.js';
import { createMigratedDatabase, redisUrl, uniqueQueuePrefix } from './support/worker.js';

/** Startowy cennik z migracji 0009_initial_fee_schedule. */
const INITIAL_ID = '019b76da-a800-7473-8d63-395c20bf8898';

let database: ScratchDatabase;
let pool: Pool;
let api: TestApp;
let service: FeeScheduleService;

beforeAll(async () => {
  database = await createMigratedDatabase();
  pool = new Pool({ connectionString: database.url, max: 2 });
  api = await startTestApp(
    integrationConfig({
      DATABASE_URL: database.url,
      REDIS_QUEUE_URL: redisUrl(),
      QUEUE_PREFIX: uniqueQueuePrefix(),
    }),
  );
  service = api.app.get(FeeScheduleService);
});

afterAll(async () => {
  await api.close();
  await pool.end();
  await database.drop();
});

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('oczekiwano błędu');
    },
    (caught: unknown) => caught,
  );
}

const HOUR = 60 * 60 * 1_000;

describe('startowy cennik z migracji', () => {
  it('PLN: 2,99 zł + 7% do 1000 zł + 4% nadwyżki, VAT 23%, bez końca', async () => {
    expect(await service.current('PLN')).toEqual({
      id: INITIAL_ID,
      currency: 'PLN',
      fixedFee: 299,
      tiers: [
        { upTo: 100_000, bp: 700 },
        { upTo: null, bp: 400 },
      ],
      vatRateBp: 2300,
      validFrom: new Date('2026-01-01T00:00:00Z'),
      validTo: null,
      note: 'Startowy cennik (PROJECT.md §3.1)',
    });
  });

  it('quote: POK z identyfikatorem cennika do zapisania w zamówieniu', async () => {
    expect(await service.quote(money(300_000))).toMatchObject({
      feeScheduleId: INITIAL_ID,
      fee: money(15_299),
      net: money(12_438),
      vat: money(2_861),
      total: money(315_299),
    });
  });

  it('przed początkiem obowiązywania nie ma cennika', async () => {
    expect(await service.current('PLN', new Date('2025-12-31T23:59:59Z'))).toBeUndefined();
    await expect(service.quote(money(100), new Date('2025-06-01T00:00:00Z'))).rejects.toThrow(
      /Brak cennika POK/,
    );
  });
});

describe('GET /v1/fee-schedules/current', () => {
  it('bieżący cennik z krótkim cache publicznym', async () => {
    const response = await api.http.inject({ method: 'GET', url: '/v1/fee-schedules/current' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    expect(response.json()).toEqual({
      id: INITIAL_ID,
      currency: 'PLN',
      fixedFee: 299,
      tiers: [
        { upTo: 100_000, bp: 700 },
        { upTo: null, bp: 400 },
      ],
      vatRateBp: 2300,
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: null,
    });
  });

  it('nieobsługiwana waluta: 400', async () => {
    const response = await api.http.inject({
      method: 'GET',
      url: '/v1/fee-schedules/current?currency=EUR',
    });
    expect(response.statusCode).toBe(400);
    expect(problemOf(response).code).toBe('VALIDATION_FAILED');
  });
});

describe('zmiana cennika', () => {
  const next: FeeSchedule = {
    currency: 'PLN',
    fixedFee: 349,
    tiers: [
      { upTo: 50_000, bp: 800 },
      { upTo: null, bp: 500 },
    ],
    vatRateBp: 2300,
  };

  it('błędny cennik i data w przeszłości: VALIDATION_FAILED z błędami pól', async () => {
    const invalid = await rejection(
      service.publish({
        schedule: { ...next, tiers: [{ upTo: 100, bp: 700 }] },
        validFrom: new Date(Date.now() + HOUR),
      }),
    );
    expect(invalid).toBeInstanceOf(DomainError);
    expect((invalid as DomainError).errors?.map((error) => error.path)).toEqual([
      'schedule.tiers.0.upTo',
    ]);

    const past = await rejection(
      service.publish({ schedule: next, validFrom: new Date(Date.now() - HOUR) }),
    );
    expect((past as DomainError).errors?.[0]?.path).toBe('validFrom');
    expect((await service.current('PLN'))?.id).toBe(INITIAL_ID);
  });

  it('nowy cennik od wskazanej chwili; stare zamówienie przelicza się po staremu', async () => {
    const order = await service.quote(money(300_000));
    const validFrom = new Date(Date.now() + HOUR);

    const published = await service.publish({ schedule: next, validFrom, note: 'Test F-13' });
    expect(published).toMatchObject({ ...next, validFrom, validTo: null, note: 'Test F-13' });

    // Granica: poprzedni cennik obowiązuje do validFrom (wyłącznie), nowy od validFrom.
    expect((await service.get(INITIAL_ID))?.validTo).toEqual(validFrom);
    expect((await service.current('PLN'))?.id).toBe(INITIAL_ID);
    expect((await service.current('PLN', new Date(validFrom.getTime() - 1)))?.id).toBe(INITIAL_ID);
    expect((await service.current('PLN', validFrom))?.id).toBe(published.id);

    // 300 zł… nowym cennikiem: 3,49 zł + 8% z 500 zł + 5% z 2500 zł = 168,49 zł.
    expect(await service.quote(money(300_000), validFrom)).toMatchObject({
      feeScheduleId: published.id,
      fee: money(16_849),
    });
    expect(await service.recalculate(money(300_000), order.feeScheduleId)).toEqual(order);
  });

  it('kolejny cennik musi zaczynać się po ostatnim opublikowanym', async () => {
    const error = await rejection(
      service.publish({ schedule: next, validFrom: new Date(Date.now() + HOUR / 2) }),
    );
    expect((error as DomainError).errors?.[0]).toMatchObject({
      path: 'validFrom',
      message: expect.stringContaining('po początku ostatniego opublikowanego') as string,
    });
  });
});

describe('niezmienność w bazie', () => {
  it('UPDATE stawek, ponowne zamknięcie i DELETE są odrzucane', async () => {
    for (const statement of [
      `update fee_schedules set fixed_fee = 0 where id = '${INITIAL_ID}'`,
      `update fee_schedules set tiers = '[{"upTo":null,"bp":0}]' where id = '${INITIAL_ID}'`,
      `update fee_schedules set valid_to = now() + interval '1 year' where id = '${INITIAL_ID}'`,
      `delete from fee_schedules where id = '${INITIAL_ID}'`,
    ]) {
      await expect(pool.query(statement), statement).rejects.toMatchObject({
        code: '23001',
        message: expect.stringContaining('jest niezmienny') as string,
      });
    }
    expect((await service.get(INITIAL_ID))?.fixedFee).toBe(299);
  });

  it('nakładające się okresy w tej samej walucie są odrzucane (ograniczenie wykluczające)', async () => {
    await expect(
      pool.query(
        `insert into fee_schedules (id, currency, fixed_fee, tiers, vat_rate_bp, valid_from)
         values ('019b76da-a800-7473-8d63-000000000001', 'PLN', 0, '[{"upTo":null,"bp":0}]', 2300,
                 '2026-06-01T00:00:00Z')`,
      ),
    ).rejects.toMatchObject({ code: '23P01' });
  });
});

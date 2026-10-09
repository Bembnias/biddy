import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { PG_POOL } from './database.js';

/** Po tylu milisekundach bez odpowiedzi uznajemy bazę za niedostępną (readiness). */
export const DATABASE_HEALTH_TIMEOUT_MS = 2_000;

/** Sprawdzenie dostępności bazy dla health checku `/ready` (PROJECT.md §18.3). */
@Injectable()
export class DatabaseHealth {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Wysyła `select 1`. Kończy się sukcesem, gdy baza odpowie w ciągu
   * {@link DATABASE_HEALTH_TIMEOUT_MS}, w przeciwnym razie odrzuca obietnicę z opisem przyczyny.
   */
  async check(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `Baza danych nie odpowiedziała na select 1 w ciągu ${DATABASE_HEALTH_TIMEOUT_MS} ms`,
            ),
          );
        }, DATABASE_HEALTH_TIMEOUT_MS);
      });
      const query = this.pool.query('select 1').then(
        () => undefined,
        (error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error);
          throw new Error(`Baza danych jest niedostępna: ${reason}`, { cause: error });
        },
      );
      // Zapytanie, które odpowie po czasie, nie zostawia nieobsłużonego odrzucenia:
      // Promise.race subskrybuje obie obietnice.
      await Promise.race([query, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}

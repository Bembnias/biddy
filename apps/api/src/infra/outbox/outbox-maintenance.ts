import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../db/index.js';
import { ScheduledJob } from '../queues/index.js';

/** Jak długo trzymamy przekazane eventy (podgląd przy diagnozie, ponowne przekazanie ręczne). */
export const OUTBOX_RETENTION_DAYS = 7;

/**
 * Jak długo pamiętamy obsłużone eventy. Dłużej niż jakiekolwiek ponowne dostarczenie: joby
 * kończą próby w ok. 17 minut, a DLQ ponawiamy w ciągu dni, nie tygodni.
 */
export const PROCESSED_EVENTS_RETENTION_DAYS = 30;

/** Ile wierszy usuwamy jednym zapytaniem (krótkie transakcje, bez długich blokad). */
const DELETE_BATCH_SIZE = 5_000;

export interface CleanupResult {
  readonly outbox: number;
  readonly processedEvents: number;
}

/** Sprzątanie tabel outboxa: job cykliczny w kolejce `maintenance`, co godzinę. */
@Injectable()
export class OutboxMaintenance {
  private readonly logger = new Logger(OutboxMaintenance.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  @ScheduledJob({ queue: 'maintenance', name: 'outbox.cleanup', every: 60 * 60 * 1_000 })
  async cleanup(): Promise<CleanupResult> {
    const result = {
      outbox: await this.deleteInBatches(
        sql`delete from outbox where id in (
              select id from outbox
               where published_at < now() - make_interval(days => ${OUTBOX_RETENTION_DAYS})
               limit ${DELETE_BATCH_SIZE})`,
      ),
      processedEvents: await this.deleteInBatches(
        sql`delete from processed_events where (consumer, event_id) in (
              select consumer, event_id from processed_events
               where processed_at < now() - make_interval(days => ${PROCESSED_EVENTS_RETENTION_DAYS})
               limit ${DELETE_BATCH_SIZE})`,
      ),
    };
    if (result.outbox > 0 || result.processedEvents > 0) {
      this.logger.log(
        `Usunięto ${result.outbox} przekazanych eventów i ${result.processedEvents} wpisów processed_events`,
      );
    }
    return result;
  }

  private async deleteInBatches(statement: ReturnType<typeof sql>): Promise<number> {
    let total = 0;
    for (;;) {
      const { rowCount } = await this.db.execute(statement);
      total += rowCount ?? 0;
      if ((rowCount ?? 0) < DELETE_BATCH_SIZE) {
        return total;
      }
    }
  }
}

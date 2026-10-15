// Cenniki POK (F-13): wersje z okresem obowiązywania i kalkulator z @biddy/shared. Zamówienie
// (F-24) bierze `quote` i zapisuje `feeScheduleId`, a przeliczenie zamówienia (`recalculate`)
// zawsze używa tego samego cennika, nawet po zmianie stawek.
import {
  calculatePok,
  type CurrencyCode,
  DEFAULT_CURRENCY,
  type FeeSchedule,
  feeScheduleSchema,
  type Money,
  type PokQuote,
} from '@biddy/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { type FeeScheduleRow, feeSchedules } from '../db/payments.schema.js';

/** Wersja cennika z okresem obowiązywania `[validFrom, validTo)`. */
export interface FeeScheduleVersion extends FeeSchedule {
  readonly id: string;
  readonly validFrom: Date;
  /** Koniec obowiązywania (wyłącznie); null = bez końca. */
  readonly validTo: Date | null;
  readonly note: string | null;
}

/** POK z identyfikatorem cennika do zapisania w zamówieniu. */
export interface FeeQuote extends PokQuote {
  readonly feeScheduleId: string;
}

export interface PublishFeeScheduleInput {
  readonly schedule: FeeSchedule;
  /** Początek obowiązywania: teraz albo w przyszłości. */
  readonly validFrom: Date;
  readonly note?: string;
}

@Injectable()
export class FeeScheduleService {
  private readonly logger = new Logger(FeeScheduleService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Cennik obowiązujący w danej chwili albo undefined (waluta bez cennika). */
  async current(
    currency: CurrencyCode = DEFAULT_CURRENCY,
    at: Date = new Date(),
  ): Promise<FeeScheduleVersion | undefined> {
    const [row] = await this.db
      .select()
      .from(feeSchedules)
      .where(
        and(
          eq(feeSchedules.currency, currency),
          sql`tstzrange(${feeSchedules.validFrom}, ${feeSchedules.validTo}) @> ${at.toISOString()}::timestamptz`,
        ),
      );
    return row === undefined ? undefined : toVersion(row);
  }

  /** Cennik o danym identyfikatorze (także zamknięty) albo undefined. */
  async get(id: string): Promise<FeeScheduleVersion | undefined> {
    const [row] = await this.db.select().from(feeSchedules).where(eq(feeSchedules.id, id));
    return row === undefined ? undefined : toVersion(row);
  }

  /**
   * POK według cennika obowiązującego w chwili `at` (domyślnie teraz), np. przy tworzeniu
   * zamówienia. Brak cennika dla waluty to błąd konfiguracji (500 i Sentry), nie błąd klienta.
   */
  async quote(itemsTotal: Money, at: Date = new Date()): Promise<FeeQuote> {
    const schedule = await this.current(itemsTotal.currency, at);
    if (schedule === undefined) {
      throw new Error(
        `Brak cennika POK dla waluty ${itemsTotal.currency} w chwili ${at.toISOString()}`,
      );
    }
    return { feeScheduleId: schedule.id, ...calculatePok(itemsTotal, schedule) };
  }

  /** POK według cennika zapisanego w zamówieniu (np. po anulowaniu części zamówienia). */
  async recalculate(itemsTotal: Money, feeScheduleId: string): Promise<FeeQuote> {
    const schedule = await this.get(feeScheduleId);
    if (schedule === undefined) {
      throw new Error(`Nieznany cennik POK ${feeScheduleId}`);
    }
    return { feeScheduleId, ...calculatePok(itemsTotal, schedule) };
  }

  /**
   * Nowy cennik od `validFrom` (teraz albo później). Poprzedni otwarty cennik w tej walucie
   * kończy się dokładnie w tej chwili, więc nie ma przerwy ani nakładania. Zmiana stawek bez
   * deployu: do czasu panelu admina (F-34) przez tę metodę.
   *
   * @throws {DomainError} VALIDATION_FAILED: błędny cennik albo data wcześniejsza niż teraz lub
   *   niż początek ostatniego opublikowanego cennika
   */
  async publish(
    input: PublishFeeScheduleInput,
    now: Date = new Date(),
  ): Promise<FeeScheduleVersion> {
    const parsed = feeScheduleSchema.safeParse(input.schedule);
    if (!parsed.success) {
      throw new DomainError({
        code: 'VALIDATION_FAILED',
        detail: 'Popraw cennik POK.',
        errors: parsed.error.issues.map((issue) => ({
          path: ['schedule', ...issue.path].join('.'),
          code: issue.code,
          message: issue.message,
        })),
      });
    }
    if (input.validFrom.getTime() < now.getTime()) {
      throw invalidValidFrom('Nowy cennik może zacząć obowiązywać najwcześniej teraz.');
    }
    const schedule = parsed.data;
    const version = await this.db.transaction(async (tx) => {
      const [open] = await tx
        .select()
        .from(feeSchedules)
        .where(and(eq(feeSchedules.currency, schedule.currency), isNull(feeSchedules.validTo)))
        .orderBy(desc(feeSchedules.validFrom))
        .for('update');
      if (open !== undefined) {
        if (open.validFrom.getTime() >= input.validFrom.getTime()) {
          throw invalidValidFrom(
            `Nowy cennik musi zaczynać się po początku ostatniego opublikowanego (${open.validFrom.toISOString()}).`,
          );
        }
        await tx
          .update(feeSchedules)
          .set({ validTo: input.validFrom })
          .where(eq(feeSchedules.id, open.id));
      }
      const [row] = await tx
        .insert(feeSchedules)
        .values({
          currency: schedule.currency,
          fixedFee: schedule.fixedFee,
          tiers: [...schedule.tiers],
          vatRateBp: schedule.vatRateBp,
          validFrom: input.validFrom,
          note: input.note ?? null,
        })
        .returning();
      if (row === undefined) {
        throw new Error('INSERT fee_schedules nie zwrócił wiersza');
      }
      return toVersion(row);
    });
    this.logger.log(
      { feeScheduleId: version.id, currency: version.currency, validFrom: version.validFrom },
      'Opublikowano nowy cennik POK',
    );
    return version;
  }
}

function invalidValidFrom(message: string): DomainError {
  return new DomainError({
    code: 'VALIDATION_FAILED',
    detail: 'Popraw datę początku cennika.',
    errors: [{ path: 'validFrom', code: 'custom', message }],
  });
}

/** Wiersz z bazy sprawdzony schematem z @biddy/shared: uszkodzony cennik to 500, nie zła kwota. */
function toVersion(row: FeeScheduleRow): FeeScheduleVersion {
  const schedule = feeScheduleSchema.parse({
    currency: row.currency,
    fixedFee: row.fixedFee,
    tiers: row.tiers,
    vatRateBp: row.vatRateBp,
  });
  return {
    id: row.id,
    ...schedule,
    validFrom: row.validFrom,
    validTo: row.validTo,
    note: row.note,
  };
}

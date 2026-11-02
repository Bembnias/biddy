// Moduł testowy dla outboxa i kolejek: event, konsument z efektem w bazie (tabela test_effects)
// i handlery jobów. Montują go testy integracyjne (createWorker({ extraModules })) i proces
// worker-fixture.ts. Zachowanie konsumenta steruje payload (fail, hang), żeby jeden konsument
// wystarczył do sprawdzenia sukcesu, ponowień, DLQ i restartu workera.
import { Body, Controller, Inject, Injectable, Logger, Module, Post } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { z } from 'zod';

import { createZodDto } from 'nestjs-zod';

import { type Database, DRIZZLE, PG_POOL } from '../../../src/infra/db/index.js';
import {
  type DomainEventContext,
  type DomainEventOf,
  OnDomainEvent,
  Outbox,
  defineDomainEvent,
} from '../../../src/infra/outbox/index.js';
import {
  JobHandler,
  JobQueues,
  type JobRun,
  ScheduledJob,
  deadlineJobId,
} from '../../../src/infra/queues/index.js';

export const TestItemCreated = defineDomainEvent({
  type: 'TestItemCreated',
  version: 1,
  aggregateType: 'test-item',
  payload: z.object({
    title: z.string(),
    /** never: sukces; always: każda próba rzuca błąd; unrecoverable: UnrecoverableError. */
    fail: z.enum(['never', 'always', 'unrecoverable']).default('never'),
    /** Pierwsza próba zapisuje znacznik (poza transakcją) i zawiesza się na zawsze. */
    hang: z.boolean().default(false),
  }),
});

export type TestItemCreatedEvent = DomainEventOf<typeof TestItemCreated>;

/** Tabele efektów testowych (tworzy je test w swojej bazie, poza migracjami aplikacji). */
export const TEST_TABLES_SQL = `
  create table if not exists test_effects (
    event_id uuid not null,
    consumer text not null,
    title text not null,
    created_at timestamptz not null default now()
  );
  create table if not exists test_markers (
    event_id uuid primary key,
    created_at timestamptz not null default now()
  );
`;

/** Wywołania handlerów w tym procesie (także tych, które rzuciły błąd albo były duplikatem). */
@Injectable()
export class TestCalls {
  readonly events: TestItemCreatedEvent[] = [];
  readonly attempts: number[] = [];
  readonly jobs: JobRun[] = [];
  readonly ticks: JobRun[] = [];

  reset(): void {
    this.events.length = 0;
    this.attempts.length = 0;
    this.jobs.length = 0;
    this.ticks.length = 0;
  }
}

@Injectable()
export class TestItemConsumer {
  private readonly logger = new Logger(TestItemConsumer.name);

  constructor(
    private readonly calls: TestCalls,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  @OnDomainEvent(TestItemCreated, { consumer: 'test.record-item' })
  async record(event: TestItemCreatedEvent, { tx, attempt }: DomainEventContext): Promise<void> {
    this.calls.events.push(event);
    this.calls.attempts.push(attempt);
    this.logger.log(`Obsługuję ${event.payload.title}`);
    if (event.payload.hang) {
      // Znacznik poza transakcją konsumenta: test widzi go, zanim transakcja się skończy.
      const marked = await this.pool.query(
        'insert into test_markers (event_id) values ($1) on conflict do nothing',
        [event.id],
      );
      if (marked.rowCount === 1) {
        await new Promise<never>(() => undefined);
      }
    }
    if (event.payload.fail === 'always') {
      throw new Error(`Celowy błąd konsumenta (próba ${attempt})`);
    }
    if (event.payload.fail === 'unrecoverable') {
      throw new UnrecoverableError('Celowy błąd bez ponowień');
    }
    await tx.execute(
      sql`insert into test_effects (event_id, consumer, title) values (${event.id}, 'test.record-item', ${event.payload.title})`,
    );
  }

  /** Drugi konsument tego samego eventu: dostaje własny job, niezależny od pierwszego. */
  @OnDomainEvent(TestItemCreated, { consumer: 'test.second-consumer' })
  async second(event: TestItemCreatedEvent, { tx }: DomainEventContext): Promise<void> {
    await tx.execute(
      sql`insert into test_effects (event_id, consumer, title) values (${event.id}, 'test.second-consumer', ${event.payload.title})`,
    );
  }
}

export interface DeadlineJobData {
  readonly entityId: string;
  /** Termin, na który zaplanowano ten job (ms od epoki). */
  readonly deadline: number;
}

/**
 * Handlery jobów: termin przesuwany w trakcie wykonania (jak przedłużona aukcja, PROJECT.md
 * §15.2), zawsze nieudany job i job cykliczny.
 */
@Injectable()
export class TestJobs {
  /** Aktualny termin encji (jak ends_at aukcji); test przesuwa go w trakcie wykonania joba. */
  readonly deadlines = new Map<string, number>();
  /** Zmiana terminu wykonywana na początku joba (symuluje ofertę w ostatniej chwili). */
  readonly extendOnFirstRun = new Map<string, number>();

  constructor(
    private readonly calls: TestCalls,
    private readonly queues: JobQueues,
  ) {}

  @JobHandler('maintenance', 'test.deadline')
  async deadline(job: JobRun<DeadlineJobData>): Promise<string> {
    this.calls.jobs.push(job);
    const { entityId, deadline } = job.data;
    const extended = this.extendOnFirstRun.get(entityId);
    if (extended !== undefined) {
      this.extendOnFirstRun.delete(entityId);
      this.deadlines.set(entityId, extended);
    }
    const current = this.deadlines.get(entityId) ?? deadline;
    if (current > deadline) {
      // Termin się przesunął: nowy job z ID dla nowego terminu, z wnętrza tego joba.
      await this.queues.add(
        'maintenance',
        'test.deadline',
        { entityId, deadline: current },
        { jobId: deadlineJobId('test-deadline', entityId, current), runAt: new Date(current) },
      );
      return 'rescheduled';
    }
    return 'done';
  }

  /**
   * Antywzorzec ze stałym ID: pierwsze wykonanie próbuje zaplanować job o swoim własnym ID na
   * później. BullMQ pomija takie dodanie, bo job o tym ID istnieje (jest aktywny).
   */
  @JobHandler('maintenance', 'test.same-id')
  async sameId(job: JobRun<{ readonly entityId: string }>): Promise<string> {
    this.calls.jobs.push(job);
    if (this.calls.jobs.filter((run) => run.name === 'test.same-id').length === 1) {
      const addedId = await this.queues.add('maintenance', 'test.same-id', job.data, {
        jobId: job.id,
        runAt: new Date(Date.now() + 200),
      });
      return `added:${addedId}`;
    }
    return 'second-run';
  }

  @JobHandler('maintenance', 'test.always-fails')
  alwaysFails(job: JobRun): never {
    this.calls.jobs.push(job);
    throw new Error(`Celowy błąd joba (próba ${job.attempt} z ${job.maxAttempts})`);
  }

  @ScheduledJob({ queue: 'maintenance', name: 'test.tick', every: 1_000 })
  tick(job: JobRun): void {
    this.calls.ticks.push(job);
  }
}

@Module({
  providers: [TestCalls, TestItemConsumer, TestJobs],
  exports: [TestCalls, TestJobs],
})
export class OutboxTestModule {}

class CreateTestItemDto extends createZodDto(z.object({ title: z.string().min(1) })) {}

/** Kontroler w API: event zapisany w transakcji obsługi żądania HTTP. */
@Controller('integration-test/items')
export class TestItemsController {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly outbox: Outbox,
  ) {}

  @Post()
  async create(@Body() body: CreateTestItemDto): Promise<{ eventId: string }> {
    const [eventId] = await this.db.transaction((tx) =>
      this.outbox.add(
        tx,
        TestItemCreated.create({
          aggregateId: `item-${body.title}`,
          payload: { title: body.title },
        }),
      ),
    );
    return { eventId: eventId ?? '' };
  }
}

@Module({ controllers: [TestItemsController] })
export class OutboxHttpTestModule {}

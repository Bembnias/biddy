// Asynchroniczność FakeGateway (F-23, PROJECT.md §7.8): rozliczenie po opóźnieniu i wysyłka
// webhooka to joby BullMQ w kolejce `payments`, jak u prawdziwego operatora, który potwierdza
// płatność później i sam woła nasz endpoint. Interfejs pozwala testom kontraktowym rozliczać
// bez kolejki.
import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../../../infra/config/index.js';
import { JobQueues } from '../../../../infra/queues/index.js';

/** Rozliczenie obiektu FakeGateway (płatność z magicznym kodem BLIK, zwrot, wypłata). */
export type FakeSettleJob =
  | { readonly kind: 'payment'; readonly id: string; readonly outcome: 'SUCCEEDED' | 'FAILED' }
  | { readonly kind: 'refund' | 'payout'; readonly id: string };

export interface FakeDeliverJob {
  readonly eventId: string;
}

export const FAKE_SETTLE_JOB = 'fake-gateway.settle';
export const FAKE_DELIVER_JOB = 'fake-gateway.deliver';

export interface FakeGatewaySchedule {
  /** Rozliczenie po opóźnieniu PAYMENTS_FAKE_WEBHOOK_DELAY_MS (jednokrotne dla obiektu). */
  settleLater(job: FakeSettleJob): Promise<void>;
  /** Wysyłka webhooka od razu; `delivery` odróżnia ponowne dostarczenie tego samego zdarzenia. */
  deliver(eventId: string, delivery?: number): Promise<void>;
}

export const FAKE_GATEWAY_SCHEDULE = Symbol('FAKE_GATEWAY_SCHEDULE');

@Injectable()
export class QueuedFakeGatewaySchedule implements FakeGatewaySchedule {
  constructor(
    private readonly jobs: JobQueues,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async settleLater(job: FakeSettleJob): Promise<void> {
    await this.jobs.add('payments', FAKE_SETTLE_JOB, job, {
      // ID z obiektu: ponowione zlecenie (np. po idempotentnym createPayment) nie dubluje joba.
      jobId: `fake-settle-${job.kind}-${job.id}`,
      runAt: new Date(Date.now() + this.config.payments.fake.webhookDelayMs),
    });
  }

  async deliver(eventId: string, delivery = 0): Promise<void> {
    await this.jobs.add('payments', FAKE_DELIVER_JOB, { eventId } satisfies FakeDeliverJob, {
      jobId: `fake-deliver-${eventId}-${delivery}`,
    });
  }
}

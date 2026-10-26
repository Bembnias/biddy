// Asynchroniczność FakeShipping (F-24): kolejne statusy automatu i wysyłka webhooka to joby
// BullMQ w kolejce `shipping`, jak u prawdziwego dostawcy, który zmienia status później i sam
// woła nasz endpoint. Interfejs pozwala testom kontraktowym działać bez kolejki.
import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../../../infra/config/index.js';
import { JobQueues } from '../../../../infra/queues/index.js';
import type { FakeParcelStatus } from '../../db/fake-shipping.schema.js';

export interface FakeAdvanceJob {
  readonly parcelId: string;
  /** Status, z którego automat przechodzi dalej; inny bieżący status = job nieaktualny. */
  readonly from: FakeParcelStatus;
}

export interface FakeDeliverJob {
  readonly webhookId: string;
}

export const FAKE_SHIPPING_ADVANCE_JOB = 'fake-shipping.advance';
export const FAKE_SHIPPING_DELIVER_JOB = 'fake-shipping.deliver';

export interface FakeShippingSchedule {
  /** Następny status automatu po SHIPPING_FAKE_STEP_DELAY_MS (nic, gdy automat wyłączony). */
  advanceLater(parcelId: string, from: FakeParcelStatus): Promise<void>;
  /** Wysyłka webhooka od razu. */
  deliver(webhookId: string): Promise<void>;
}

export const FAKE_SHIPPING_SCHEDULE = Symbol('FAKE_SHIPPING_SCHEDULE');

@Injectable()
export class QueuedFakeShippingSchedule implements FakeShippingSchedule {
  constructor(
    private readonly jobs: JobQueues,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async advanceLater(parcelId: string, from: FakeParcelStatus): Promise<void> {
    const delay = this.config.shipping.fake.stepDelayMs;
    if (delay === 0) {
      return;
    }
    await this.jobs.add(
      'shipping',
      FAKE_SHIPPING_ADVANCE_JOB,
      { parcelId, from } satisfies FakeAdvanceJob,
      // ID ze statusu: ten sam krok zaplanowany dwa razy (np. panel i automat) to jeden job.
      { jobId: `fake-shipping-advance-${parcelId}-${from}`, runAt: new Date(Date.now() + delay) },
    );
  }

  async deliver(webhookId: string): Promise<void> {
    await this.jobs.add(
      'shipping',
      FAKE_SHIPPING_DELIVER_JOB,
      { webhookId } satisfies FakeDeliverJob,
      { jobId: `fake-shipping-deliver-${webhookId}` },
    );
  }
}

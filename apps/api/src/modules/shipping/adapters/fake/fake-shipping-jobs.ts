// Handlery jobów FakeShipping w workerze (F-24): krok automatu i wysyłka webhooka. Krok
// z nieaktualnego statusu nic nie robi, a ponowiony webhook to tylko kolejna synchronizacja
// trackingu (zdarzenia zapisują się unikalnie).
import { Injectable } from '@nestjs/common';

import { JobHandler, type JobRun } from '../../../../infra/queues/index.js';
import {
  FAKE_SHIPPING_ADVANCE_JOB,
  FAKE_SHIPPING_DELIVER_JOB,
  type FakeAdvanceJob,
  type FakeDeliverJob,
} from './fake-shipping-schedule.js';
import { FakeShippingSimulator } from './fake-shipping-simulator.js';

@Injectable()
export class FakeShippingJobs {
  constructor(private readonly simulator: FakeShippingSimulator) {}

  @JobHandler('shipping', FAKE_SHIPPING_ADVANCE_JOB)
  async advance(job: JobRun<FakeAdvanceJob>): Promise<void> {
    await this.simulator.advance(job.data.parcelId, { from: job.data.from });
  }

  @JobHandler('shipping', FAKE_SHIPPING_DELIVER_JOB)
  async deliver(job: JobRun<FakeDeliverJob>): Promise<void> {
    await this.simulator.deliver(job.data.webhookId);
  }
}

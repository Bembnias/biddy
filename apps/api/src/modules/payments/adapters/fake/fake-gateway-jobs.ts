// Handlery jobów FakeGateway w workerze (F-23): rozliczenie z opóźnieniem i wysyłka webhooka.
// Oba są idempotentne: ponowione rozliczenie wysyła ponownie to samo zdarzenie, a nasz endpoint
// pomija zdarzenia już przetworzone (processed_webhooks).
import { Injectable } from '@nestjs/common';

import { JobHandler, type JobRun } from '../../../../infra/queues/index.js';
import {
  FAKE_DELIVER_JOB,
  FAKE_SETTLE_JOB,
  type FakeDeliverJob,
  type FakeSettleJob,
} from './fake-gateway-schedule.js';
import { FakeGatewaySimulator } from './fake-gateway-simulator.js';

@Injectable()
export class FakeGatewayJobs {
  constructor(private readonly simulator: FakeGatewaySimulator) {}

  @JobHandler('payments', FAKE_SETTLE_JOB)
  async settle(job: JobRun<FakeSettleJob>): Promise<void> {
    const data = job.data;
    if (data.kind === 'payment') {
      await this.simulator.settlePayment(data.id, data.outcome, { idempotent: true });
    } else if (data.kind === 'refund') {
      await this.simulator.settleRefund(data.id);
    } else {
      await this.simulator.settlePayout(data.id);
    }
  }

  @JobHandler('payments', FAKE_DELIVER_JOB)
  async deliver(job: JobRun<FakeDeliverJob>): Promise<void> {
    await this.simulator.deliver(job.data.eventId);
  }
}

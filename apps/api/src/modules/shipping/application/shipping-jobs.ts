// Handlery jobów modułu shipping w workerze (F-24): utworzenie przesyłki u dostawcy po „Nadaj”,
// ponowne pobranie etykiety, synchronizacja trackingu po webhooku i polling zapasowy. Wszystkie
// są idempotentne: sprawdzają aktualny stan przesyłki, a tracking zapisuje zdarzenia unikalnie.
import { Injectable } from '@nestjs/common';

import { JobHandler, type JobRun, ScheduledJob } from '../../../infra/queues/index.js';
import {
  type CreateShipmentJob,
  type FetchLabelJob,
  SHIPPING_CREATE_JOB,
  SHIPPING_FETCH_LABEL_JOB,
  ShipmentService,
} from './shipment.service.js';
import {
  SHIPPING_POLL_TRACKING_JOB,
  SHIPPING_SYNC_TRACKING_JOB,
  type SyncTrackingJob,
  TRACKING_POLL_EVERY_MS,
  TrackingSync,
} from './tracking-sync.js';

@Injectable()
export class ShippingJobs {
  constructor(
    private readonly shipments: ShipmentService,
    private readonly tracking: TrackingSync,
  ) {}

  @JobHandler('shipping', SHIPPING_CREATE_JOB)
  async create(job: JobRun<CreateShipmentJob>): Promise<void> {
    await this.shipments.createAtProvider(job.data, {
      finalAttempt: job.attempt >= job.maxAttempts,
    });
  }

  @JobHandler('shipping', SHIPPING_FETCH_LABEL_JOB)
  async fetchLabel(job: JobRun<FetchLabelJob>): Promise<void> {
    await this.shipments.fetchLabel(job.data.shipmentId);
  }

  @JobHandler('shipping', SHIPPING_SYNC_TRACKING_JOB)
  async syncTracking(job: JobRun<SyncTrackingJob>): Promise<void> {
    await this.tracking.sync(job.data.shipmentId);
  }

  @ScheduledJob({
    queue: 'shipping',
    name: SHIPPING_POLL_TRACKING_JOB,
    every: TRACKING_POLL_EVERY_MS,
  })
  async pollTracking(): Promise<void> {
    await this.tracking.pollActive();
  }
}

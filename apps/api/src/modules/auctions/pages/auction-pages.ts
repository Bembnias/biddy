// Świeżość strony aukcji w web (F-18, PROJECT.md §11.3): po zmianie widocznej na stronie worker
// planuje rewalidację ISR, najwyżej raz na 5 s na aukcję. Okno ma koniec w ID joba
// (`revalidate-page-{auctionId}-{koniecOkna}`): zdarzenia z jednego okna dają jeden job (BullMQ
// pomija istniejące ID), wykonany na końcu okna, więc ostatnia zmiana w oknie też trafi na stronę.
// AuctionExtended nie ma konsumenta: przedłużenie zawsze idzie z BidPlaced w tej samej transakcji.
import { auctionCacheTag } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { type DomainEventOf, OnDomainEvent } from '../../../infra/outbox/index.js';
import { deadlineJobId, JobHandler, JobQueues, type JobRun } from '../../../infra/queues/index.js';
import { WebRevalidator } from '../../../infra/web/index.js';
import {
  AuctionCancelled,
  AuctionEnded,
  AuctionPublished,
  AuctionUpdated,
  BidCancelled,
  BidPlaced,
} from '../auctions.events.js';
import { auctions } from '../db/auctions.schema.js';

/** Okno rewalidacji jednej strony. */
export const PAGE_REVALIDATION_WINDOW_MS = 5_000;
export const REVALIDATE_PAGE_JOB = 'auction.revalidate-page';

/** Koniec okna, w którym wypada `now` (chwila na granicy zaczyna nowe okno). */
export function revalidationWindowEnd(now: number): number {
  return (Math.floor(now / PAGE_REVALIDATION_WINDOW_MS) + 1) * PAGE_REVALIDATION_WINDOW_MS;
}

@Injectable()
export class AuctionPages {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(WebRevalidator) private readonly revalidator: WebRevalidator,
    private readonly jobs: JobQueues,
  ) {}

  @OnDomainEvent(AuctionPublished, { consumer: 'auctions.page-published' })
  async onPublished(event: DomainEventOf<typeof AuctionPublished>): Promise<void> {
    await this.schedule(event.aggregateId);
  }

  @OnDomainEvent(AuctionUpdated, { consumer: 'auctions.page-updated' })
  async onUpdated(event: DomainEventOf<typeof AuctionUpdated>): Promise<void> {
    await this.schedule(event.aggregateId);
  }

  @OnDomainEvent(BidPlaced, { consumer: 'auctions.page-bid-placed' })
  async onBidPlaced(event: DomainEventOf<typeof BidPlaced>): Promise<void> {
    await this.schedule(event.aggregateId);
  }

  @OnDomainEvent(BidCancelled, { consumer: 'auctions.page-bid-cancelled' })
  async onBidCancelled(event: DomainEventOf<typeof BidCancelled>): Promise<void> {
    await this.schedule(event.aggregateId);
  }

  @OnDomainEvent(AuctionEnded, { consumer: 'auctions.page-ended' })
  async onEnded(event: DomainEventOf<typeof AuctionEnded>): Promise<void> {
    await this.schedule(event.aggregateId);
  }

  @OnDomainEvent(AuctionCancelled, { consumer: 'auctions.page-cancelled' })
  async onCancelled(event: DomainEventOf<typeof AuctionCancelled>): Promise<void> {
    await this.schedule(event.aggregateId);
  }

  /** Job rewalidacji na koniec bieżącego okna; bez skonfigurowanej rewalidacji nic nie robi. */
  async schedule(auctionId: string, now: number = Date.now()): Promise<void> {
    if (!this.revalidator.enabled) {
      return;
    }
    const windowEnd = revalidationWindowEnd(now);
    await this.jobs.add(
      'web',
      REVALIDATE_PAGE_JOB,
      { auctionId },
      {
        jobId: deadlineJobId('revalidate-page', auctionId, windowEnd),
        runAt: new Date(windowEnd),
      },
    );
  }

  @JobHandler('web', REVALIDATE_PAGE_JOB)
  async revalidate(job: JobRun<{ auctionId: string }>): Promise<void> {
    const [auction] = await this.db
      .select({ publicId: auctions.publicId })
      .from(auctions)
      .where(eq(auctions.id, job.data.auctionId));
    if (auction === undefined) {
      return;
    }
    await this.revalidator.revalidate([auctionCacheTag(auction.publicId)]);
  }
}

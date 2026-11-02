// Synchronizacja indeksu aukcji (F-19, PROJECT.md §15.5): eventy z outboxa planują job na koniec
// 5-sekundowego okna (ID joba z końcem okna), więc seria ofert daje jedną aktualizację (debounce
// zmian cen), a nowa aukcja jest wyszukiwalna po kilku sekundach. Job czyta aktualny stan:
// aktywna aukcja → pełny dokument, inna → usunięcie. Nocny reindeks wyrównuje rozjazdy.
import { Inject, Injectable, Logger } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../../infra/config/index.js';
import { type DomainEventOf, OnDomainEvent } from '../../../infra/outbox/index.js';
import {
  deadlineJobId,
  JobHandler,
  JobQueues,
  type JobRun,
  ScheduledJob,
} from '../../../infra/queues/index.js';
import { MeiliClient } from '../../../infra/search/index.js';
import {
  AuctionCancelled,
  AuctionEnded,
  AuctionPublished,
  AuctionSearchSource,
  AuctionUpdated,
  BidCancelled,
  BidPlaced,
} from '../../auctions/index.js';
import { AUCTION_INDEX_SETTINGS, auctionIndexName, toAuctionDocument } from './auction-document.js';

/** Okno aktualizacji jednego dokumentu. */
export const INDEX_WINDOW_MS = 5_000;
export const INDEX_AUCTION_JOB = 'search.index-auction';
/** Partia nocnego reindeksu. */
const REINDEX_BATCH = 500;

/** Koniec okna, w którym wypada `now` (chwila na granicy zaczyna nowe okno). */
export function indexWindowEnd(now: number): number {
  return (Math.floor(now / INDEX_WINDOW_MS) + 1) * INDEX_WINDOW_MS;
}

@Injectable()
export class AuctionIndexer {
  private readonly logger = new Logger(AuctionIndexer.name);
  private readonly index: string;
  /** Indeks z aktualnymi ustawieniami (raz na proces; po błędzie kolejna próba). */
  private ready: Promise<void> | undefined;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(AuctionSearchSource) private readonly source: AuctionSearchSource,
    @Inject(MeiliClient) private readonly meili: MeiliClient,
    private readonly jobs: JobQueues,
  ) {
    this.index = auctionIndexName(config.search.indexPrefix);
  }

  @OnDomainEvent(AuctionPublished, { consumer: 'search.index-published' })
  async onPublished(event: DomainEventOf<typeof AuctionPublished>): Promise<void> {
    await this.schedule(event.aggregateId);
  }

  @OnDomainEvent(AuctionUpdated, { consumer: 'search.index-updated' })
  async onUpdated(event: DomainEventOf<typeof AuctionUpdated>): Promise<void> {
    await this.schedule(event.aggregateId);
  }

  @OnDomainEvent(BidPlaced, { consumer: 'search.index-bid-placed' })
  async onBidPlaced(event: DomainEventOf<typeof BidPlaced>): Promise<void> {
    await this.schedule(event.aggregateId);
  }

  @OnDomainEvent(BidCancelled, { consumer: 'search.index-bid-cancelled' })
  async onBidCancelled(event: DomainEventOf<typeof BidCancelled>): Promise<void> {
    await this.schedule(event.aggregateId);
  }

  @OnDomainEvent(AuctionEnded, { consumer: 'search.index-ended' })
  async onEnded(event: DomainEventOf<typeof AuctionEnded>): Promise<void> {
    await this.schedule(event.aggregateId);
  }

  @OnDomainEvent(AuctionCancelled, { consumer: 'search.index-cancelled' })
  async onCancelled(event: DomainEventOf<typeof AuctionCancelled>): Promise<void> {
    await this.schedule(event.aggregateId);
  }

  /** Job aktualizacji dokumentu na koniec bieżącego okna (zdarzenia z okna: ten sam job). */
  async schedule(auctionId: string, now: number = Date.now()): Promise<void> {
    const windowEnd = indexWindowEnd(now);
    await this.jobs.add(
      'search',
      INDEX_AUCTION_JOB,
      { auctionId },
      {
        jobId: deadlineJobId('index-auction', auctionId, windowEnd),
        runAt: new Date(windowEnd),
      },
    );
  }

  @JobHandler('search', INDEX_AUCTION_JOB)
  async indexAuction(job: JobRun<{ auctionId: string }>): Promise<void> {
    await this.sync([job.data.auctionId]);
  }

  /**
   * Aktualny stan aukcji w indeksie: aktywne jako pełne dokumenty, pozostałe usunięte. Czeka na
   * zadania Meilisearch, więc błąd indeksowania kończy job błędem (ponowienie).
   */
  async sync(auctionIds: readonly string[]): Promise<{ indexed: number; removed: number }> {
    await this.ensureIndex();
    const entries = await this.source.entries(auctionIds);
    const active = new Set(entries.map((entry) => entry.id));
    const removed = auctionIds.filter((id) => !active.has(id));
    const tasks: number[] = [];
    if (entries.length > 0) {
      tasks.push(await this.meili.replaceDocuments(this.index, entries.map(toAuctionDocument)));
    }
    if (removed.length > 0) {
      tasks.push(await this.meili.deleteDocuments(this.index, removed));
    }
    for (const task of tasks) {
      await this.meili.waitForTask(task);
    }
    return { indexed: entries.length, removed: removed.length };
  }

  /** Nocny pełny reindeks: ustawienia, wszystkie aktywne aukcje i usunięcie pozostałych. */
  @ScheduledJob({ queue: 'search', name: 'search.reindex', pattern: '0 3 * * *' })
  async reindex(): Promise<{ indexed: number; removed: number }> {
    this.ready = undefined;
    const active = new Set<string>();
    let indexed = 0;
    for (let after: string | null = null; ;) {
      const ids = await this.source.activeIds(after, REINDEX_BATCH);
      if (ids.length === 0) {
        break;
      }
      indexed += (await this.sync(ids)).indexed;
      for (const id of ids) {
        active.add(id);
      }
      after = ids.at(-1) ?? null;
    }
    const stale: string[] = [];
    for (let offset = 0; ; offset += REINDEX_BATCH) {
      const page = await this.meili.fetchDocuments<{ id: string }>(this.index, {
        fields: ['id'],
        limit: REINDEX_BATCH,
        offset,
      });
      stale.push(...page.results.map((document) => document.id).filter((id) => !active.has(id)));
      if (offset + REINDEX_BATCH >= page.total) {
        break;
      }
    }
    if (stale.length > 0) {
      await this.meili.waitForTask(await this.meili.deleteDocuments(this.index, stale));
    }
    this.logger.log({ indexed, removed: stale.length }, 'Pełny reindeks wyszukiwarki');
    return { indexed, removed: stale.length };
  }

  private ensureIndex(): Promise<void> {
    this.ready ??= this.meili
      .updateSettings(this.index, AUCTION_INDEX_SETTINGS)
      .catch((error: unknown) => {
        this.ready = undefined;
        throw error;
      });
    return this.ready;
  }
}

import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../../../infra/config/index.js';
import type { JobQueues } from '../../../infra/queues/index.js';
import type { MeiliClient } from '../../../infra/search/index.js';
import type { AuctionSearchSource } from '../../auctions/index.js';
import { AuctionIndexer, INDEX_AUCTION_JOB, indexWindowEnd } from './auction-indexer.js';

const AUCTION_ID = '01960000-0000-7000-8000-0000000000a1';

describe('debounce indeksowania', () => {
  it('koniec 5-sekundowego okna; chwila na granicy zaczyna nowe okno', () => {
    expect(indexWindowEnd(10_001)).toBe(15_000);
    expect(indexWindowEnd(14_999)).toBe(15_000);
    expect(indexWindowEnd(15_000)).toBe(20_000);
  });

  it('seria zdarzeń w oknie daje jeden job (to samo ID) na koniec okna', async () => {
    const add = vi.fn((..._args: unknown[]) => Promise.resolve('job'));
    const indexer = new AuctionIndexer(
      { search: { indexPrefix: 'test' } } as AppConfig,
      {} as AuctionSearchSource,
      {} as MeiliClient,
      { add } as unknown as JobQueues,
    );
    await indexer.schedule(AUCTION_ID, 10_100);
    await indexer.schedule(AUCTION_ID, 12_000);
    await indexer.schedule(AUCTION_ID, 15_200);
    expect(add.mock.calls.map((call) => call[3])).toEqual([
      { jobId: `index-auction-${AUCTION_ID}-15000`, runAt: new Date(15_000) },
      { jobId: `index-auction-${AUCTION_ID}-15000`, runAt: new Date(15_000) },
      { jobId: `index-auction-${AUCTION_ID}-20000`, runAt: new Date(20_000) },
    ]);
    expect(add.mock.calls[0]?.slice(0, 3)).toEqual([
      'search',
      INDEX_AUCTION_JOB,
      { auctionId: AUCTION_ID },
    ]);
  });
});

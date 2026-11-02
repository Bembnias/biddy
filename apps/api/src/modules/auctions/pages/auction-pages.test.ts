import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../../../infra/db/index.js';
import type { JobQueues } from '../../../infra/queues/index.js';
import type { WebRevalidator } from '../../../infra/web/index.js';
import { AuctionPages, REVALIDATE_PAGE_JOB, revalidationWindowEnd } from './auction-pages.js';

const AUCTION_ID = '01960000-0000-7000-8000-0000000000a1';

function pages(enabled: boolean) {
  const add = vi.fn((..._args: unknown[]) => Promise.resolve('job'));
  const service = new AuctionPages(
    {} as Database,
    { enabled } as WebRevalidator,
    { add } as unknown as JobQueues,
  );
  return { service, add };
}

describe('revalidationWindowEnd', () => {
  it('koniec 5-sekundowego okna; chwila na granicy zaczyna nowe okno', () => {
    expect(revalidationWindowEnd(10_001)).toBe(15_000);
    expect(revalidationWindowEnd(14_999)).toBe(15_000);
    expect(revalidationWindowEnd(15_000)).toBe(20_000);
  });
});

describe('AuctionPages.schedule', () => {
  it('zdarzenia z jednego okna: jeden job (to samo ID) na koniec okna', async () => {
    const { service, add } = pages(true);
    await service.schedule(AUCTION_ID, 10_001);
    await service.schedule(AUCTION_ID, 14_999);
    await service.schedule(AUCTION_ID, 15_000);
    expect(add.mock.calls).toEqual([
      [
        'web',
        REVALIDATE_PAGE_JOB,
        { auctionId: AUCTION_ID },
        { jobId: `revalidate-page-${AUCTION_ID}-15000`, runAt: new Date(15_000) },
      ],
      [
        'web',
        REVALIDATE_PAGE_JOB,
        { auctionId: AUCTION_ID },
        { jobId: `revalidate-page-${AUCTION_ID}-15000`, runAt: new Date(15_000) },
      ],
      [
        'web',
        REVALIDATE_PAGE_JOB,
        { auctionId: AUCTION_ID },
        { jobId: `revalidate-page-${AUCTION_ID}-20000`, runAt: new Date(20_000) },
      ],
    ]);
  });

  it('bez sekretu rewalidacji (lokalnie) nie planuje jobów', async () => {
    const { service, add } = pages(false);
    await service.schedule(AUCTION_ID, 10_000);
    expect(add).not.toHaveBeenCalled();
  });
});

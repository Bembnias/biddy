'use client';

import { type MyBidsDto, getGetMyBidsQueryKey, getMyBids } from '@biddy/api-client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Gavel, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { type MyBidEntry, bidRow } from '@/lib/my-biddy/next-action';
import { routes } from '@/lib/routes';

import { AuctionRow } from './auction-row';
import { filterPillClasses } from './listing-card';
import { MY_BIDS_KEY, useLiveCard } from './use-live-lists';

type Status = 'ACTIVE' | 'WON' | 'LOST';
type Filter = 'all' | 'leading' | 'outbid';

/** Najwięcej subskrypcji kanałów aukcji z jednej listy (limit połączenia: 50). */
const LIVE_LIMIT = 40;

function BidRow({ entry, live }: { readonly entry: MyBidEntry; readonly live: boolean }) {
  const format = useFormatter();
  useLiveCard(entry.auction.id, live && entry.auction.status === 'ACTIVE', [MY_BIDS_KEY]);
  const { status, action } = bidRow(entry, (iso) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }),
  );
  return <AuctionRow auction={entry.auction} status={status} action={action} />;
}

/**
 * Licytacje użytkownika (F-21): trwające z filtrem prowadzę/przebito, wygrane albo przegrane.
 * `heading` dla sekcji pomocniczej (przegrane pod trwającymi); pustej sekcji wtedy nie ma.
 */
export function MyBids({
  status,
  heading,
}: {
  readonly status: Status;
  readonly heading?: string;
}) {
  const t = useTranslations('myBiddy');
  const [filter, setFilter] = useState<Filter>('all');
  const list = useInfiniteQuery({
    queryKey: [...getGetMyBidsQueryKey({ status }), 'pages'],
    queryFn: ({ pageParam, signal }) => getMyBids({ status, page: pageParam }, { signal }),
    initialPageParam: 1,
    getNextPageParam: (page: MyBidsDto) =>
      page.page < page.totalPages ? page.page + 1 : undefined,
  });

  if (list.isPending) {
    return heading === undefined ? (
      <div aria-busy="true" className="space-y-2">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-44 w-full rounded-lg" />
        <Skeleton className="h-44 w-full rounded-lg" />
      </div>
    ) : null;
  }
  if (list.isError) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-destructive-soft px-4 py-3 text-body-sm text-destructive"
      >
        {t('error')}
        <Button type="button" variant="outline" size="sm" onClick={() => void list.refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  }
  const items = list.data.pages.flatMap((page) => page.items);
  if (items.length === 0) {
    if (heading !== undefined) {
      return null;
    }
    return (
      <EmptyState
        icon={status === 'WON' ? Trophy : Gavel}
        title={t(status === 'WON' ? 'empty.wins' : 'empty.bidding')}
        action={
          <Button asChild>
            <Link href={routes.search}>{t('empty.browse')}</Link>
          </Button>
        }
      />
    );
  }
  const shown = items.filter(
    (entry) => filter === 'all' || (filter === 'leading' ? entry.leading : !entry.leading),
  );
  const content = (
    <>
      {status === 'ACTIVE' ? (
        <div role="group" aria-label={t('filters.label')} className="mb-4 flex flex-wrap gap-2">
          {(['all', 'leading', 'outbid'] as const).map((key) => (
            <Button
              key={key}
              type="button"
              size="sm"
              variant="outline"
              className={filterPillClasses(filter === key)}
              aria-pressed={filter === key}
              onClick={() => {
                setFilter(key);
              }}
            >
              {t(`filters.${key}`)}
            </Button>
          ))}
        </div>
      ) : null}
      <ul className="space-y-4">
        {shown.map((entry, index) => (
          <BidRow key={entry.auction.id} entry={entry} live={index < LIVE_LIMIT} />
        ))}
      </ul>
      {list.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          className="mt-4 w-full"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t('more')}
        </Button>
      ) : null}
    </>
  );
  return heading === undefined ? (
    <div>{content}</div>
  ) : (
    <section aria-labelledby={`my-bids-${status}`} className="space-y-4">
      <h2 id={`my-bids-${status}`} className="text-h3">
        {heading}
      </h2>
      {content}
    </section>
  );
}

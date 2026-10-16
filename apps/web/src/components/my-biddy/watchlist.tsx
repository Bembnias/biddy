'use client';

import { getGetMyWatchlistQueryKey, unwatchAuction, useGetMyWatchlist } from '@biddy/api-client';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { type WatchedAuction, watchRow } from '@/lib/my-biddy/next-action';
import { routes } from '@/lib/routes';

import { AuctionRow } from './auction-row';
import { useLiveCard } from './use-live-lists';

const LIVE_LIMIT = 40;

function WatchRow({
  auction,
  live,
  onUnwatch,
}: {
  readonly auction: WatchedAuction;
  readonly live: boolean;
  readonly onUnwatch: () => void;
}) {
  useLiveCard(auction.id, live && auction.status === 'ACTIVE', [getGetMyWatchlistQueryKey()]);
  const { status, action } = watchRow(auction);
  return <AuctionRow auction={auction} status={status} action={action} onUnwatch={onUnwatch} />;
}

/** Obserwowane aukcje (F-21): aktywne najpierw; zakończone da się przestać obserwować. */
export function Watchlist() {
  const t = useTranslations('myBiddy');
  const queryClient = useQueryClient();
  const list = useGetMyWatchlist();

  if (list.isPending) {
    return (
      <div aria-busy="true" className="space-y-2">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (list.isError) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
        {t('error')}
        <Button type="button" variant="outline" size="sm" onClick={() => void list.refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  }
  if (list.data.items.length === 0) {
    return (
      <div className="space-y-3 rounded-lg border border-dashed border-border p-8 text-center">
        <p>{t('empty.watchlist')}</p>
        <Link href={routes.search} className="text-primary underline underline-offset-4">
          {t('empty.browse')}
        </Link>
      </div>
    );
  }
  const unwatch = async (id: string) => {
    await unwatchAuction(id);
    await queryClient.invalidateQueries({ queryKey: getGetMyWatchlistQueryKey() });
  };
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {list.data.items.map((auction, index) => (
        <WatchRow
          key={auction.id}
          auction={auction}
          live={index < LIVE_LIMIT}
          onUnwatch={() => void unwatch(auction.id)}
        />
      ))}
    </ul>
  );
}

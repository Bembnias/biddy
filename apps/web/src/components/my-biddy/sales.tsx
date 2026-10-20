'use client';

import { useGetMyAuctions } from '@biddy/api-client';
import { auctionSlug } from '@biddy/shared';
import { PackageCheck } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { saleRow } from '@/lib/my-biddy/next-action';
import { routes } from '@/lib/routes';

import { AuctionRow } from './auction-row';

const SOLD = { status: ['ENDED_SOLD' as const] };

/** Sprzedane (F-21): stan zamówienia i następny krok sprzedającego. */
export function Sales() {
  const t = useTranslations('myBiddy');
  const format = useFormatter();
  const list = useGetMyAuctions(SOLD);

  if (list.isPending) {
    return (
      <div aria-busy="true" className="space-y-2">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-44 w-full rounded-lg" />
      </div>
    );
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
  if (list.data.length === 0) {
    return (
      <EmptyState
        icon={PackageCheck}
        title={t('empty.sales')}
        action={
          <Button asChild>
            <Link href={routes.sell}>{t('empty.sell')}</Link>
          </Button>
        }
      />
    );
  }
  const date = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <ul className="space-y-4">
      {list.data.map((auction) => {
        const { status, action } = saleRow(auction, date);
        return (
          <AuctionRow
            key={auction.id}
            auction={{
              ...auction,
              slug: auctionSlug(auction.title),
              price: auction.currentPrice ?? auction.startPrice ?? 0,
              coverThumbUrl: auction.coverUrl,
            }}
            status={status}
            action={action}
          />
        );
      })}
    </ul>
  );
}

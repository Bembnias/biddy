'use client';

import { useGetMyAuctions } from '@biddy/api-client';
import { auctionSlug } from '@biddy/shared';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
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
  if (list.data.length === 0) {
    return (
      <div className="space-y-3 rounded-lg border border-dashed border-border p-8 text-center">
        <p>{t('empty.sales')}</p>
        <Link href={routes.sell} className="text-primary underline underline-offset-4">
          {t('empty.sell')}
        </Link>
      </div>
    );
  }
  const date = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
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

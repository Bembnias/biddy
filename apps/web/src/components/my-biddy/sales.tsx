'use client';

import { useGetMyAuctions } from '@biddy/api-client';
import { auctionSlug } from '@biddy/shared';
import { PackageCheck } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { IconTile } from '@/components/ui/icon-tile';
import { Skeleton } from '@/components/ui/skeleton';
import { saleRow } from '@/lib/my-biddy/next-action';
import { auctionUrl, routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

import { STATUS_TEXT, STATUS_TILES, shortMoney } from './auction-row';
import { CompactRow } from './listing-card';

const SOLD = { status: ['ENDED_SOLD' as const] };

/** Kafelek stanu zamówienia: ton z `saleRow` (w drodze: informacyjny, zakończone: zielony). */
const ORDER_TILES = {
  info: 'info',
  positive: 'success',
  neutral: 'neutral',
  warning: 'warning',
  urgent: 'urgent',
} as const;

/** Sprzedane (F-21, zwarte wiersze F-63): stan zamówienia w tonie i następny krok sprzedającego. */
export function Sales() {
  const t = useTranslations('myBiddy');
  const format = useFormatter();
  const list = useGetMyAuctions(SOLD);

  if (list.isPending) {
    return (
      <div aria-busy="true" className="space-y-2">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-22 w-full rounded-xl" />
        <Skeleton className="h-22 w-full rounded-xl" />
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
    <ul className="space-y-3">
      {list.data.map((auction) => {
        const { status, action } = saleRow(auction, date);
        const title = auction.title ?? '';
        const { Icon } = STATUS_TILES[status.key];
        const values =
          status.key === 'orderStatus' && auction.order !== null
            ? {
                number: auction.order.publicId,
                status: t(`orderStatuses.${auction.order.status}`),
              }
            : (status.values ?? {});
        return (
          <CompactRow
            key={auction.id}
            className="rounded-xl border border-border bg-card"
            tile={
              <IconTile
                tone={
                  status.key === 'orderStatus'
                    ? ORDER_TILES[status.tone]
                    : STATUS_TILES[status.key].tone
                }
                className="max-sm:hidden"
              >
                <Icon />
              </IconTile>
            }
            imageUrl={auction.coverUrl}
            noPhotoLabel={t('row.noPhoto')}
            title={
              <Link
                href={auctionUrl({ slug: auctionSlug(title), publicId: auction.publicId })}
                className="rounded-xs underline-offset-3 outline-none hover:underline focus-visible:shadow-focus-ring"
              >
                {title}
              </Link>
            }
            line={
              <span className={cn('font-semibold', STATUS_TEXT[status.tone])}>
                {t(`status.${status.key}`, values)}
              </span>
            }
            price={shortMoney(auction.currentPrice ?? auction.startPrice ?? 0)}
            action={
              action.kind === 'link' ? (
                <Button asChild variant={action.primary ? 'default' : 'outline'}>
                  <Link href={action.href} aria-label={`${t(`actions.${action.label}`)}: ${title}`}>
                    {t(`actions.${action.label}`)}
                  </Link>
                </Button>
              ) : null
            }
          />
        );
      })}
    </ul>
  );
}

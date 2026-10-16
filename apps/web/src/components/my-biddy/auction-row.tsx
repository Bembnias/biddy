'use client';

import { formatMoney, money } from '@biddy/shared';
import { ImageOff } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useId } from 'react';

import { Button } from '@/components/ui/button';
import type { RowAction, RowStatus } from '@/lib/my-biddy/next-action';
import { auctionUrl } from '@/lib/routes';
import { cn } from '@/lib/utils';

export interface RowAuction {
  readonly id: string;
  readonly publicId: string;
  readonly slug: string;
  readonly title: string | null;
  readonly status: string;
  readonly price: number;
  readonly currentPrice: number | null;
  readonly bidCount: number;
  readonly endsAt: string | null;
  readonly coverThumbUrl: string | null;
}

const short = (amount: number) =>
  formatMoney(money(amount), { trailingZeroDisplay: 'stripIfInteger' });

/**
 * Pozycja listy Moje Biddy (F-21): zdjęcie, tytuł (link do aukcji), cena, liczba ofert, koniec,
 * stan i następna akcja. `onUnwatch` obsługuje akcję „Przestań obserwować”.
 */
export function AuctionRow({
  auction,
  status,
  action,
  onUnwatch,
}: {
  readonly auction: RowAuction;
  readonly status: RowStatus;
  readonly action: RowAction;
  readonly onUnwatch?: () => void;
}) {
  const t = useTranslations('myBiddy');
  const format = useFormatter();
  const hintId = useId();
  const ended = auction.status !== 'ACTIVE' && auction.status !== 'DRAFT';
  const href = auctionUrl({ slug: auction.slug, publicId: auction.publicId });
  const title = auction.title ?? '';

  let actionNode: ReactNode = null;
  switch (action.kind) {
    case 'link':
      actionNode = (
        <Button asChild size="sm" variant={action.primary ? 'default' : 'outline'}>
          <Link href={action.href} aria-label={`${t(`actions.${action.label}`)}: ${title}`}>
            {t(`actions.${action.label}`)}
          </Link>
        </Button>
      );
      break;
    case 'disabled':
      actionNode = (
        <div className="space-y-1">
          <Button type="button" size="sm" disabled aria-describedby={hintId}>
            {t(`actions.${action.label}`)}
          </Button>
          <p id={hintId} className="text-xs text-muted-foreground">
            {t(`actions.${action.hint}`)}
          </p>
        </div>
      );
      break;
    case 'unwatch':
      actionNode = (
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`${t('actions.unwatch')}: ${title}`}
          onClick={onUnwatch}
        >
          {t('actions.unwatch')}
        </Button>
      );
      break;
    case 'none':
      break;
  }

  return (
    <li className="flex flex-wrap items-start gap-3 p-3 sm:flex-nowrap">
      {auction.coverThumbUrl === null ? (
        <div className="flex size-16 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <ImageOff aria-hidden className="size-5" />
          <span className="sr-only">{t('row.noPhoto')}</span>
        </div>
      ) : (
        // Gotowy wariant WebP z CDN (F-12).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={auction.coverThumbUrl}
          alt=""
          loading="lazy"
          className="size-16 shrink-0 rounded-md bg-muted object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <Link href={href} className="font-medium break-words underline-offset-4 hover:underline">
          {title}
        </Link>
        <p className="text-sm text-muted-foreground">
          <span className="tabular-nums">
            {ended
              ? t('row.finalPrice', { price: short(auction.price) })
              : auction.currentPrice === null
                ? t('row.startPrice', { price: short(auction.price) })
                : t('row.price', { price: short(auction.price) })}
          </span>
          {' · '}
          {t('row.bids', { count: auction.bidCount })}
          {auction.endsAt === null || ended ? null : (
            <>
              {' · '}
              {t('row.endsAt', {
                date: format.dateTime(new Date(auction.endsAt), {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              })}
            </>
          )}
        </p>
        <p
          className={cn(
            'mt-1 text-sm font-medium',
            status.tone === 'positive' && 'text-success',
            status.tone === 'warning' && 'text-destructive',
          )}
        >
          {t(`status.${status.key}`, status.values ?? {})}
        </p>
      </div>
      <div className="w-full sm:w-auto sm:shrink-0">{actionNode}</div>
    </li>
  );
}

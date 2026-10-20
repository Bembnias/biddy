'use client';

import { formatMoney, money } from '@biddy/shared';
import {
  Ban,
  CircleCheck,
  CircleX,
  Clock,
  Heart,
  type LucideIcon,
  PackageCheck,
  Truck,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useId } from 'react';

import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/icon-tile';
import type { RowAction, RowStatus } from '@/lib/my-biddy/next-action';
import { auctionUrl } from '@/lib/routes';
import { cn } from '@/lib/utils';

import { ListingCard } from './listing-card';

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

type Tile = 'success' | 'danger' | 'warning' | 'info' | 'brand' | 'neutral';

/** Kafelek stanu (F-62): kolor i ikona mówią to samo co tekst obok. */
const STATUS_TILES: Record<RowStatus['key'], { readonly tone: Tile; readonly Icon: LucideIcon }> = {
  leading: { tone: 'success', Icon: CircleCheck },
  outbid: { tone: 'danger', Icon: TriangleAlert },
  won: { tone: 'warning', Icon: Wallet },
  wonPaid: { tone: 'success', Icon: PackageCheck },
  lost: { tone: 'neutral', Icon: CircleX },
  reserveNotMet: { tone: 'neutral', Icon: CircleX },
  cancelled: { tone: 'neutral', Icon: Ban },
  watchActive: { tone: 'brand', Icon: Heart },
  ended: { tone: 'neutral', Icon: Clock },
  awaitingPayment: { tone: 'warning', Icon: Clock },
  paid: { tone: 'success', Icon: Wallet },
  orderStatus: { tone: 'info', Icon: Truck },
};

const short = (amount: number) =>
  formatMoney(money(amount), { trailingZeroDisplay: 'stripIfInteger' });

/**
 * Pozycja listy Moje Biddy (F-21, wygląd F-62): stan z kafelkiem, zdjęcie, tytuł (link do aukcji),
 * cena, liczba ofert, koniec i następna akcja. `onUnwatch` obsługuje „Przestań obserwować”.
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
  const { tone, Icon } = STATUS_TILES[status.key];

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
        <>
          <p id={hintId} className="mr-auto text-caption text-muted-foreground">
            {t(`actions.${action.hint}`)}
          </p>
          <Button type="button" size="sm" disabled aria-describedby={hintId}>
            {t(`actions.${action.label}`)}
          </Button>
        </>
      );
      break;
    case 'unwatch':
      actionNode = (
        <Button
          type="button"
          size="sm"
          variant="ghost"
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
    <ListingCard
      status={
        <>
          <IconTile tone={tone} size="sm">
            <Icon />
          </IconTile>
          <p
            className={cn(
              'text-label',
              status.tone === 'positive' && 'text-success',
              status.tone === 'warning' && 'text-urgent',
            )}
          >
            {t(`status.${status.key}`, status.values ?? {})}
          </p>
        </>
      }
      aside={
        auction.endsAt === null || ended ? undefined : (
          <span className="inline-flex items-center gap-1.5">
            <Clock aria-hidden className="size-4" />
            {t('row.endsAt', {
              date: format.dateTime(new Date(auction.endsAt), {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              }),
            })}
          </span>
        )
      }
      imageUrl={auction.coverThumbUrl}
      noPhotoLabel={t('row.noPhoto')}
      title={
        <Link
          href={href}
          className="rounded-xs underline-offset-3 outline-none hover:underline focus-visible:shadow-focus-ring"
        >
          {title}
        </Link>
      }
      meta={t('row.bids', { count: auction.bidCount })}
      priceLabel={
        ended
          ? t('row.finalPrice')
          : auction.currentPrice === null
            ? t('row.startPrice')
            : t('row.price')
      }
      price={short(auction.price)}
      actions={actionNode}
    />
  );
}

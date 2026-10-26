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
import { type ComponentProps, type ReactNode, useId } from 'react';

import { RowTimer } from '@/components/search/card-signals';
import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/icon-tile';
import type { RowAction, RowStatus } from '@/lib/my-biddy/next-action';
import { auctionUrl } from '@/lib/routes';
import { cn } from '@/lib/utils';

import { type ListingPrice, ListingCard } from './listing-card';

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

type Tile = ComponentProps<typeof IconTile>['tone'];

/** Kafelek stanu (F-62): kolor i ikona mówią to samo co tekst obok. */
export const STATUS_TILES: Record<
  RowStatus['key'],
  { readonly tone: Tile; readonly Icon: LucideIcon }
> = {
  leading: { tone: 'success', Icon: CircleCheck },
  outbid: { tone: 'urgent', Icon: TriangleAlert },
  won: { tone: 'warning', Icon: Wallet },
  wonPaid: { tone: 'success', Icon: PackageCheck },
  lost: { tone: 'neutral', Icon: CircleX },
  reserveNotMet: { tone: 'neutral', Icon: CircleX },
  cancelled: { tone: 'neutral', Icon: Ban },
  watchActive: { tone: 'brand', Icon: Heart },
  ended: { tone: 'neutral', Icon: Clock },
  awaitingPayment: { tone: 'warning', Icon: Clock },
  paid: { tone: 'success', Icon: PackageCheck },
  orderStatus: { tone: 'info', Icon: Truck },
};

/** Kolor tekstu stanu: ≥ 4,5:1 na białym i na czerwonym tle karty „przebito Cię”. */
export const STATUS_TEXT: Record<RowStatus['tone'], string> = {
  positive: 'text-green-700',
  urgent: 'text-red-700',
  warning: 'text-amber-700',
  info: 'text-sky-700',
  neutral: 'text-ink-700',
};

export const shortMoney = (amount: number) =>
  formatMoney(money(amount), { trailingZeroDisplay: 'stripIfInteger' });

/**
 * Pozycja listy Moje Biddy (F-21, układ F-63): pasek stanu z kafelkiem i licznikiem, zdjęcie, tytuł
 * (link do aukcji), liczba ofert i koniec, cena (i maksimum przy licytacjach) oraz następna akcja.
 * `onUnwatch` obsługuje „Przestań obserwować”.
 */
export function AuctionRow({
  auction,
  status,
  action,
  maxAmount,
  onUnwatch,
}: {
  readonly auction: RowAuction;
  readonly status: RowStatus;
  readonly action: RowAction;
  /** Maksimum użytkownika (licytacje): druga kwota obok ceny. */
  readonly maxAmount?: number;
  readonly onUnwatch?: () => void;
}) {
  const t = useTranslations('myBiddy');
  const format = useFormatter();
  const hintId = useId();
  const ended = auction.status !== 'ACTIVE' && auction.status !== 'DRAFT';
  const href = auctionUrl({ slug: auction.slug, publicId: auction.publicId });
  const title = auction.title ?? '';
  const { tone, Icon } = STATUS_TILES[status.key];
  const endsAt = auction.endsAt === null || ended ? null : auction.endsAt;
  const endsAtLabel =
    endsAt === null
      ? ''
      : t('row.endsAt', {
          date: format.dateTime(new Date(endsAt), {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          }),
        });

  let actionNode: ReactNode = null;
  switch (action.kind) {
    case 'link':
      actionNode = (
        <Button asChild variant={action.primary ? 'default' : 'outline'}>
          <Link href={action.href} aria-label={`${t(`actions.${action.label}`)}: ${title}`}>
            {t(`actions.${action.label}`)}
          </Link>
        </Button>
      );
      break;
    case 'disabled':
      actionNode = (
        <>
          <p
            id={hintId}
            className="basis-full text-caption text-muted-foreground sm:mr-auto sm:basis-auto"
          >
            {t(`actions.${action.hint}`)}
          </p>
          <Button type="button" disabled aria-describedby={hintId}>
            {t(`actions.${action.label}`)}
          </Button>
        </>
      );
      break;
    case 'unwatch':
      actionNode = (
        <Button
          type="button"
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

  const prices: ListingPrice[] = [
    {
      label: ended
        ? t('row.finalPrice')
        : auction.currentPrice === null
          ? t('row.startPrice')
          : t('row.price'),
      value: shortMoney(auction.price),
    },
  ];
  if (maxAmount !== undefined && !ended) {
    prices.push({ label: t('row.yourMax'), value: shortMoney(maxAmount), muted: true });
  }

  return (
    <ListingCard
      tone={status.tone === 'urgent' ? 'urgent' : 'default'}
      status={
        <>
          <IconTile tone={tone} size="sm">
            <Icon />
          </IconTile>
          <p className={cn('text-label font-extrabold', STATUS_TEXT[status.tone])}>
            {t(`status.${status.key}`, status.values ?? {})}
          </p>
        </>
      }
      aside={endsAt === null ? undefined : <RowTimer endsAt={endsAt} endsAtLabel={endsAtLabel} />}
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
      meta={
        endsAt === null
          ? t('row.bids', { count: auction.bidCount })
          : `${t('row.bids', { count: auction.bidCount })} · ${endsAtLabel}`
      }
      prices={prices}
      actions={actionNode}
    />
  );
}

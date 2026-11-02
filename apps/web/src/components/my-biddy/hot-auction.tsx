'use client';

import { type AuctionSummaryDto, getGetMyAuctionsQueryKey } from '@biddy/api-client';
import { auctionSlug, isHotAuction, isLiveAuction } from '@biddy/shared';
import { Flame } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { LiveBadge } from '@/components/auction/live-badge';
import { useServerNow } from '@/components/auction/use-auction';
import { CardTimer } from '@/components/search/card-signals';
import { Button } from '@/components/ui/button';
import { auctionUrl } from '@/lib/routes';

import { shortMoney } from './auction-row';
import { ListingThumb } from './listing-card';
import { useLiveCard } from './use-live-lists';

/** Najgorętsza aktywna aukcja (`isHotAuction`): najwięcej ofert, przy remisie najbliższy koniec. */
export function hottestAuction(
  auctions: readonly AuctionSummaryDto[],
  now: number,
): AuctionSummaryDto | undefined {
  return auctions
    .filter((auction) => isHotAuction(auction, now))
    .sort(
      (a, b) => b.bidCount - a.bidCount || Date.parse(a.endsAt ?? '') - Date.parse(b.endsAt ?? ''),
    )[0];
}

/**
 * „Twoja aukcja jest gorąca” (F-63): ciemna karta nad listą Moich aukcji z ceną i licznikiem.
 * Cena i liczba ofert przychodzą na żywo z kanału aukcji (dane listy w cache zapytania). Liczy
 * się w przeglądarce (zegar serwera), więc HTML z serwera jej nie zawiera.
 */
export function HotAuction({ auctions }: { readonly auctions: readonly AuctionSummaryDto[] }) {
  const t = useTranslations('listing.mine.hot');
  const now = useServerNow();
  const hot = now === null ? undefined : hottestAuction(auctions, now);
  useLiveCard(hot?.id ?? '', hot !== undefined, [getGetMyAuctionsQueryKey()]);
  if (now === null || hot === undefined || hot.endsAt === null) {
    return null;
  }
  const title = hot.title ?? '';
  const price = hot.currentPrice ?? hot.startPrice ?? 0;
  const gain = hot.startPrice === null ? 0 : price - hot.startPrice;
  return (
    <section
      aria-labelledby="hot-auction-title"
      className="relative isolate flex flex-wrap items-center gap-x-7 gap-y-5 overflow-hidden rounded-2xl bg-primary p-5 text-primary-foreground sm:p-7"
    >
      <span
        aria-hidden
        className="absolute -top-25 -right-20 -z-10 size-80 rounded-full border-44 border-ink-900"
      />
      <ListingThumb
        imageUrl={hot.coverUrl}
        noPhotoLabel={t('noPhoto')}
        className="size-24 rounded-xl ring-0 sm:size-33"
      />
      <div className="min-w-0 flex-[1_1_16rem] space-y-2">
        <p className="flex flex-wrap items-center gap-2.5">
          {isLiveAuction(hot, now) ? <LiveBadge /> : null}
          <span className="inline-flex items-center gap-1.5 text-label text-pink-300">
            <Flame aria-hidden className="size-4" />
            {t('label')}
          </span>
        </p>
        <h2 id="hot-auction-title" className="text-h3 break-words">
          {title}
        </h2>
        <p className="text-body-sm font-semibold text-ink-200">
          {t('bids', { count: hot.bidCount })}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-overline text-ink-200 uppercase">{t('price')}</span>
        <p className="flex flex-wrap items-baseline gap-x-2.5">
          <span data-testid="hot-price" className="text-price-xl tabular-nums">
            {shortMoney(price)}
          </span>
          {gain > 0 ? (
            <span className="text-label font-extrabold text-green-300 tabular-nums">
              {t('gain', { amount: shortMoney(gain) })}
            </span>
          ) : null}
        </p>
      </div>
      <div className="flex flex-col items-stretch gap-2.5 max-sm:w-full">
        <CardTimer endsAt={hot.endsAt} className="h-10 justify-center" />
        <Button asChild variant="outline">
          <Link href={auctionUrl({ slug: auctionSlug(title), publicId: hot.publicId })}>
            {t('show')}
          </Link>
        </Button>
      </div>
    </section>
  );
}

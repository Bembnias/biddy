'use client';

import { getBidHistory, getGetBidHistoryQueryKey } from '@biddy/api-client';
import { LIVE_WINDOW_MS, isHotAuction, isLiveAuction, timerTone } from '@biddy/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Flame } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { avatarTone, initials } from '@/components/auction/bid-history';
import { LiveBadge } from '@/components/auction/live-badge';
import { PriceTicker } from '@/components/auction/price-ticker';
import { useServerNow } from '@/components/auction/use-auction';
import type { AuctionCardData } from '@/components/search/auction-card';
import { Button } from '@/components/ui/button';
import { clockParts, remainingParts, shortMoney } from '@/lib/auction/auction-state';
import { useAuctionChannel } from '@/lib/realtime/realtime-provider';
import { auctionUrl } from '@/lib/routes';
import { cn } from '@/lib/utils';

/** Ile ostatnich ofert pokazuje karta. */
const RECENT_BIDS = 3;

/**
 * Aukcja kończąca się najwcześniej w hero strony głównej (F-63): cena i licznik na żywo
 * (realtime F-17), trzy ostatnie oferty i „Gorąca aukcja”. Start z danych wyszukiwarki (ISR);
 * zdarzenie z mniejszą liczbą ofert niż pokazana jest starsze i go nie przyjmujemy.
 */
export function HomeShowcase({ initial }: { readonly initial: AuctionCardData }) {
  const t = useTranslations('home.showcase');
  const card = useTranslations('search.card');
  const format = useFormatter();
  const [auction, setAuction] = useState({ ...initial, ended: false });
  const now = useServerNow();

  useAuctionChannel(initial.id, {
    onUpdated: (event) => {
      setAuction((current) =>
        event.bidCount < current.bidCount
          ? current
          : {
              ...current,
              price: event.currentPrice ?? current.price,
              currentPrice: event.currentPrice,
              bidCount: event.bidCount,
              endsAt: event.endsAt ?? current.endsAt,
              ended: current.ended || event.status !== 'ACTIVE',
            },
      );
    },
    onExtended: (event) => {
      setAuction((current) => ({ ...current, endsAt: event.endsAt }));
    },
    onEnded: () => {
      setAuction((current) => ({ ...current, ended: true }));
    },
  });

  const history = useQuery({
    queryKey: [...getGetBidHistoryQueryKey(initial.id), 'showcase', auction.bidCount],
    queryFn: ({ signal }) => getBidHistory(initial.id, undefined, { signal }),
    enabled: auction.bidCount > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const bids = history.data?.items.slice(0, RECENT_BIDS) ?? [];
  const latest = bids[0];

  const signals = { status: auction.ended ? 'ENDED' : 'ACTIVE', ...auction };
  const live = now !== null && isLiveAuction(signals, now);
  const hot = now !== null && isHotAuction(signals, now);
  const when = (iso: string) => {
    const age = now === null ? null : now - Date.parse(iso);
    if (age !== null && age < 60_000) {
      return t('now');
    }
    if (age !== null && age < LIVE_WINDOW_MS) {
      return t('minutesAgo', { minutes: Math.floor(age / 60_000) });
    }
    return format.dateTime(new Date(iso), { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="relative rounded-2xl bg-violet-100 p-6 md:p-8">
      {latest === undefined ? null : (
        <p className="absolute -top-3.5 right-7 z-10 flex items-center gap-2.5 rounded-full bg-card py-2 pr-3.5 pl-2 shadow-lg">
          <Initials name={latest.bidder} />
          <span className="text-body-sm font-semibold text-foreground">
            {t.rich('raises', {
              name: latest.bidder,
              price: shortMoney(latest.amount),
              strong: (chunks) => <strong className="font-extrabold tabular-nums">{chunks}</strong>,
            })}
          </span>
          <span className="text-caption font-semibold text-muted-foreground">
            {when(latest.createdAt)}
          </span>
        </p>
      )}

      <article
        aria-label={t('label', { title: auction.title })}
        className="overflow-hidden rounded-2xl bg-card shadow-lg"
      >
        <div className="relative h-72 bg-muted">
          {auction.coverUrl === null ? null : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={auction.coverUrl}
              alt=""
              loading="eager"
              decoding="async"
              className="size-full object-cover"
            />
          )}
          {live ? <LiveBadge className="absolute top-3.5 left-3.5" /> : null}
        </div>
        <div className="space-y-4 p-5">
          <div>
            <p className="text-title">{auction.title}</p>
            <p className="text-body-sm text-muted-foreground">
              {auction.condition === null ? null : `${card(`conditions.${auction.condition}`)} · `}
              {t('bids', { count: auction.bidCount })}
            </p>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-overline text-muted-foreground uppercase">
                {auction.currentPrice === null ? t('startPrice') : t('currentOffer')}
              </span>
              <PriceTicker amount={auction.price} currency="PLN" />
            </div>
            <ShowcaseTimer endsAt={auction.endsAt} ended={auction.ended} now={now} />
          </div>
          {bids.length === 0 ? null : (
            <ol aria-label={t('recentBids')} className="space-y-0.5">
              {bids.map((bid, index) => (
                <li
                  key={bid.id}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-2',
                    index === 0 && 'bg-violet-50',
                  )}
                >
                  <Initials name={bid.bidder} />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-label',
                      index === 0 ? 'text-foreground' : 'text-foreground-secondary',
                    )}
                  >
                    {bid.bidder}
                  </span>
                  <span
                    className={cn(
                      'text-label tabular-nums',
                      index === 0 ? 'font-extrabold' : 'text-foreground-secondary',
                    )}
                  >
                    {shortMoney(bid.amount)}
                  </span>
                  <span
                    className={cn(
                      'w-16 text-right text-caption',
                      index === 0 ? 'font-bold text-violet-700' : 'text-muted-foreground',
                    )}
                  >
                    {when(bid.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <Button asChild size="lg" className="w-full">
            <Link href={auctionUrl(auction)}>{auction.ended ? t('result') : t('join')}</Link>
          </Button>
        </div>
      </article>

      {hot ? (
        <p className="absolute bottom-24 -left-4.5 hidden items-center gap-2 rounded-xl bg-primary px-3.5 py-2.5 text-primary-foreground shadow-lg md:flex">
          <Flame aria-hidden className="size-5 text-pink-300" />
          <span className="flex flex-col text-body-sm font-bold">
            {t('hot')}
            <span className="font-medium text-ink-300">
              {t('bids', { count: auction.bidCount })}
            </span>
          </span>
        </p>
      ) : null}
    </div>
  );
}

function Initials({ name }: { readonly name: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-full text-badge',
        avatarTone(name),
      )}
    >
      {initials(name)}
    </span>
  );
}

/** Licznik w tonie: kafelki min i sek w ostatniej godzinie, gg:mm:ss poniżej doby, dalej dni. */
function ShowcaseTimer({
  endsAt,
  ended,
  now,
}: {
  readonly endsAt: string;
  readonly ended: boolean;
  readonly now: number | null;
}) {
  const t = useTranslations('auction.panel');
  const home = useTranslations('home.showcase');
  if (ended) {
    return <span className="text-label text-foreground-secondary">{home('ended')}</span>;
  }
  if (now === null) {
    return null;
  }
  const left = Math.max(0, Date.parse(endsAt) - now);
  const parts = remainingParts(left);
  if (parts.kind === 'days') {
    return (
      <span role="timer" className="text-h3 font-extrabold text-foreground tabular-nums">
        {t('countdownDays', parts)}
      </span>
    );
  }
  const clock = clockParts(left);
  const label = t('countdownLabel', {
    hours: clock.hours,
    minutes: clock.minutes,
    seconds: clock.seconds,
  });
  if (timerTone(left) !== 'urgent') {
    return (
      <span
        role="timer"
        aria-label={label}
        className="text-h3 font-extrabold text-violet-700 tabular-nums"
      >
        {clock.hh}:{clock.mm}:{clock.ss}
      </span>
    );
  }
  const segments = [
    [clock.mm, t('unitMinutes')],
    [clock.ss, t('unitSeconds')],
  ] as const;
  return (
    <span role="timer" aria-label={label} className="flex items-center gap-1.5 text-urgent">
      {segments.map(([value, unit], index) => (
        <span key={unit} className="flex items-center gap-1.5">
          {index === 0 ? null : (
            <span aria-hidden className="text-h3 font-extrabold">
              :
            </span>
          )}
          <span className="flex min-w-13 flex-col items-center rounded-lg bg-urgent-soft px-2 py-1.5">
            <span className="text-h2 font-extrabold tabular-nums">{value}</span>
            <span aria-hidden className="text-badge text-red-700">
              {unit}
            </span>
          </span>
        </span>
      ))}
    </span>
  );
}

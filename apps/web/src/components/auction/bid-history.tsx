'use client';

import {
  type BidHistoryDto,
  type PublicAuctionDto,
  getBidHistory,
  getGetBidHistoryQueryKey,
} from '@biddy/api-client';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { shortMoney } from '@/lib/auction/auction-state';
import { cn } from '@/lib/utils';

import { LiveDot } from './live-badge';
import { PriceSparkline } from './price-sparkline';
import { useAuction, useServerNow } from './use-auction';

/** Kolory kółek z inicjałami (ozdoba): stały kolor dla tej samej nazwy. */
const AVATAR_TONES = [
  'bg-pink-100 text-pink-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-amber-100 text-amber-800',
  'bg-green-100 text-green-800',
] as const;

function avatarTone(name: string): string {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 997;
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length] ?? AVATAR_TONES[0];
}

/** Inicjały z zanonimizowanej nazwy („k***a” → „KA”). */
function initials(name: string): string {
  const letters = [...name].filter((char) => /\p{L}|\p{N}/u.test(char));
  return `${letters[0] ?? ''}${letters.length > 1 ? (letters.at(-1) ?? '') : ''}`.toUpperCase();
}

/**
 * Historia ofert (F-15, F-18, „Puls licytacji” F-63): licytujący zanonimizowani, 50 najnowszych
 * i „Pokaż starsze”, wykres ceny, czas względny i wyróżnienie ofert, które przyszły na żywo.
 * Pobierana w przeglądarce; liczba ofert w kluczu zapytania odświeża ją po nowej ofercie.
 */
export function BidHistory({ initial }: { readonly initial: PublicAuctionDto }) {
  const t = useTranslations('auction.history');
  const format = useFormatter();
  const auction = useAuction(initial);
  const now = useServerNow();
  const history = useInfiniteQuery({
    queryKey: [...getGetBidHistoryQueryKey(auction.id), 'pages', auction.bidCount],
    queryFn: ({ pageParam, signal }) =>
      getBidHistory(auction.id, pageParam === undefined ? undefined : { before: pageParam }, {
        signal,
      }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (page: BidHistoryDto) => page.nextBefore ?? undefined,
    placeholderData: keepPreviousData,
  });

  const items = history.data?.pages.flatMap((page) => page.items) ?? [];
  // Oferty z pierwszego wczytania; późniejsze przyszły na żywo i dostają wyróżnienie.
  const [seen, setSeen] = useState<ReadonlySet<string> | null>(null);
  if (seen === null && history.isSuccess && !history.isPlaceholderData) {
    setSeen(new Set(items.map((bid) => bid.id)));
  }

  const firstPageSize = history.data?.pages[0]?.items.length ?? 0;
  const chronological = [...(history.data?.pages[0]?.items ?? [])]
    .map((bid) => bid.amount)
    .reverse();
  // Cała historia na pierwszej stronie: wykres zaczyna się od ceny wywoławczej.
  const amounts =
    history.data?.pages[0]?.nextBefore === null
      ? [auction.startPrice, ...chronological]
      : chronological;

  const when = (iso: string) => {
    const age = now === null ? null : now - Date.parse(iso);
    if (age !== null && age < 60_000) {
      return t('now');
    }
    if (age !== null && age < 3_600_000) {
      return t('minutesAgo', { minutes: Math.floor(age / 60_000) });
    }
    return format.dateTime(new Date(iso), { dateStyle: 'short', timeStyle: 'short' });
  };

  return (
    <section aria-labelledby="bid-history-title" className="scroll-mt-24 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="bid-history-title" className="text-h3">
          {t('title')}
        </h2>
        {auction.status === 'ACTIVE' ? (
          <span className="flex items-center gap-2 text-caption font-bold text-red-700">
            <LiveDot className="text-live-dot" />
            {t('live')}
          </span>
        ) : null}
      </div>
      {history.isPending ? (
        <div className="space-y-2" aria-busy="true">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : history.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg bg-destructive-soft px-4 py-3 text-body-sm text-destructive"
        >
          {t('error')}
          <Button type="button" variant="outline" size="sm" onClick={() => void history.refetch()}>
            {t('retry')}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg bg-muted px-4 py-3 text-body-sm text-foreground-secondary">
          {t('empty')}
        </p>
      ) : (
        <>
          {amounts.length < 2 ? null : (
            <figure className="space-y-1">
              <PriceSparkline
                amounts={amounts}
                label={t('sparkline', {
                  from: shortMoney(amounts[0] ?? auction.startPrice),
                  to: shortMoney(amounts.at(-1) ?? auction.startPrice),
                  count: auction.bidCount,
                })}
              />
              <figcaption className="flex justify-between text-caption text-muted-foreground">
                <span>{t('start', { price: shortMoney(auction.startPrice) })}</span>
                <span>{t('count', { count: auction.bidCount })}</span>
              </figcaption>
            </figure>
          )}
          <ol className="divide-y divide-muted">
            {items.map((bid, index) => {
              // Tylko pierwsza strona: starsze strony („Pokaż starsze”) nie są nowymi ofertami.
              const live = seen !== null && !seen.has(bid.id) && index < firstPageSize;
              return (
                <li
                  key={bid.id}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5',
                    live && 'animate-enter',
                    index === 0 && auction.status === 'ACTIVE' && 'bg-accent',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'grid size-8 shrink-0 place-items-center rounded-full text-badge font-extrabold',
                      avatarTone(bid.bidder),
                    )}
                  >
                    {initials(bid.bidder)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-label">{bid.bidder}</span>
                    {bid.kind === 'MANUAL' ? null : (
                      <span className="text-caption text-muted-foreground">
                        {t('kind', { kind: bid.kind })}
                      </span>
                    )}
                  </span>
                  <span className="text-price whitespace-nowrap tabular-nums">
                    {shortMoney(bid.amount, history.data?.pages[0]?.currency ?? 'PLN')}
                  </span>
                  <time
                    dateTime={bid.createdAt}
                    className={cn(
                      'w-24 shrink-0 text-right text-caption whitespace-nowrap',
                      index === 0 && auction.status === 'ACTIVE'
                        ? 'font-bold text-accent-foreground'
                        : 'text-muted-foreground',
                    )}
                  >
                    {when(bid.createdAt)}
                  </time>
                </li>
              );
            })}
          </ol>
          {history.hasNextPage ? (
            <Button
              type="button"
              variant="link"
              disabled={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              {t('more')}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}

'use client';

import {
  type MyBidsDto,
  type MyBidsDtoSummary,
  getGetMyBidsQueryKey,
  getMyBids,
} from '@biddy/api-client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Gavel, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { IconTile } from '@/components/ui/icon-tile';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { type MyBidEntry, bidRow } from '@/lib/my-biddy/next-action';
import { auctionUrl, routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

import { AuctionRow, STATUS_TILES, shortMoney } from './auction-row';
import { CompactRow } from './listing-card';
import { MY_BIDS_KEY, useLiveCard } from './use-live-lists';

type Status = 'ACTIVE' | 'WON' | 'LOST';
type Filter = 'all' | 'leading' | 'outbid';

/** Najwięcej subskrypcji kanałów aukcji z jednej listy (limit połączenia: 50). */
const LIVE_LIMIT = 40;

function BidRow({ entry, live }: { readonly entry: MyBidEntry; readonly live: boolean }) {
  const format = useFormatter();
  useLiveCard(entry.auction.id, live && entry.auction.status === 'ACTIVE', [MY_BIDS_KEY]);
  const { status, action } = bidRow(entry, (iso) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }),
  );
  return (
    <AuctionRow
      auction={entry.auction}
      status={status}
      action={action}
      maxAmount={entry.maxAmount}
    />
  );
}

/** Przegrana licytacja (F-63): zwarty wiersz z ceną końcową, maksimum i „Szukaj podobnych”. */
function LostRow({ entry }: { readonly entry: MyBidEntry }) {
  const t = useTranslations('myBiddy');
  const { status, action } = bidRow(entry, () => '');
  const title = entry.auction.title;
  const { tone, Icon } = STATUS_TILES[status.key];
  const reason =
    status.key === 'lost'
      ? t('row.finalPriceLine', { price: shortMoney(entry.auction.price) })
      : t(`status.${status.key}`);
  return (
    <CompactRow
      tile={
        <IconTile tone={tone} size="sm" className="max-sm:hidden">
          <Icon />
        </IconTile>
      }
      imageUrl={entry.auction.coverThumbUrl}
      noPhotoLabel={t('row.noPhoto')}
      dimmed
      title={
        <Link
          href={auctionUrl(entry.auction)}
          className="rounded-xs underline-offset-3 outline-none hover:underline focus-visible:shadow-focus-ring"
        >
          {title}
        </Link>
      }
      line={
        <span className="text-muted-foreground tabular-nums">
          {reason} · {t('row.yourMaxLine', { max: shortMoney(entry.maxAmount) })}
        </span>
      }
      action={
        action.kind === 'link' ? (
          <Button asChild variant="outline" size="sm">
            <Link href={action.href} aria-label={`${t(`actions.${action.label}`)}: ${title}`}>
              {t(`actions.${action.label}`)}
            </Link>
          </Button>
        ) : null
      }
    />
  );
}

/**
 * Kafelki podsumowania trwających licytacji (F-63). Liczby z API (`summary`), więc obejmują
 * wszystkie strony listy, a nie tylko wczytane pozycje.
 */
function BiddingSummary({
  total,
  summary,
}: {
  readonly total: number;
  readonly summary: NonNullable<MyBidsDtoSummary>;
}) {
  const t = useTranslations('myBiddy.summary');
  const outbid = summary.outbid > 0;
  const tiles = [
    { key: 'bidding', value: total, tone: 'neutral' },
    { key: 'leading', value: summary.leading, tone: 'positive' },
    { key: 'outbid', value: summary.outbid, tone: outbid ? 'urgent' : 'neutral' },
    { key: 'endingSoon', value: summary.endingSoon, tone: 'soon' },
  ] as const;
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      {tiles.map(({ key, value, tone }) => (
        <div
          key={key}
          data-tone={tone}
          className={cn(
            'flex flex-col gap-1 rounded-lg border px-4 py-3.5 sm:px-5 sm:py-4',
            tone === 'urgent' ? 'border-red-200 bg-red-50' : 'border-border bg-card',
          )}
        >
          <dt
            className={cn(
              'text-overline uppercase',
              tone === 'positive' && 'text-green-700',
              tone === 'urgent' && 'text-red-700',
              tone === 'soon' && 'text-violet-700',
              tone === 'neutral' && 'text-muted-foreground',
            )}
          >
            {t(`${key}.label`)}
          </dt>
          <dd
            className={cn(
              'text-h1 tabular-nums',
              tone === 'positive' && 'text-green-700',
              tone === 'urgent' && 'text-red-600',
              tone === 'soon' && 'text-violet-700',
            )}
          >
            {value}
          </dd>
          <dd
            className={cn(
              'text-caption font-semibold',
              tone === 'urgent' ? 'text-red-700' : 'text-foreground-secondary',
            )}
          >
            {key === 'outbid' && !outbid ? t('outbid.none') : t(`${key}.hint`)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Licytacje użytkownika (F-21, układ F-63): trwające z podsumowaniem i filtrem prowadzę/przebito,
 * wygrane albo przegrane. `heading` dla sekcji pomocniczej (przegrane pod trwającymi, zwarte
 * wiersze); pustej sekcji wtedy nie ma.
 */
export function MyBids({
  status,
  heading,
}: {
  readonly status: Status;
  readonly heading?: string;
}) {
  const t = useTranslations('myBiddy');
  const [filter, setFilter] = useState<Filter>('all');
  const list = useInfiniteQuery({
    queryKey: [...getGetMyBidsQueryKey({ status }), 'pages'],
    queryFn: ({ pageParam, signal }) => getMyBids({ status, page: pageParam }, { signal }),
    initialPageParam: 1,
    getNextPageParam: (page: MyBidsDto) =>
      page.page < page.totalPages ? page.page + 1 : undefined,
  });

  if (list.isPending) {
    return heading === undefined ? (
      <div aria-busy="true" className="space-y-4">
        <span className="sr-only">{t('loading')}</span>
        {status === 'ACTIVE' ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-28 rounded-lg" />
            ))}
          </div>
        ) : null}
        <Skeleton className="h-52 w-full rounded-xl" />
        <Skeleton className="h-52 w-full rounded-xl" />
      </div>
    ) : null;
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
  const items = list.data.pages.flatMap((page) => page.items);
  if (items.length === 0) {
    if (heading !== undefined) {
      return null;
    }
    return (
      <EmptyState
        icon={status === 'WON' ? Trophy : Gavel}
        title={t(status === 'WON' ? 'empty.wins' : 'empty.bidding')}
        action={
          <Button asChild>
            <Link href={routes.search}>{t('empty.browse')}</Link>
          </Button>
        }
      />
    );
  }
  const more = list.hasNextPage ? (
    <Button
      type="button"
      variant="outline"
      className="mt-4 w-full"
      disabled={list.isFetchingNextPage}
      onClick={() => void list.fetchNextPage()}
    >
      {t('more')}
    </Button>
  ) : null;

  if (heading !== undefined) {
    return (
      <section aria-labelledby={`my-bids-${status}`} className="space-y-3">
        <h2 id={`my-bids-${status}`} className="text-h3 text-ink-700">
          {heading}
        </h2>
        <ul className="divide-y divide-ink-100 rounded-xl border border-border bg-card">
          {items.map((entry) => (
            <LostRow key={entry.auction.id} entry={entry} />
          ))}
        </ul>
        {more}
      </section>
    );
  }

  const first = list.data.pages[0];
  const summary = first?.summary ?? null;
  const shown = items.filter(
    (entry) => filter === 'all' || (filter === 'leading' ? entry.leading : !entry.leading),
  );
  return (
    <div className="space-y-6">
      {first === undefined || summary === null ? null : (
        <BiddingSummary total={first.total} summary={summary} />
      )}
      {status === 'ACTIVE' ? (
        <SegmentedControl
          label={t('filters.label')}
          className="sm:w-fit"
          value={filter}
          onValueChange={setFilter}
          options={(['all', 'leading', 'outbid'] as const).map((key) => ({
            value: key,
            label: t(`filters.${key}`),
          }))}
        />
      ) : null}
      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong px-5 py-8 text-center text-body-sm text-muted-foreground">
          {t(`filters.empty.${filter === 'leading' ? 'leading' : 'outbid'}`)}
        </p>
      ) : (
        <ul className="space-y-4">
          {shown.map((entry, index) => (
            <BidRow key={entry.auction.id} entry={entry} live={index < LIVE_LIMIT} />
          ))}
        </ul>
      )}
      {more}
    </div>
  );
}

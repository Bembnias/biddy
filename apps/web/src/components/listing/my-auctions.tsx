'use client';

// Moje aukcje (F-14, /moje-biddy/aukcje od F-21, układ F-63): gorąca aukcja nad listą, filtr
// statusu z liczbą pozycji, edycja szkicu albo aukcji bez ofert, anulowanie z ostrzeżeniem
// o strike'u, ponowne wystawienie i usuwanie szkiców.
import {
  type AuctionSummaryDto,
  cancelAuction,
  deleteAuctionDraft,
  getGetMyAuctionsQueryKey,
  relistAuction,
  useGetMyAuctions,
} from '@biddy/api-client';
import { auctionSlug, formatMoney, money } from '@biddy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, CircleCheck, CircleX, Gavel, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { Fragment, useState } from 'react';

import { track } from '@/analytics/posthog';
import { HotAuction } from '@/components/my-biddy/hot-auction';
import { ListingCard, filterPillClasses } from '@/components/my-biddy/listing-card';
import { CardTimeBadge, RowTimer } from '@/components/search/card-signals';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { IconTile } from '@/components/ui/icon-tile';
import { auctionUrl, listingWizardUrl } from '@/lib/routes';
import { cn } from '@/lib/utils';

const FILTERS = ['all', 'DRAFT', 'ACTIVE', 'PENDING_REVIEW', 'ENDED', 'CANCELLED'] as const;
type Filter = (typeof FILTERS)[number];

function matches(filter: Filter, auction: AuctionSummaryDto): boolean {
  if (filter === 'all') {
    return true;
  }
  if (filter === 'ENDED') {
    return auction.status === 'ENDED_SOLD' || auction.status === 'ENDED_UNSOLD';
  }
  return auction.status === filter;
}

const zl = (amount: number) =>
  formatMoney(money(amount), { trailingZeroDisplay: 'stripIfInteger' });

/** Plakietka statusu aukcji (F-62): ton mówi, czy coś trzeba zrobić. */
const STATUS_BADGES: Record<
  'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE',
  Pick<React.ComponentProps<typeof Badge>, 'tone' | 'variant'>
> = {
  DRAFT: { tone: 'neutral', variant: 'soft' },
  PENDING_REVIEW: { tone: 'warning', variant: 'soft' },
  ACTIVE: { tone: 'success', variant: 'soft' },
};

/** Zakończone i anulowane: kafelek z ikoną i tekst w tonie (F-63). */
const ENDED_TILES = {
  ENDED_SOLD: { tone: 'success', Icon: CircleCheck, text: 'text-green-700' },
  ENDED_UNSOLD: { tone: 'danger', Icon: CircleX, text: 'text-red-700' },
  CANCELLED: { tone: 'neutral', Icon: Ban, text: 'text-ink-700' },
} as const;

/** Publiczna strona aukcji istnieje od publikacji (bez szkiców i aukcji w moderacji). */
const PUBLIC: ReadonlySet<AuctionSummaryDto['status']> = new Set([
  'ACTIVE',
  'ENDED_SOLD',
  'ENDED_UNSOLD',
  'CANCELLED',
]);

/** Pasek stanu karty (F-63): trwa licytacja (LIVE), aktywna bez ofert, szkic, moderacja, koniec. */
function StatusLine({
  auction,
  date,
}: {
  readonly auction: AuctionSummaryDto;
  readonly date: (iso: string) => string;
}) {
  const t = useTranslations('listing.mine');
  switch (auction.status) {
    case 'ACTIVE':
      return auction.bidCount > 0 ? (
        <>
          <IconTile tone="brand" size="sm">
            <Gavel />
          </IconTile>
          <p className="text-label font-extrabold">{t('state.bidding')}</p>
          {auction.endsAt === null ? null : (
            <CardTimeBadge endsAt={auction.endsAt} endsAtLabel="" liveOnly />
          )}
        </>
      ) : (
        <>
          <Badge {...STATUS_BADGES.ACTIVE}>{t('statuses.ACTIVE')}</Badge>
          <p className="text-label text-foreground-secondary">
            {auction.editable ? t('state.noBidsEditable') : t('state.noBids')}
          </p>
        </>
      );
    case 'DRAFT':
      return (
        <>
          <Badge {...STATUS_BADGES.DRAFT}>{t('statuses.DRAFT')}</Badge>
          <p className="text-label text-foreground-secondary">
            {t('state.updated', { date: date(auction.updatedAt) })}
          </p>
        </>
      );
    case 'PENDING_REVIEW':
      return <Badge {...STATUS_BADGES.PENDING_REVIEW}>{t('statuses.PENDING_REVIEW')}</Badge>;
    case 'ENDED_SOLD':
    case 'ENDED_UNSOLD':
    case 'CANCELLED': {
      const { tone, Icon, text } = ENDED_TILES[auction.status];
      return (
        <>
          <IconTile tone={tone} size="sm">
            <Icon />
          </IconTile>
          <p className={cn('text-label font-extrabold', text)}>{t(`statuses.${auction.status}`)}</p>
        </>
      );
    }
  }
}

/** Linia pod tytułem: części oddzielone kropką, każda w osobnym elemencie. */
function MetaLine({ parts }: { readonly parts: readonly (string | null)[] }) {
  return parts
    .filter((part) => part !== null)
    .map((part, index) => (
      <Fragment key={part}>
        {index > 0 ? ' · ' : null}
        <span>{part}</span>
      </Fragment>
    ));
}

export function MyAuctions({
  initial,
  publishedId,
}: {
  readonly initial: readonly AuctionSummaryDto[];
  /** Właśnie opublikowana aukcja (`?opublikowano=`): komunikat nad listą. */
  readonly publishedId: string | undefined;
}) {
  const t = useTranslations('listing.mine');
  const format = useFormatter();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data } = useGetMyAuctions(undefined, { query: { initialData: [...initial] } });
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string>();
  const auctions = data;

  const refresh = () => queryClient.invalidateQueries({ queryKey: getGetMyAuctionsQueryKey() });
  const run = async (action: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await action();
    } catch {
      setError(t('actionError'));
    } finally {
      await refresh();
    }
  };

  const published =
    publishedId === undefined ? undefined : auctions.find((auction) => auction.id === publishedId);
  const dateTime = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  const shortDate = (iso: string) =>
    format.dateTime(new Date(iso), {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  const visible = auctions.filter((auction) => matches(filter, auction));

  return (
    <div className="space-y-6">
      {published === undefined ? null : (
        <p
          role="status"
          className="flex items-start gap-3 rounded-lg bg-success-soft px-4 py-3 text-body-sm text-foreground"
        >
          <CircleCheck aria-hidden className="mt-0.5 size-4.5 shrink-0 text-success" />
          {published.status === 'ACTIVE' && published.endsAt !== null
            ? t('published', { title: published.title ?? '', date: dateTime(published.endsAt) })
            : t('submitted', { title: published.title ?? '' })}
        </p>
      )}
      <HotAuction auctions={auctions} />
      <div role="group" aria-label={t('filter')} className="flex flex-wrap gap-2">
        {FILTERS.map((option) => {
          const count = auctions.filter((auction) => matches(option, auction)).length;
          return (
            <Button
              key={option}
              type="button"
              size="sm"
              variant="outline"
              className={filterPillClasses(filter === option)}
              aria-pressed={filter === option}
              onClick={() => {
                setFilter(option);
              }}
            >
              {t(`filters.${option}`)} <span className="tabular-nums opacity-70">{count}</span>
            </Button>
          );
        })}
      </div>
      {error === undefined ? null : (
        <p
          role="alert"
          className="rounded-lg bg-destructive-soft px-4 py-3 text-body-sm text-destructive"
        >
          {error}
        </p>
      )}
      {visible.length === 0 ? (
        <EmptyState icon={Gavel} title={t('empty')} />
      ) : (
        <ul className="space-y-4">
          {visible.map((auction) => {
            const title = auction.title ?? t('untitled');
            const cancellable = auction.status === 'ACTIVE' || auction.status === 'PENDING_REVIEW';
            const ended =
              auction.status === 'ENDED_SOLD' ||
              auction.status === 'ENDED_UNSOLD' ||
              auction.status === 'CANCELLED';
            const price = auction.currentPrice ?? auction.startPrice;
            const endsAt = auction.status === 'ACTIVE' ? auction.endsAt : null;
            const href = PUBLIC.has(auction.status)
              ? auctionUrl({ slug: auctionSlug(title), publicId: auction.publicId })
              : undefined;
            return (
              <ListingCard
                key={auction.id}
                status={<StatusLine auction={auction} date={dateTime} />}
                aside={
                  endsAt === null ? undefined : (
                    <RowTimer
                      endsAt={endsAt}
                      endsAtLabel={t('endsAt', { date: shortDate(endsAt) })}
                    />
                  )
                }
                imageUrl={auction.coverUrl}
                noPhotoLabel={t('noPhoto')}
                title={
                  href === undefined ? (
                    title
                  ) : (
                    <Link
                      href={href}
                      className="rounded-xs underline-offset-3 outline-none hover:underline focus-visible:shadow-focus-ring"
                    >
                      {title}
                    </Link>
                  )
                }
                meta={
                  auction.status === 'DRAFT' ? undefined : (
                    <MetaLine
                      parts={[
                        t('bids', { count: auction.bidCount }),
                        ended && auction.endsAt !== null
                          ? t('endedAt', { date: shortDate(auction.endsAt) })
                          : null,
                      ]}
                    />
                  )
                }
                prices={
                  price === null
                    ? []
                    : [
                        {
                          label: ended
                            ? t('finalPrice')
                            : auction.currentPrice === null
                              ? t('startPrice')
                              : t('currentPrice'),
                          value: zl(price),
                        },
                      ]
                }
                actions={
                  auction.editable || cancellable || ended || auction.status === 'DRAFT' ? (
                    <>
                      {cancellable ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button type="button" variant="destructive-outline">
                              {t('cancel')}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t('cancelTitle')}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t('cancelText', { title })}
                              </AlertDialogDescription>
                              {auction.bidCount > 0 ? (
                                <p className="text-body-sm font-semibold text-destructive">
                                  {t('cancelWithBids')}
                                </p>
                              ) : null}
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t('keep')}</AlertDialogCancel>
                              <AlertDialogAction
                                className={buttonVariants({ variant: 'destructive' })}
                                onClick={() =>
                                  void run(async () => {
                                    await cancelAuction(auction.id);
                                    track('auction_cancelled', { withBids: auction.bidCount > 0 });
                                  })
                                }
                              >
                                {t('cancelConfirm')}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : null}
                      {auction.status === 'DRAFT' ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button type="button" variant="destructive-outline">
                              {t('delete')}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t('deleteText', { title })}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t('keep')}</AlertDialogCancel>
                              <AlertDialogAction
                                className={buttonVariants({ variant: 'destructive' })}
                                onClick={() => void run(() => deleteAuctionDraft(auction.id))}
                              >
                                {t('deleteConfirm')}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : null}
                      {auction.editable ? (
                        <Button
                          asChild
                          variant={auction.status === 'DRAFT' ? 'default' : 'outline'}
                        >
                          <Link
                            href={listingWizardUrl(auction.id)}
                            aria-label={t('editNamed', { title })}
                          >
                            {t('edit')}
                          </Link>
                        </Button>
                      ) : null}
                      {auction.status === 'ACTIVE' && auction.bidCount > 0 && href !== undefined ? (
                        <Button asChild>
                          <Link href={href} aria-label={t('showNamed', { title })}>
                            {t('show')}
                          </Link>
                        </Button>
                      ) : null}
                      {ended ? (
                        <Button
                          type="button"
                          onClick={() =>
                            void run(async () => {
                              const draft = await relistAuction(auction.id);
                              track('auction_relisted');
                              router.push(listingWizardUrl(draft.id));
                            })
                          }
                        >
                          <RotateCcw aria-hidden />
                          {t('relist')}
                        </Button>
                      ) : null}
                    </>
                  ) : undefined
                }
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

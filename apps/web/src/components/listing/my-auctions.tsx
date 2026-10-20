'use client';

// Moje aukcje (F-14, /moje-biddy/aukcje od F-21): filtr statusu, edycja szkicu albo aukcji bez ofert,
// anulowanie z ostrzeżeniem o strike'u, ponowne wystawienie i usuwanie szkiców.
import {
  type AuctionSummaryDto,
  cancelAuction,
  deleteAuctionDraft,
  getGetMyAuctionsQueryKey,
  relistAuction,
  useGetMyAuctions,
} from '@biddy/api-client';
import { formatMoney, money } from '@biddy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Clock, Gavel, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { track } from '@/analytics/posthog';
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
import { ListingCard, filterPillClasses } from '@/components/my-biddy/listing-card';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { listingWizardUrl } from '@/lib/routes';

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

const zl = (amount: number) => formatMoney(money(amount));

/** Plakietka statusu aukcji (F-62): ton mówi, czy coś trzeba zrobić. */
const STATUS_BADGES: Record<
  AuctionSummaryDto['status'],
  Pick<React.ComponentProps<typeof Badge>, 'tone' | 'variant'>
> = {
  DRAFT: { tone: 'neutral', variant: 'soft' },
  PENDING_REVIEW: { tone: 'warning', variant: 'soft' },
  ACTIVE: { tone: 'brand', variant: 'soft' },
  ENDED_SOLD: { tone: 'success', variant: 'soft' },
  ENDED_UNSOLD: { tone: 'danger', variant: 'outline' },
  CANCELLED: { tone: 'neutral', variant: 'outline' },
};

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
      <div role="group" aria-label={t('filter')} className="flex flex-wrap gap-2">
        {FILTERS.map((option) => (
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
            {t(`filters.${option}`)}
          </Button>
        ))}
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
            const active = auction.status === 'ACTIVE' || auction.status === 'PENDING_REVIEW';
            const ended =
              auction.status === 'ENDED_SOLD' ||
              auction.status === 'ENDED_UNSOLD' ||
              auction.status === 'CANCELLED';
            const price = auction.currentPrice ?? auction.startPrice;
            return (
              <ListingCard
                key={auction.id}
                status={
                  <Badge {...STATUS_BADGES[auction.status]}>
                    {t(`statuses.${auction.status}`)}
                  </Badge>
                }
                aside={
                  auction.status === 'ACTIVE' && auction.endsAt !== null ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Clock aria-hidden className="size-4" />
                      {t('endsAt', { date: dateTime(auction.endsAt) })}
                    </span>
                  ) : undefined
                }
                imageUrl={auction.coverUrl}
                noPhotoLabel={t('noPhoto')}
                title={title}
                meta={
                  auction.status === 'DRAFT' ? undefined : (
                    <span>{t('bids', { count: auction.bidCount })}</span>
                  )
                }
                priceLabel={auction.currentPrice === null ? t('startPrice') : t('currentPrice')}
                price={price === null ? undefined : zl(price)}
                actions={
                  auction.editable || active || ended || auction.status === 'DRAFT' ? (
                    <>
                      {auction.editable ? (
                        <Button
                          asChild
                          size="sm"
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
                      {active ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button type="button" size="sm" variant="destructive-outline">
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
                      {ended ? (
                        <Button
                          type="button"
                          size="sm"
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
                      {auction.status === 'DRAFT' ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button type="button" size="sm" variant="destructive-outline">
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

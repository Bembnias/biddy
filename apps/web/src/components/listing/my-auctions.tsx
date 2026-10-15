'use client';

// Moje aukcje (F-14, /konto/aukcje): filtr statusu, edycja szkicu albo aukcji bez ofert,
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
import { Button } from '@/components/ui/button';
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
        <p role="status" className="rounded-lg border border-border bg-muted p-4 text-sm">
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
            variant={filter === option ? 'default' : 'outline'}
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
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {visible.map((auction) => {
            const title = auction.title ?? t('untitled');
            const active = auction.status === 'ACTIVE' || auction.status === 'PENDING_REVIEW';
            const ended =
              auction.status === 'ENDED_SOLD' ||
              auction.status === 'ENDED_UNSOLD' ||
              auction.status === 'CANCELLED';
            return (
              <li key={auction.id} className="flex flex-wrap items-start gap-4 p-4">
                {auction.coverUrl === null ? (
                  <div aria-hidden className="size-16 rounded-md bg-muted" />
                ) : (
                  // Miniatura WebP z CDN.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={auction.coverUrl} alt="" className="size-16 rounded-md object-cover" />
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium">{title}</p>
                  <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <Badge variant="outline">{t(`statuses.${auction.status}`)}</Badge>
                    {auction.currentPrice === null ? (
                      auction.startPrice === null ? null : (
                        <span>{t('startPrice', { price: zl(auction.startPrice) })}</span>
                      )
                    ) : (
                      <span>{t('currentPrice', { price: zl(auction.currentPrice) })}</span>
                    )}
                    {auction.status === 'DRAFT' ? null : (
                      <span>{t('bids', { count: auction.bidCount })}</span>
                    )}
                    {auction.status === 'ACTIVE' && auction.endsAt !== null ? (
                      <span>{t('endsAt', { date: dateTime(auction.endsAt) })}</span>
                    ) : null}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {auction.editable ? (
                    <Button asChild size="sm" variant="outline">
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
                        <Button type="button" size="sm" variant="outline">
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
                            <p className="text-sm font-medium text-destructive">
                              {t('cancelWithBids')}
                            </p>
                          ) : null}
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t('keep')}</AlertDialogCancel>
                          <AlertDialogAction
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
                      variant="outline"
                      onClick={() =>
                        void run(async () => {
                          const draft = await relistAuction(auction.id);
                          track('auction_relisted');
                          router.push(listingWizardUrl(draft.id));
                        })
                      }
                    >
                      {t('relist')}
                    </Button>
                  ) : null}
                  {auction.status === 'DRAFT' ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button type="button" size="sm" variant="outline">
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
                            onClick={() => void run(() => deleteAuctionDraft(auction.id))}
                          >
                            {t('deleteConfirm')}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

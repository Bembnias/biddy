'use client';

import {
  type BidHistoryDto,
  type PublicAuctionDto,
  getBidHistory,
  getGetBidHistoryQueryKey,
} from '@biddy/api-client';
import { formatMoney, money } from '@biddy/shared';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { useAuction } from './use-auction';

/**
 * Historia ofert (F-15, F-18): licytujący zanonimizowani, 50 najnowszych i „Pokaż starsze”.
 * Pobierana w przeglądarce; liczba ofert w kluczu zapytania odświeża ją po nowej ofercie.
 */
export function BidHistory({ initial }: { readonly initial: PublicAuctionDto }) {
  const t = useTranslations('auction.history');
  const format = useFormatter();
  const auction = useAuction(initial);
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

  return (
    <section aria-labelledby="bid-history-title" className="space-y-3">
      <h2 id="bid-history-title" className="text-xl font-semibold">
        {t('title')}
      </h2>
      {history.isPending ? (
        <div className="space-y-2" aria-busy="true">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      ) : history.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          {t('error')}
          <Button type="button" variant="outline" size="sm" onClick={() => void history.refetch()}>
            {t('retry')}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 font-medium">
                  {t('bidder')}
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  {t('amount')}
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  {t('time')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((bid) => (
                <tr key={bid.id}>
                  <td className="py-2">
                    {bid.bidder}
                    {bid.kind === 'MANUAL' ? null : (
                      <span className="block text-xs text-muted-foreground">
                        {t('kind', { kind: bid.kind })}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatMoney(money(bid.amount, history.data?.pages[0]?.currency ?? 'PLN'))}
                  </td>
                  <td className="py-2 text-right text-muted-foreground">
                    <time dateTime={bid.createdAt}>
                      {format.dateTime(new Date(bid.createdAt), {
                        dateStyle: 'short',
                        timeStyle: 'medium',
                      })}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {history.hasNextPage ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
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

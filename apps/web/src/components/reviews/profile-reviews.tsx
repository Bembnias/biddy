'use client';

import {
  getListUserReviewsQueryKey,
  listUserReviews,
  type PublicReviewListDto,
  type PublicReviewListDtoItemsItem,
} from '@biddy/api-client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

import { RatingStars } from './rating-stars';

/**
 * Lista ocen na profilu (F-30): pierwsza strona z serwera (SEO), kolejne po 20 przez
 * „Wcześniejsze oceny”. Autor zanonimizowany, bez numeru zamówienia i kwot.
 */
export function ProfileReviews({
  userId,
  initialPage,
}: {
  readonly userId: string;
  readonly initialPage: PublicReviewListDto;
}) {
  const t = useTranslations('reviews.profile');
  const list = useInfiniteQuery({
    queryKey: getListUserReviewsQueryKey(userId),
    queryFn: ({ pageParam, signal }) =>
      listUserReviews(userId, pageParam === undefined ? undefined : { before: pageParam }, {
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: PublicReviewListDto) => page.nextBefore ?? undefined,
    initialData: { pages: [initialPage], pageParams: [undefined] },
    staleTime: 60_000,
  });
  const items = list.data.pages.flatMap((page) => page.items);
  return (
    <div className="space-y-4">
      <ul
        aria-label={t('list')}
        className="divide-y divide-ink-100 rounded-xl border border-border bg-card"
      >
        {items.map((review) => (
          <ReviewItem key={review.id} review={review} />
        ))}
      </ul>
      {list.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-destructive-soft px-4 py-3 text-body-sm text-destructive"
        >
          {t('error')}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void list.fetchNextPage()}
          >
            {t('retry')}
          </Button>
        </div>
      ) : null}
      {list.hasNextPage && !list.isError ? (
        <Button
          type="button"
          variant="outline"
          className="mx-auto flex"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? t('loadingMore') : t('more')}
        </Button>
      ) : null}
    </div>
  );
}

function ReviewItem({ review }: { readonly review: PublicReviewListDtoItemsItem }) {
  const t = useTranslations('reviews');
  const format = useFormatter();
  return (
    <li className="space-y-1.5 px-4 py-4 md:px-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <RatingStars value={review.rating} label={t('stars', { rating: review.rating })} />
        <p className="text-caption text-muted-foreground">
          {t('profile.author', {
            role: t(`roleFrom.${review.authorRole}`),
            name: review.authorName,
          })}{' '}
          ·{' '}
          <time dateTime={review.createdAt}>
            {format.dateTime(new Date(review.createdAt), { dateStyle: 'long' })}
          </time>
        </p>
      </div>
      <p className="text-body-sm font-semibold break-words text-foreground-secondary">
        {review.title}
      </p>
      {review.comment === null ? null : (
        <p className="text-body break-words whitespace-pre-line">{review.comment}</p>
      )}
    </li>
  );
}

import type { UserRatingDto } from '@biddy/api-client';
import { getFormatter, getTranslations } from 'next-intl/server';

import { AVERAGE_FORMAT } from '@/lib/reviews/reviews';

import { RatingStars } from './rating-stars';

/** Podsumowanie ocen na profilu (F-30): średnia z gwiazdkami, liczba i wiersze według ról. */
export async function RatingSummary({ rating }: { readonly rating: UserRatingDto }) {
  const t = await getTranslations('reviews');
  const format = await getFormatter();
  const average = (value: number) => format.number(value, AVERAGE_FORMAT);
  const row = (label: string, stats: UserRatingDto['asSeller']) => (
    <div className="flex justify-between gap-4">
      <dt className="text-foreground-secondary">{label}</dt>
      <dd className="font-semibold tabular-nums">
        {stats.average === null
          ? t('profile.none')
          : `${average(stats.average)} · ${t('profile.summaryCount', { count: stats.count })}`}
      </dd>
    </div>
  );
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      {rating.average === null ? null : (
        <div className="flex items-center gap-3">
          <p className="text-h1 font-extrabold tabular-nums">{average(rating.average)}</p>
          <div className="space-y-1">
            <RatingStars
              size="lg"
              value={rating.average}
              label={t('average', { average: average(rating.average) })}
            />
            <p className="text-body-sm text-muted-foreground">
              {t('profile.summaryCount', { count: rating.count })}
            </p>
          </div>
        </div>
      )}
      <dl className="space-y-2 border-t border-ink-100 pt-3.5 text-body-sm">
        {row(t('profile.asSeller'), rating.asSeller)}
        {row(t('profile.asBuyer'), rating.asBuyer)}
      </dl>
    </div>
  );
}

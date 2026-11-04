'use client';

// Ocena transakcji na stronie zamówienia (F-30): formularz (gwiazdki i komentarz), moja ocena
// z terminem ujawnienia, ocena drugiej strony po ujawnieniu i stan po terminie. Zamówienie w toku
// albo zakończone bez transakcji nie pokazuje karty.
import {
  getGetOrderReviewsQueryKey,
  type OrderReviewsDto,
  type OrderReviewsDtoMine,
  submitOrderReview,
  useGetOrderReviews,
} from '@biddy/api-client';
import {
  REVIEW_COMMENT_MESSAGES,
  REVIEW_LIMITS,
  REVIEW_RATINGS,
  REVIEW_REVEAL_DAYS,
  reviewCommentIssue,
  reviewContactFlags,
  type ReviewRating,
} from '@biddy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, Star } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { track } from '@/analytics/posthog';
import { AuthForm, FieldErrorText, FormAlert, useErrorMessage } from '@/components/auth/form-parts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { RatingStars } from './rating-stars';

/** Stany zamówienia, w których ocena bywa możliwa (resztę rozstrzyga API: spór przy zwrocie). */
const REVIEWABLE_STATUSES = new Set(['COMPLETED', 'REFUNDED', 'PARTIALLY_REFUNDED']);

export function isReviewableStatus(status: string): boolean {
  return REVIEWABLE_STATUSES.has(status);
}

export function OrderReviewCard({ publicId }: { readonly publicId: string }) {
  const t = useTranslations('reviews.order');
  const reviews = useGetOrderReviews(publicId);
  const [submitted, setSubmitted] = useState(false);

  if (reviews.isPending) {
    return (
      <div aria-busy="true">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }
  if (reviews.isError) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-destructive-soft px-4 py-3 text-body-sm text-destructive"
      >
        {t('error')}
        <Button type="button" variant="outline" size="sm" onClick={() => void reviews.refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  }
  const state = reviews.data;
  if (state.blocker === 'NOT_FINISHED') {
    return null;
  }
  return (
    <section
      aria-labelledby="order-review-title"
      className="space-y-5 rounded-2xl border border-border bg-card p-5.5 sm:p-7"
    >
      <h2 id="order-review-title" className="text-overline text-muted-foreground uppercase">
        {t('title')}
      </h2>
      <p role="status" className={submitted ? 'text-body font-semibold text-success' : 'sr-only'}>
        {submitted ? t('submitted') : ''}
      </p>
      {state.blocker === null ? (
        <ReviewForm
          state={state}
          publicId={publicId}
          onSubmitted={() => {
            setSubmitted(true);
          }}
        />
      ) : null}
      {state.mine === null ? null : <MyReview review={state.mine} />}
      <TheirReview state={state} />
      {state.blocker === 'WINDOW_CLOSED' && state.mine === null && state.rateUntil !== null ? (
        <ClosedNote until={state.rateUntil} />
      ) : null}
    </section>
  );
}

function useDate() {
  const format = useFormatter();
  return (iso: string) =>
    format.dateTime(new Date(iso), {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
}

function ReviewForm({
  state,
  publicId,
  onSubmitted,
}: {
  readonly state: OrderReviewsDto;
  readonly publicId: string;
  readonly onSubmitted: () => void;
}) {
  const t = useTranslations('reviews.order');
  const labels = useTranslations('reviews.labels');
  const date = useDate();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const id = useId();
  const [rating, setRating] = useState<ReviewRating>();
  const [comment, setComment] = useState('');
  const [ratingError, setRatingError] = useState<string>();
  const [commentError, setCommentError] = useState<string>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  // Chwila otwarcia formularza: szacunek ujawnienia nie zmienia się przy każdym renderowaniu.
  const [openedAt] = useState(() => Date.now());
  const deadline = state.rateUntil ?? '';
  const contact = reviewContactFlags(comment).length > 0;
  const name = state.counterpart.name;

  const submit = async () => {
    setError(undefined);
    const issue = reviewCommentIssue(comment);
    setRatingError(rating === undefined ? t('ratingRequired') : undefined);
    setCommentError(issue === undefined ? undefined : REVIEW_COMMENT_MESSAGES[issue]);
    if (rating === undefined || issue !== undefined) {
      return;
    }
    setSubmitting(true);
    try {
      const updated = await submitOrderReview(publicId, { rating, comment });
      track('review_submitted', {
        role: state.role,
        rating,
        hasComment: comment.trim() !== '',
      });
      queryClient.setQueryData(getGetOrderReviewsQueryKey(publicId), updated);
      onSubmitted();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const commentDescribedBy = [
    `${id}-comment-hint`,
    contact ? `${id}-comment-contact` : undefined,
    commentError === undefined ? undefined : `${id}-comment-error`,
  ]
    .filter((value) => value !== undefined)
    .join(' ');

  return (
    <AuthForm
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="space-y-5"
    >
      <div className="space-y-1">
        <p className="text-h3 break-words">
          {name === '' ? t('questionFallback') : t('question', { name })}
        </p>
        <p className="text-body-sm text-foreground-secondary">{t(`lead.${state.role}`)}</p>
      </div>
      <fieldset
        className="min-w-0 space-y-2"
        aria-describedby={ratingError === undefined ? undefined : `${id}-rating-error`}
      >
        <legend className="mb-2 text-title">{t('rating')}</legend>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1">
            {REVIEW_RATINGS.map((option) => (
              <label
                key={option}
                htmlFor={`${id}-rating-${String(option)}`}
                className="relative grid size-11 cursor-pointer place-items-center rounded-lg transition-colors duration-150 hover:bg-muted has-[:focus-visible]:shadow-focus-ring motion-reduce:transition-none"
              >
                <input
                  id={`${id}-rating-${String(option)}`}
                  type="radio"
                  name={`${id}-rating`}
                  value={option}
                  checked={rating === option}
                  onChange={() => {
                    setRating(option);
                    setRatingError(undefined);
                  }}
                  className="sr-only"
                />
                <Star
                  aria-hidden
                  className={cn(
                    'size-7',
                    rating !== undefined && option <= rating
                      ? 'fill-current text-rating'
                      : 'text-ink-400',
                  )}
                />
                <span className="sr-only">
                  {t('ratingOption', { rating: option, label: labels(`${option}` as const) })}
                </span>
              </label>
            ))}
          </div>
          {rating === undefined ? null : (
            <span aria-hidden className="text-body font-semibold">
              {labels(`${rating}` as const)}
            </span>
          )}
        </div>
        {ratingError === undefined ? null : (
          <FieldErrorText id={`${id}-rating-error`}>{ratingError}</FieldErrorText>
        )}
      </fieldset>
      <div className="space-y-2">
        <Label htmlFor={`${id}-comment`}>{t('comment')}</Label>
        <Textarea
          id={`${id}-comment`}
          value={comment}
          maxLength={REVIEW_LIMITS.commentMax}
          aria-invalid={commentError === undefined ? undefined : true}
          aria-describedby={commentDescribedBy}
          onChange={(event) => {
            setComment(event.target.value);
            setCommentError(undefined);
          }}
        />
        <p
          id={`${id}-comment-hint`}
          className="flex justify-between gap-3 text-body-sm text-muted-foreground"
        >
          <span>{t('commentHint')}</span>
          <span className="tabular-nums">
            {[...comment.trim()].length}/{REVIEW_LIMITS.commentMax}
          </span>
        </p>
        {contact && commentError === undefined ? (
          <Alert id={`${id}-comment-contact`} variant="warning" role="note" className="py-2.5">
            <ShieldAlert aria-hidden />
            <AlertDescription className="text-foreground">{t('contactHint')}</AlertDescription>
          </Alert>
        ) : null}
        {commentError === undefined ? null : (
          <FieldErrorText id={`${id}-comment-error`}>{commentError}</FieldErrorText>
        )}
      </div>
      <p className="text-body-sm text-foreground-secondary">
        {state.counterpartReviewed
          ? t('counterpartReviewed', { deadline: date(deadline) })
          : t('reveal', {
              date: date(revealEstimate(openedAt, deadline)),
              deadline: date(deadline),
            })}
      </p>
      {error === undefined ? null : <FormAlert>{error}</FormAlert>}
      <div className="flex justify-end">
        <Button type="submit" variant="cta" disabled={submitting}>
          {submitting ? t('submitting') : t('submit')}
        </Button>
      </div>
    </AuthForm>
  );
}

/**
 * Najpóźniejsze ujawnienie mojej oceny wystawionej teraz: 7 dni, ale nie po terminie (koniec
 * okna). Ta sama reguła co w API (`firstReviewVisibleAt`).
 */
function revealEstimate(now: number, deadline: string): string {
  const reveal = now + REVIEW_REVEAL_DAYS * 24 * 60 * 60 * 1000;
  return new Date(Math.min(reveal, new Date(deadline).getTime())).toISOString();
}

function MyReview({ review }: { readonly review: NonNullable<OrderReviewsDtoMine> }) {
  const t = useTranslations('reviews');
  const date = useDate();
  return (
    <div className="space-y-2 rounded-xl bg-canvas px-4 py-3.5">
      <p className="text-title">{t('order.mine')}</p>
      <RatingStars value={review.rating} label={t('stars', { rating: review.rating })} />
      <p className="text-body break-words whitespace-pre-line">
        {review.comment ?? t('order.noComment')}
      </p>
      <p className="text-body-sm text-muted-foreground">
        {review.visible
          ? t('order.mineVisible')
          : t('order.mineHidden', { date: date(review.visibleAt) })}
      </p>
    </div>
  );
}

function TheirReview({ state }: { readonly state: OrderReviewsDto }) {
  const t = useTranslations('reviews');
  const name = state.counterpart.name;
  if (state.theirs === null) {
    return state.counterpartReviewed && state.mine !== null ? (
      <p className="text-body-sm text-foreground-secondary">{t('order.theirsPending')}</p>
    ) : null;
  }
  return (
    <div className="space-y-2 rounded-xl border border-border px-4 py-3.5">
      <p className="text-title break-words">
        {name === '' ? t('order.theirsFallback') : t('order.theirs', { name })}
      </p>
      <RatingStars
        value={state.theirs.rating}
        label={t('stars', { rating: state.theirs.rating })}
      />
      <p className="text-body break-words whitespace-pre-line">
        {state.theirs.comment ?? t('order.noComment')}
      </p>
    </div>
  );
}

function ClosedNote({ until }: { readonly until: string }) {
  const t = useTranslations('reviews.order');
  const date = useDate();
  return (
    <p className="text-body-sm text-foreground-secondary">{t('closed', { date: date(until) })}</p>
  );
}

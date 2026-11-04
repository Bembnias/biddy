// DTO ocen (F-30): stan ocen zamówienia dla strony, wystawienie oceny, reputacja konta i publiczna
// lista ocen (autor zanonimizowany, bez numeru zamówienia i kwot).
import {
  REVIEW_COMMENT_MESSAGES,
  REVIEW_LIMITS,
  REVIEW_ROLES,
  reviewCommentIssue,
} from '@biddy/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import type { OrderReviews } from '../application/review.service.js';
import type { PublicReview, RatingStats, UserRating } from '../application/reputation.service.js';
import type { ReviewRow } from '../db/reviews.schema.js';

const timestamp = z.iso.datetime();
const authorRole = z
  .enum(REVIEW_ROLES)
  .describe('Rola autora: BUYER ocenia sprzedającego, SELLER kupującego');
const blocker = z.enum(['NOT_FINISHED', 'WINDOW_CLOSED', 'ALREADY_REVIEWED']);

const reviewSchema = z.object({
  id: z.uuid(),
  rating: z.int().min(1).max(5),
  comment: z.string().min(1).nullable(),
  authorRole,
  createdAt: timestamp,
  visibleAt: timestamp.describe('Od kiedy ocena jest publiczna'),
  visible: z.boolean(),
});

export class OrderReviewsDto extends createZodDto(
  z.object({
    orderPublicId: z.string(),
    role: z.enum(REVIEW_ROLES).describe('Moja rola w zamówieniu'),
    counterpart: z.object({ id: z.uuid(), name: z.string() }),
    blocker: blocker.nullable().describe('Dlaczego nie mogę ocenić; null: mogę (do `rateUntil`)'),
    rateUntil: timestamp
      .nullable()
      .describe('Termin mojej oceny: koniec okna albo ujawnienie oceny drugiej strony'),
    mine: reviewSchema.nullable(),
    theirs: reviewSchema.nullable().describe('Ocena drugiej strony, tylko po ujawnieniu'),
    counterpartReviewed: z
      .boolean()
      .describe('Druga strona już oceniła (treść ukryta do ujawnienia)'),
  }),
) {}

export class SubmitReviewBody extends createZodDto(
  z
    .object({
      rating: z.int('Wybierz ocenę.').min(1, 'Wybierz ocenę.').max(5, 'Wybierz ocenę.'),
      comment: z
        .string()
        .max(REVIEW_LIMITS.commentMax * 4)
        .nullish()
        .describe(
          `Komentarz publiczny (opcjonalny, do ${String(REVIEW_LIMITS.commentMax)} znaków)`,
        ),
    })
    .strict()
    .superRefine((value, context) => {
      const issue = reviewCommentIssue(value.comment);
      if (issue !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['comment'],
          message: REVIEW_COMMENT_MESSAGES[issue],
        });
      }
    }),
) {}

const statsSchema = z.object({
  average: z
    .number()
    .min(1)
    .max(5)
    .nullable()
    .describe('Średnia (dwa miejsca po przecinku); null bez ocen'),
  count: z.int().nonnegative(),
});

export class UserRatingDto extends createZodDto(
  statsSchema.extend({
    userId: z.uuid(),
    asSeller: statsSchema.describe('Oceny od kupujących'),
    asBuyer: statsSchema.describe('Oceny od sprzedających'),
  }),
) {}

export class PublicReviewListDto extends createZodDto(
  z.object({
    items: z.array(
      z.object({
        id: z.uuid(),
        rating: z.int().min(1).max(5),
        comment: z.string().min(1).nullable(),
        authorRole,
        authorName: z.string().describe('Autor zanonimizowany, np. „a***a”'),
        title: z.string().describe('Przedmiot zamówienia'),
        createdAt: timestamp,
      }),
    ),
    nextBefore: z.uuid().nullable().describe('Kursor kolejnej strony'),
  }),
) {}

function reviewDto(review: ReviewRow, now: Date): z.infer<typeof reviewSchema> {
  return {
    id: review.id,
    rating: review.rating,
    comment: review.comment,
    authorRole: review.role,
    createdAt: review.createdAt.toISOString(),
    visibleAt: review.visibleAt.toISOString(),
    visible: review.visibleAt <= now,
  };
}

export function orderReviewsDto(view: OrderReviews): OrderReviewsDto {
  return {
    orderPublicId: view.order.publicId,
    role: view.role,
    counterpart: view.counterpart,
    blocker: view.blocker,
    rateUntil: view.rateUntil?.toISOString() ?? null,
    mine: view.mine === undefined ? null : reviewDto(view.mine, view.now),
    theirs: view.theirs === undefined ? null : reviewDto(view.theirs, view.now),
    counterpartReviewed: view.counterpartReviewed,
  };
}

const statsDto = (stats: RatingStats) => ({ average: stats.average, count: stats.count });

export function userRatingDto(rating: UserRating): UserRatingDto {
  return {
    userId: rating.userId,
    ...statsDto(rating),
    asSeller: statsDto(rating.asSeller),
    asBuyer: statsDto(rating.asBuyer),
  };
}

export function publicReviewDto({ review, authorName }: PublicReview) {
  return {
    id: review.id,
    rating: review.rating,
    comment: review.comment,
    authorRole: review.role,
    authorName,
    title: review.title,
    createdAt: review.createdAt.toISOString(),
  };
}

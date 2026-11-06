// Eventy domenowe modułu reviews (F-30, PROJECT.md §14.3). Konsument: powiadomienia. Eventy niosą
// numer zamówienia i tytuł przedmiotu, żeby konsument nie czytał tabel zamówień ani ocen.
import { REVIEW_ROLES } from '@biddy/shared';
import { z } from 'zod';

import { defineDomainEvent } from '../../infra/outbox/index.js';

const order = {
  reviewId: z.uuid(),
  orderId: z.uuid(),
  orderPublicId: z.string().min(1),
  title: z.string(),
  authorRole: z.enum(REVIEW_ROLES),
  targetId: z.uuid(),
};

/**
 * Strona wystawiła ocenę. `counterpartReviewed`: druga strona oceniła wcześniej (obie oceny są już
 * widoczne); inaczej druga strona dostaje zaproszenie do oceny z terminem `rateUntil`. Treści
 * i gwiazdek nie ma w evencie: druga strona nie może ich poznać przed ujawnieniem.
 */
export const ReviewSubmitted = defineDomainEvent({
  type: 'ReviewSubmitted',
  version: 1,
  aggregateType: 'review',
  payload: z.object({
    ...order,
    authorId: z.uuid(),
    counterpartReviewed: z.boolean(),
    rateUntil: z.iso.datetime(),
  }),
});

/** Ocena stała się publiczna (druga ocena albo upływ 7 dni); emituje job `reviews.publish`. */
export const ReviewPublished = defineDomainEvent({
  type: 'ReviewPublished',
  version: 1,
  aggregateType: 'review',
  payload: z.object({
    ...order,
    rating: z.int().min(1).max(5),
  }),
});

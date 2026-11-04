// Powiadomienia o ocenach (F-30): „druga strona oceniła zamówienie” z terminem oceny odbiorcy (bez
// gwiazdek: ocena jest ukryta do ujawnienia) i „nowa ocena” po ujawnieniu oceny o odbiorcy (job
// reviews.publish). E-maile można wyłączyć w ustawieniach.
import { Inject, Injectable } from '@nestjs/common';

import {
  type DomainEventContext,
  type DomainEventOf,
  OnDomainEvent,
} from '../../../infra/outbox/index.js';
import { ReviewPublished, ReviewSubmitted } from '../../reviews/index.js';
import { NotificationService } from './notification.service.js';

@Injectable()
export class ReviewNotificationSources {
  constructor(@Inject(NotificationService) private readonly notifications: NotificationService) {}

  @OnDomainEvent(ReviewSubmitted, { consumer: 'notifications.review-requested' })
  async onSubmitted(
    event: DomainEventOf<typeof ReviewSubmitted>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const { payload } = event;
    // Obie oceny są już widoczne: każda strona dostanie „nową ocenę” z joba.
    if (payload.counterpartReviewed) {
      return;
    }
    await this.notifications.notify(tx, [
      {
        userId: payload.targetId,
        type: 'REVIEW_REQUESTED',
        dedupeKey: `REVIEW_REQUESTED:${payload.orderId}:${payload.targetId}`,
        auctionId: null,
        payload: {
          review: {
            orderPublicId: payload.orderPublicId,
            title: payload.title,
            authorRole: payload.authorRole,
            rateUntil: payload.rateUntil,
          },
        },
      },
    ]);
  }

  @OnDomainEvent(ReviewPublished, { consumer: 'notifications.review-received' })
  async onPublished(
    event: DomainEventOf<typeof ReviewPublished>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const { payload } = event;
    await this.notifications.notify(tx, [
      {
        userId: payload.targetId,
        type: 'REVIEW_RECEIVED',
        dedupeKey: `REVIEW_RECEIVED:${payload.reviewId}`,
        auctionId: null,
        payload: {
          review: {
            orderPublicId: payload.orderPublicId,
            title: payload.title,
            authorRole: payload.authorRole,
            rating: payload.rating,
          },
        },
      },
    ]);
  }
}

// Ujawnienie ocen (F-30): job reviews.publish co minutę emituje ReviewPublished dla ocen, które
// stały się publiczne (druga ocena zamówienia albo upływ 7 dni), i oznacza je `published_at`.
// Obie drogi ujawnienia idą tą samą ścieżką, więc powiadomienie przychodzi najwyżej minutę później.
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, inArray, isNull, lte } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { Outbox } from '../../../infra/outbox/index.js';
import { ScheduledJob } from '../../../infra/queues/index.js';
import { reviews } from '../db/reviews.schema.js';
import { ReviewPublished } from '../reviews.events.js';

/** Ocen w jednym wykonaniu joba. */
export const PUBLISH_BATCH = 500;

@Injectable()
export class ReviewPublisher {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly outbox: Outbox,
  ) {}

  @ScheduledJob({ queue: 'reviews', name: 'reviews.publish', every: 60_000 })
  async run(): Promise<{ readonly published: number }> {
    return this.publishDue(new Date());
  }

  /** Eventy dla ocen widocznych od `now` lub wcześniej, jeszcze bez `published_at`. */
  async publishDue(now: Date): Promise<{ readonly published: number }> {
    return this.db.transaction(async (tx) => {
      const due = await tx
        .select()
        .from(reviews)
        .where(and(isNull(reviews.publishedAt), lte(reviews.visibleAt, now)))
        .orderBy(asc(reviews.visibleAt))
        .limit(PUBLISH_BATCH)
        .for('update', { skipLocked: true });
      for (const review of due) {
        await this.outbox.add(
          tx,
          ReviewPublished.create({
            aggregateId: review.id,
            payload: {
              reviewId: review.id,
              orderId: review.orderId,
              orderPublicId: review.orderPublicId,
              title: review.title,
              authorRole: review.role,
              targetId: review.targetId,
              rating: review.rating,
            },
          }),
        );
      }
      if (due.length > 0) {
        await tx
          .update(reviews)
          .set({ publishedAt: now })
          .where(
            inArray(
              reviews.id,
              due.map((review) => review.id),
            ),
          );
      }
      return { published: due.length };
    });
  }
}

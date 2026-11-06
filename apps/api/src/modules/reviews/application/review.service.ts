// Oceny zamówienia (F-30): stan dla strony (moja ocena, ocena drugiej strony po ujawnieniu, termin)
// i wystawienie oceny. Wystawienie trzyma blokadę doradczą zamówienia, więc równoczesne oceny obu
// stron widzą się nawzajem: druga ocena odsłania obie (decyzja nr 143).
import { normalizeReviewComment, type ReviewRole } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, sql } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { Outbox } from '../../../infra/outbox/index.js';
import { ProfileService } from '../../identity/index.js';
import { type Order, OrderService, type ParticipantOrder } from '../../orders/index.js';
import { type ReviewRow, reviews } from '../db/reviews.schema.js';
import {
  firstReviewVisibleAt,
  isVisible,
  rateUntil,
  REVIEW_BLOCKER_TEXT,
  type ReviewBlocker,
  reviewBlocker,
  reviewWindowEnd,
} from '../domain/review-rules.js';
import { ReviewSubmitted } from '../reviews.events.js';

/** Ocena wystawiana przez stronę. */
export interface ReviewInput {
  readonly rating: number;
  readonly comment?: string | null | undefined;
}

/** Oceny zamówienia z perspektywy strony. */
export interface OrderReviews {
  readonly order: Order;
  readonly role: ReviewRole;
  readonly counterpart: { readonly id: string; readonly name: string };
  readonly blocker: ReviewBlocker | null;
  /** Termin mojej oceny; null, gdy zamówienia nie można ocenić. */
  readonly rateUntil: Date | null;
  readonly mine: ReviewRow | undefined;
  /** Ocena drugiej strony, tylko po ujawnieniu. */
  readonly theirs: ReviewRow | undefined;
  readonly counterpartReviewed: boolean;
  readonly now: Date;
}

function counterpartOf({ order, role }: ParticipantOrder): string {
  return role === 'BUYER' ? order.sellerId : order.buyerId;
}

@Injectable()
export class ReviewService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(OrderService) private readonly orders: OrderService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    private readonly outbox: Outbox,
  ) {}

  /** Stan ocen zamówienia dla strony (inni: 404 jak dla nieistniejącego zamówienia). */
  async forOrder(orderRef: string, userId: string): Promise<OrderReviews> {
    const participant = await this.orders.forParticipant(orderRef, userId);
    return this.view(participant, userId, new Date());
  }

  /**
   * Wystawia ocenę strony. Zamówienie w toku, po terminie albo już ocenione: 409
   * REVIEW_UNAVAILABLE z `reason`. Zwraca stan ocen po zapisie.
   */
  async submit(orderRef: string, userId: string, input: ReviewInput): Promise<OrderReviews> {
    const participant = await this.orders.forParticipant(orderRef, userId);
    const { order, role, snapshot } = participant;
    const counterpartId = counterpartOf(participant);
    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`reviews:${order.id}`}, 0))`,
      );
      // Czas po blokadzie: druga strona mogła właśnie ocenić.
      const now = new Date();
      const existing = await tx.select().from(reviews).where(eq(reviews.orderId, order.id));
      const mine = existing.find((review) => review.authorId === userId);
      const theirs = existing.find((review) => review.authorId === counterpartId);
      const blocker = reviewBlocker(order, mine, theirs, now);
      const windowEnd = reviewWindowEnd(order);
      if (blocker !== null || windowEnd === null) {
        const reason = blocker ?? 'NOT_FINISHED';
        throw new DomainError({
          code: 'REVIEW_UNAVAILABLE',
          detail: REVIEW_BLOCKER_TEXT[reason],
          extensions: { reason },
        });
      }
      const visibleAt = theirs === undefined ? firstReviewVisibleAt(now, windowEnd) : now;
      const [created] = await tx
        .insert(reviews)
        .values({
          orderId: order.id,
          orderPublicId: order.publicId,
          title: snapshot.item.title,
          authorId: userId,
          targetId: counterpartId,
          role,
          rating: input.rating,
          comment: normalizeReviewComment(input.comment),
          createdAt: now,
          visibleAt,
        })
        .returning();
      if (created === undefined) {
        throw new Error(`Nie zapisano oceny zamówienia ${order.id}`);
      }
      if (theirs !== undefined) {
        // Druga ocena odsłania pierwszą od razu.
        await tx
          .update(reviews)
          .set({ visibleAt: now })
          .where(and(eq(reviews.id, theirs.id), gt(reviews.visibleAt, now)));
      }
      await this.outbox.add(
        tx,
        ReviewSubmitted.create({
          aggregateId: created.id,
          payload: {
            reviewId: created.id,
            orderId: order.id,
            orderPublicId: order.publicId,
            title: created.title,
            authorRole: role,
            authorId: userId,
            targetId: counterpartId,
            counterpartReviewed: theirs !== undefined,
            // Termin drugiej strony kończy się z ujawnieniem tej oceny.
            rateUntil: rateUntil(windowEnd, created).toISOString(),
          },
        }),
      );
    });
    return this.view(participant, userId, new Date());
  }

  private async view(
    participant: ParticipantOrder,
    userId: string,
    now: Date,
  ): Promise<OrderReviews> {
    const { order, role } = participant;
    const counterpartId = counterpartOf(participant);
    const rows = await this.db.select().from(reviews).where(eq(reviews.orderId, order.id));
    const names = await this.profiles.displayNames([counterpartId]);
    const mine = rows.find((review) => review.authorId === userId);
    const theirs = rows.find((review) => review.authorId === counterpartId);
    const windowEnd = reviewWindowEnd(order);
    return {
      order,
      role,
      counterpart: { id: counterpartId, name: names.get(counterpartId) ?? '' },
      blocker: reviewBlocker(order, mine, theirs, now),
      rateUntil: windowEnd === null ? null : rateUntil(windowEnd, theirs),
      mine,
      theirs: theirs !== undefined && isVisible(theirs, now) ? theirs : undefined,
      counterpartReviewed: theirs !== undefined,
      now,
    };
  }
}

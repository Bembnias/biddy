import { Module } from '@nestjs/common';

import { OrdersModule } from '../orders/index.js';
import { ReputationService } from './application/reputation.service.js';
import { ReviewPublisher } from './application/review-publisher.js';
import { ReviewService } from './application/review.service.js';
import { OrderReviewsController } from './http/order-reviews.controller.js';
import { UserReviewsController } from './http/user-reviews.controller.js';

/**
 * Moduł domenowy `reviews` (PROJECT.md §10.3): oceny obu stron po zakończonym zamówieniu (F-30)
 * z ujawnieniem po obu ocenach albo po 7 dniach, reputacja na profilu i eventy dla powiadomień
 * (ReviewSubmitted, ReviewPublished). Publiczne API: ./index.ts.
 */
@Module({
  imports: [OrdersModule],
  controllers: [OrderReviewsController, UserReviewsController],
  providers: [ReviewService, ReputationService, ReviewPublisher],
  exports: [ReputationService],
})
export class ReviewsModule {}

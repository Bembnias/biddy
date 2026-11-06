import { Module } from '@nestjs/common';

import { AuctionsModule } from '../auctions/index.js';
import { OrdersModule } from '../orders/index.js';
import { AccountNotificationSources } from './notifications/account-notification-sources.js';
import { NotificationSources } from './notifications/notification-sources.js';
import { OrderNotificationSources } from './notifications/order-notification-sources.js';
import { DisputeNotificationSources } from './notifications/dispute-notification-sources.js';
import { MessageNotificationSources } from './notifications/message-notification-sources.js';
import { PayoutNotificationSources } from './notifications/payout-notification-sources.js';
import { ReviewNotificationSources } from './notifications/review-notification-sources.js';
import { NotificationService } from './notifications/notification.service.js';
import {
  MyNotificationsController,
  UnsubscribeController,
} from './notifications/notifications.controller.js';
import { PreferenceService } from './notifications/preference.service.js';

/**
 * Moduł domenowy `notifications` (PROJECT.md §10.3): centrum powiadomień, e-maile i preferencje
 * (F-20); powiadomienia o strike'ach, blokadach i odwołaniach (F-61), o etapach zamówienia
 * i drugiej szansie (F-26), o wypłatach (F-27), o sporach (F-28), o nieprzeczytanych
 * wiadomościach (F-29) i o ocenach (F-30). Publiczne API: ./index.ts.
 */
@Module({
  imports: [AuctionsModule, OrdersModule],
  controllers: [MyNotificationsController, UnsubscribeController],
  providers: [
    NotificationService,
    PreferenceService,
    NotificationSources,
    AccountNotificationSources,
    OrderNotificationSources,
    PayoutNotificationSources,
    DisputeNotificationSources,
    MessageNotificationSources,
    ReviewNotificationSources,
  ],
  exports: [NotificationService, PreferenceService],
})
export class NotificationsModule {}

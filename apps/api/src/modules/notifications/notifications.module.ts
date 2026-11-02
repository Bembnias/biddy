import { Module } from '@nestjs/common';

import { AuctionsModule } from '../auctions/index.js';
import { AccountNotificationSources } from './notifications/account-notification-sources.js';
import { NotificationSources } from './notifications/notification-sources.js';
import { NotificationService } from './notifications/notification.service.js';
import {
  MyNotificationsController,
  UnsubscribeController,
} from './notifications/notifications.controller.js';
import { PreferenceService } from './notifications/preference.service.js';

/**
 * Moduł domenowy `notifications` (PROJECT.md §10.3): centrum powiadomień, e-maile i preferencje
 * (F-20); powiadomienia o strike'ach, blokadach i odwołaniach (F-61). Publiczne API: ./index.ts.
 */
@Module({
  imports: [AuctionsModule],
  controllers: [MyNotificationsController, UnsubscribeController],
  providers: [
    NotificationService,
    PreferenceService,
    NotificationSources,
    AccountNotificationSources,
  ],
  exports: [NotificationService, PreferenceService],
})
export class NotificationsModule {}

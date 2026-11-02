import { Module } from '@nestjs/common';

import { AuctionsModule } from '../auctions/index.js';
import { NotificationSources } from './notifications/notification-sources.js';
import { NotificationService } from './notifications/notification.service.js';
import {
  MyNotificationsController,
  UnsubscribeController,
} from './notifications/notifications.controller.js';
import { PreferenceService } from './notifications/preference.service.js';

/**
 * Moduł domenowy `notifications` (PROJECT.md §10.3): centrum powiadomień, e-maile i preferencje
 * (F-20). Publiczne API: ./index.ts.
 */
@Module({
  imports: [AuctionsModule],
  controllers: [MyNotificationsController, UnsubscribeController],
  providers: [NotificationService, PreferenceService, NotificationSources],
  exports: [NotificationService, PreferenceService],
})
export class NotificationsModule {}

// Powiadomienia o wiadomościach (F-29): jedno na serię nieprzeczytanych wiadomości w rozmowie, po
// 5 minutach bez odczytu (job w module messaging emituje MessagesUnread). E-mail bez treści
// wiadomości; można go wyłączyć w ustawieniach.
import { Inject, Injectable } from '@nestjs/common';

import {
  type DomainEventContext,
  type DomainEventOf,
  OnDomainEvent,
} from '../../../infra/outbox/index.js';
import { MessagesUnread } from '../../messaging/index.js';
import { NotificationService } from './notification.service.js';

@Injectable()
export class MessageNotificationSources {
  constructor(@Inject(NotificationService) private readonly notifications: NotificationService) {}

  @OnDomainEvent(MessagesUnread, { consumer: 'notifications.new-message' })
  async onUnread(
    event: DomainEventOf<typeof MessagesUnread>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const { payload } = event;
    await this.notifications.notify(tx, [
      {
        userId: payload.recipientId,
        type: 'NEW_MESSAGE',
        dedupeKey: `NEW_MESSAGE:${payload.firstMessageId}`,
        auctionId: null,
        payload: {
          message: {
            conversationId: payload.conversationId,
            senderName: payload.senderName,
            title: payload.title,
            count: payload.count,
          },
        },
      },
    ]);
  }
}

import { Module } from '@nestjs/common';

import { AuctionsModule } from '../auctions/index.js';
import { MediaModule } from '../media/index.js';
import { OrdersModule } from '../orders/index.js';
import { TrustSafetyModule } from '../trust-safety/index.js';
import { BlockService } from './application/block.service.js';
import { ConversationReader } from './application/conversation-reader.js';
import { MessagingService } from './application/messaging.service.js';
import { UnreadNotifier } from './application/unread-notifier.js';
import { AdminMessagesController } from './http/admin-messages.controller.js';
import { BlocksController } from './http/blocks.controller.js';
import { ConversationsController } from './http/conversations.controller.js';

/**
 * Moduł domenowy `messaging` (PROJECT.md §10.3): rozmowy kupujący ↔ sprzedający o aukcji albo
 * zamówieniu (F-29) z wykrywaniem danych kontaktowych, blokady, zgłoszenia (zapis w trust-safety)
 * i powiadomienia o nieprzeczytanych wiadomościach (event MessagesUnread). Publiczne API: ./index.ts.
 */
@Module({
  imports: [AuctionsModule, OrdersModule, MediaModule, TrustSafetyModule],
  controllers: [ConversationsController, BlocksController, AdminMessagesController],
  providers: [MessagingService, ConversationReader, BlockService, UnreadNotifier],
  exports: [MessagingService, BlockService],
})
export class MessagingModule {}

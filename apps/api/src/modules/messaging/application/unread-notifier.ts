// Powiadomienia o nieprzeczytanych wiadomościach (F-29, decyzja nr 138): job
// messaging.notify-unread co minutę zbiera wiadomości nieprzeczytane od 5 minut, jeszcze bez
// powiadomienia, i dla każdej pary (rozmowa, odbiorca) emituje jeden event MessagesUnread. Kto
// czyta na bieżąco, nie dostaje powiadomień, a seria nieprzeczytanych wiadomości daje jedno: gdy
// odbiorca ma już powiadomioną, nieprzeczytaną wiadomość w tej rozmowie, kolejne dostają tylko
// znacznik. Tak samo wiadomości przy blokadzie między stronami.
import { MESSAGE_NOTIFY_DELAY_MINUTES } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, isNull, lte } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { Outbox } from '../../../infra/outbox/index.js';
import { ScheduledJob } from '../../../infra/queues/index.js';
import { AuctionDirectory } from '../../auctions/index.js';
import { ProfileService } from '../../identity/index.js';
import { conversations, messages } from '../db/messaging.schema.js';
import { MessagesUnread } from '../messaging.events.js';
import { BlockService } from './block.service.js';

/** Wiadomości sprawdzanych w jednym wykonaniu joba. */
export const NOTIFY_BATCH = 500;

const DELAY_MS = MESSAGE_NOTIFY_DELAY_MINUTES * 60_000;

/** Wynik wykonania joba: wiadomości oznaczone i wysłane powiadomienia (eventy). */
export interface UnreadNotifyReport {
  readonly messages: number;
  readonly notified: number;
}

@Injectable()
export class UnreadNotifier {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AuctionDirectory) private readonly auctions: AuctionDirectory,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    private readonly blocks: BlockService,
    private readonly outbox: Outbox,
  ) {}

  @ScheduledJob({ queue: 'messaging', name: 'messaging.notify-unread', every: 60_000 })
  async run(): Promise<UnreadNotifyReport> {
    return this.notifyUnread(new Date());
  }

  /** Powiadomienia o wiadomościach nieprzeczytanych od 5 minut względem `now`. */
  async notifyUnread(now: Date): Promise<UnreadNotifyReport> {
    return this.db.transaction(async (tx) => {
      const due = await tx
        .select({
          id: messages.id,
          conversationId: messages.conversationId,
          senderId: messages.senderId,
          recipientId: messages.recipientId,
          auctionId: conversations.auctionId,
        })
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(
          and(
            isNull(messages.readAt),
            isNull(messages.notifiedAt),
            lte(messages.createdAt, new Date(now.getTime() - DELAY_MS)),
          ),
        )
        .orderBy(asc(messages.createdAt))
        .limit(NOTIFY_BATCH)
        // Odczyt w trakcie joba czeka na zatwierdzenie (a nie odwrotnie): wiadomość przeczytana
        // przed blokadą nie trafia do wyniku.
        .for('update', { of: messages, skipLocked: true });
      if (due.length === 0) {
        return { messages: 0, notified: 0 };
      }
      const groups = new Map<string, (typeof due)[number][]>();
      for (const message of due) {
        const key = `${message.conversationId}:${message.recipientId}`;
        groups.set(key, [...(groups.get(key) ?? []), message]);
      }
      // Jedno połączenie transakcji: zapytania po kolei.
      const names = await this.profiles.displayNames(
        due.map((message) => message.senderId),
        tx,
      );
      const notices = await this.auctions.notices(
        due.map((message) => message.auctionId),
        tx,
      );
      // Pary, które już mają powiadomienie o nieprzeczytanej wiadomości (ta sama seria).
      const pending = await tx
        .selectDistinct({
          conversationId: messages.conversationId,
          recipientId: messages.recipientId,
        })
        .from(messages)
        .where(
          and(
            inArray(messages.conversationId, [
              ...new Set(due.map((message) => message.conversationId)),
            ]),
            isNull(messages.readAt),
            isNotNull(messages.notifiedAt),
          ),
        );
      const titles = new Map(notices.map((notice) => [notice.id, notice.title]));
      const alreadyNotified = new Set(
        pending.map((pair) => `${pair.conversationId}:${pair.recipientId}`),
      );
      let notified = 0;
      for (const [key, group] of groups) {
        const [first] = group;
        if (first === undefined || alreadyNotified.has(key)) {
          continue;
        }
        const blocks = await this.blocks.between(first.recipientId, first.senderId, tx);
        if (blocks.byMe || blocks.byThem) {
          continue;
        }
        await this.outbox.add(
          tx,
          MessagesUnread.create({
            aggregateId: first.conversationId,
            payload: {
              conversationId: first.conversationId,
              recipientId: first.recipientId,
              senderId: first.senderId,
              senderName: names.get(first.senderId) ?? '',
              title: titles.get(first.auctionId) ?? '',
              firstMessageId: first.id,
              count: group.length,
            },
          }),
        );
        notified += 1;
      }
      await tx
        .update(messages)
        .set({ notifiedAt: now })
        .where(
          inArray(
            messages.id,
            due.map((message) => message.id),
          ),
        );
      return { messages: due.length, notified };
    });
  }
}

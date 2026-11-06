// Widoki rozmów (F-29): lista rozmów strony (ostatnia aktywność, kursor), nagłówek rozmowy
// z przedmiotem, zamówieniem pary i blokadami, ekran nowej wiadomości oraz wgląd personelu
// w rozmowę spornego zamówienia. Aukcje, zamówienia i konta czyta przez publiczne API modułów,
// zbiorczo dla całej strony listy.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { AuctionDirectory, type AuctionSubject } from '../../auctions/index.js';
import { type ChatProfile, ProfileService } from '../../identity/index.js';
import { type Order, OrderService } from '../../orders/index.js';
import {
  type ConversationRow,
  conversations,
  type MessageRow,
  messages,
} from '../db/messaging.schema.js';
import type { ConversationRole, StartBlocker } from '../domain/conversation-rules.js';
import { type BlockState, BlockService } from './block.service.js';
import {
  type ConversationSubject,
  conversationNotFound,
  MessagingService,
} from './messaging.service.js';

/** Strona listy rozmów i wiadomości. */
export const CONVERSATIONS_PAGE = 30;
export const MESSAGES_PAGE = 50;
/** Najwięcej wiadomości w wglądzie personelu. */
export const STAFF_MESSAGES_LIMIT = 500;

/** Konto bez profilu (nieznane): pokazujemy jako niedostępne. */
const UNKNOWN_PROFILE = (id: string): ChatProfile => ({
  id,
  name: '',
  avatarUrl: null,
  banned: true,
});

/** Rozmowa z perspektywy strony: druga strona, przedmiot, zamówienie pary i ostatnia wiadomość. */
export interface ConversationView {
  readonly conversation: ConversationRow;
  readonly role: ConversationRole;
  readonly counterpart: ChatProfile;
  readonly auction: AuctionSubject | undefined;
  readonly order: Order | undefined;
  readonly lastMessage: MessageRow | undefined;
  readonly unreadCount: number;
}

/** Nagłówek rozmowy: widok i blokady. */
export interface ConversationDetails extends ConversationView {
  readonly blocks: BlockState;
}

/** Ekran nowej wiadomości: przedmiot, druga strona i istniejąca rozmowa pary. */
export interface StartView {
  readonly conversationId: string | null;
  readonly role: ConversationRole;
  readonly counterpart: ChatProfile;
  readonly auction: AuctionSubject | undefined;
  readonly order: Order | undefined;
  readonly blocker: StartBlocker | null;
  readonly blocks: BlockState;
}

/** Wgląd personelu: rozmowa stron spornego zamówienia (F-28, F-29). */
export interface StaffConversationView {
  readonly conversation: ConversationRow | undefined;
  readonly buyer: ChatProfile;
  readonly seller: ChatProfile;
  readonly messages: readonly MessageRow[];
}

@Injectable()
export class ConversationReader {
  private readonly logger = new Logger(ConversationReader.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AuctionDirectory) private readonly auctions: AuctionDirectory,
    @Inject(OrderService) private readonly orders: OrderService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    private readonly messaging: MessagingService,
    private readonly blocks: BlockService,
  ) {}

  /** Rozmowy strony od ostatniej aktywności; `before` to ID ostatniej z poprzedniej strony. */
  async list(
    userId: string,
    before?: string,
  ): Promise<{ readonly items: ConversationView[]; readonly nextBefore: string | null }> {
    const cursor = before === undefined ? undefined : await this.messaging.byId(before);
    const rows = await this.db
      .select()
      .from(conversations)
      .where(
        and(
          or(eq(conversations.sellerId, userId), eq(conversations.buyerId, userId)),
          cursor === undefined
            ? undefined
            : sql`(${conversations.lastMessageAt}, ${conversations.id}) < (${cursor.lastMessageAt}, ${cursor.id})`,
        ),
      )
      .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
      .limit(CONVERSATIONS_PAGE + 1);
    const page = rows.slice(0, CONVERSATIONS_PAGE);
    return {
      items: await this.views(page, userId),
      nextBefore: rows.length > CONVERSATIONS_PAGE ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /** Nagłówek rozmowy strony (inni: 404). */
  async details(conversationId: string, userId: string): Promise<ConversationDetails> {
    const { conversation, counterpartId } = await this.messaging.forParty(conversationId, userId);
    const [[view], blocks] = await Promise.all([
      this.views([conversation], userId),
      this.blocks.between(userId, counterpartId),
    ]);
    if (view === undefined) {
      throw conversationNotFound();
    }
    return { ...view, blocks };
  }

  /** Ekran nowej wiadomości: czy para ma już rozmowę i czy można ją zacząć. */
  async start(userId: string, subject: ConversationSubject): Promise<StartView> {
    const pair = await this.messaging.resolve(userId, subject);
    const counterpartId = pair.role === 'SELLER' ? pair.buyerId : pair.sellerId;
    const [auctions, orders, profiles, blocks] = await Promise.all([
      this.auctions.subjects([pair.auctionId]),
      this.orders.latestForPairs([{ auctionId: pair.auctionId, buyerId: pair.buyerId }]),
      this.profiles.chatProfiles([counterpartId]),
      counterpartId === userId
        ? Promise.resolve({ byMe: false, byThem: false })
        : this.blocks.between(userId, counterpartId),
    ]);
    return {
      conversationId: pair.existing?.id ?? null,
      role: pair.role,
      counterpart: profiles.get(counterpartId) ?? UNKNOWN_PROFILE(counterpartId),
      auction: auctions.get(pair.auctionId),
      order: orders.get(`${pair.auctionId}:${pair.buyerId}`),
      blocker: pair.existing === undefined ? pair.blocker : null,
      blocks,
    };
  }

  /**
   * Rozmowa stron zamówienia dla personelu: tylko gdy zamówienie ma spór (`disputed_at`),
   * inaczej 404. Bez oznaczania odczytu; wgląd zapisujemy w logu (audit log w F-34).
   */
  async forDisputedOrder(orderRef: string, staffId: string): Promise<StaffConversationView> {
    const found = await this.orders.byReference(orderRef);
    if (found === undefined || found.order.disputedAt === null) {
      throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono zamówienia ze sporem.' });
    }
    const { order, auctionId } = found;
    const conversation = await this.messaging.findPair(auctionId, order.buyerId);
    const [profiles, rows] = await Promise.all([
      this.profiles.chatProfiles([order.buyerId, order.sellerId]),
      conversation === undefined
        ? Promise.resolve([])
        : this.messaging.all(conversation.id, STAFF_MESSAGES_LIMIT),
    ]);
    this.logger.log(
      { staffId, orderId: order.id, conversationId: conversation?.id ?? null },
      'Wgląd personelu w rozmowę spornego zamówienia',
    );
    return {
      conversation,
      buyer: profiles.get(order.buyerId) ?? UNKNOWN_PROFILE(order.buyerId),
      seller: profiles.get(order.sellerId) ?? UNKNOWN_PROFILE(order.sellerId),
      messages: rows,
    };
  }

  /**
   * Czy oglądający może zobaczyć zdjęcie z rozmowy: strona albo personel przy spornym zamówieniu
   * pary, i zdjęcie jest w wiadomości tej rozmowy.
   */
  async canViewPhoto(
    conversationId: string,
    viewer: { readonly id: string; readonly staff: boolean },
    mediaId: string,
  ): Promise<boolean> {
    const conversation = await this.messaging.byId(conversationId);
    if (conversation === undefined) {
      return false;
    }
    const party = conversation.sellerId === viewer.id || conversation.buyerId === viewer.id;
    if (!party) {
      if (!viewer.staff) {
        return false;
      }
      const orders = await this.orders.latestForPairs([
        { auctionId: conversation.auctionId, buyerId: conversation.buyerId },
      ]);
      const order = orders.get(`${conversation.auctionId}:${conversation.buyerId}`);
      if (order?.disputedAt === null || order === undefined) {
        return false;
      }
    }
    return this.messaging.hasPhoto(conversationId, mediaId);
  }

  private async views(
    rows: readonly ConversationRow[],
    userId: string,
  ): Promise<ConversationView[]> {
    if (rows.length === 0) {
      return [];
    }
    const ids = rows.map((row) => row.id);
    const [auctions, orders, profiles, lastMessages, unread] = await Promise.all([
      this.auctions.subjects(rows.map((row) => row.auctionId)),
      this.orders.latestForPairs(
        rows.map((row) => ({ auctionId: row.auctionId, buyerId: row.buyerId })),
      ),
      this.profiles.chatProfiles(
        rows.map((row) => (row.sellerId === userId ? row.buyerId : row.sellerId)),
      ),
      this.db
        .selectDistinctOn([messages.conversationId])
        .from(messages)
        .where(inArray(messages.conversationId, ids))
        .orderBy(messages.conversationId, desc(messages.id)),
      this.db
        .select({ conversationId: messages.conversationId, unread: count() })
        .from(messages)
        .where(
          and(
            inArray(messages.conversationId, ids),
            eq(messages.recipientId, userId),
            isNull(messages.readAt),
          ),
        )
        .groupBy(messages.conversationId),
    ]);
    const last = new Map(lastMessages.map((message) => [message.conversationId, message]));
    const unreadBy = new Map(unread.map((row) => [row.conversationId, row.unread]));
    return rows.map((conversation) => {
      const seller = conversation.sellerId === userId;
      const counterpartId = seller ? conversation.buyerId : conversation.sellerId;
      return {
        conversation,
        role: seller ? 'SELLER' : 'BUYER',
        counterpart: profiles.get(counterpartId) ?? UNKNOWN_PROFILE(counterpartId),
        auction: auctions.get(conversation.auctionId),
        order: orders.get(`${conversation.auctionId}:${conversation.buyerId}`),
        lastMessage: last.get(conversation.id),
        unreadCount: unreadBy.get(conversation.id) ?? 0,
      };
    });
  }
}

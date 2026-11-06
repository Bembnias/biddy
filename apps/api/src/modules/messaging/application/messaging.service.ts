// Wiadomości od strony stron rozmowy (F-29, PROJECT.md §16.2): rozpoczęcie rozmowy o aukcji albo
// zamówieniu z pierwszą wiadomością, kolejne wiadomości, odczyt i zgłoszenie. Każda wysyłka
// sprawdza blokady i limity pod blokadą doradczą nadawcy (liczniki w Postgresie, decyzja nr 140),
// zapisuje flagi danych kontaktowych (decyzja nr 136) i po zatwierdzeniu wysyła `message.new` do
// obu stron. Odczyt wysyła `conversation.read`.
import { detectContactData, MESSAGE_LIMITS, type ReportReason } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, countDistinct, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';

import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { RealtimePublisher } from '../../../infra/realtime/index.js';
import { AuctionDirectory } from '../../auctions/index.js';
import { ProfileService } from '../../identity/index.js';
import { MediaService } from '../../media/index.js';
import { OrderService } from '../../orders/index.js';
import { type ReportedMessage, ReportService } from '../../trust-safety/index.js';
import {
  type ConversationRow,
  conversations,
  type MessageRow,
  messages,
} from '../db/messaging.schema.js';
import {
  auctionStartBlocker,
  type ConversationRole,
  normalizeBody,
  REPORT_CONTEXT_BEFORE,
  REPORT_CONTEXT_USER,
  type StartBlocker,
} from '../domain/conversation-rules.js';
import { BlockService } from './block.service.js';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Przedmiot nowej rozmowy: aukcja albo zamówienie (UUID albo numer). */
export type ConversationSubject = { readonly auctionId: string } | { readonly orderId: string };

export interface MessageInput {
  readonly body: string;
  readonly mediaIds: readonly string[];
}

export interface ReportInput {
  readonly reason: ReportReason;
  readonly messageId?: string;
  readonly details?: string;
  readonly block: boolean;
}

/** Para rozmowy ustalona z przedmiotu i to, czy oglądający może ją zacząć. */
export interface ResolvedPair {
  readonly auctionId: string;
  readonly sellerId: string;
  readonly buyerId: string;
  readonly role: ConversationRole;
  readonly blocker: StartBlocker | null;
  readonly existing: ConversationRow | undefined;
}

/** Rozmowa z rolą oglądającego. */
export interface ConversationParty {
  readonly conversation: ConversationRow;
  readonly role: ConversationRole;
  readonly counterpartId: string;
}

const START_BLOCKER_TEXT: Readonly<Record<StartBlocker, string>> = {
  OWN_AUCTION: 'To Twoja aukcja: nie możesz napisać do siebie.',
  AUCTION_CLOSED:
    'Aukcja się zakończyła, więc nie można już o nią zapytać. Rozmowę z kupującym zaczniesz ze strony zamówienia.',
};

export function conversationNotFound(): DomainError {
  return new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono rozmowy.' });
}

function partyOf(conversation: ConversationRow, userId: string): ConversationParty | undefined {
  if (conversation.sellerId === userId) {
    return { conversation, role: 'SELLER', counterpartId: conversation.buyerId };
  }
  if (conversation.buyerId === userId) {
    return { conversation, role: 'BUYER', counterpartId: conversation.sellerId };
  }
  return undefined;
}

function rateLimited(detail: string, retryAfterSeconds: number): DomainError {
  return new DomainError({
    code: 'RATE_LIMITED',
    detail,
    headers: { 'retry-after': String(retryAfterSeconds) },
  });
}

function reportedMessage(row: MessageRow): ReportedMessage {
  return {
    id: row.id,
    senderId: row.senderId,
    body: row.body,
    mediaIds: row.mediaIds,
    contactFlags: row.contactFlags,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class MessagingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AuctionDirectory) private readonly auctions: AuctionDirectory,
    @Inject(OrderService) private readonly orders: OrderService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(ReportService) private readonly reports: ReportService,
    @Inject(RealtimePublisher) private readonly realtime: RealtimePublisher,
    private readonly blocks: BlockService,
  ) {}

  /** Rozmowa strony; inni (także nieistniejąca rozmowa): 404. */
  async forParty(conversationId: string, userId: string): Promise<ConversationParty> {
    const [conversation] = await this.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    const party = conversation === undefined ? undefined : partyOf(conversation, userId);
    if (party === undefined) {
      throw conversationNotFound();
    }
    return party;
  }

  async byId(conversationId: string): Promise<ConversationRow | undefined> {
    const [conversation] = await this.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    return conversation;
  }

  /** Rozmowa pary (aukcja, druga strona) albo undefined. */
  async findPair(auctionId: string, buyerId: string): Promise<ConversationRow | undefined> {
    const [conversation] = await this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.auctionId, auctionId), eq(conversations.buyerId, buyerId)));
    return conversation;
  }

  /**
   * Para rozmowy z przedmiotu. Zamówienie: tylko jego strony (inaczej 404). Aukcja: publiczna
   * (szkic i aukcja w moderacji: 404), oglądający jest drugą stroną.
   */
  async resolve(userId: string, subject: ConversationSubject): Promise<ResolvedPair> {
    if ('orderId' in subject) {
      const { order, role, snapshot } = await this.orders.forParticipant(subject.orderId, userId);
      const auctionId = snapshot.auction.id;
      return {
        auctionId,
        sellerId: order.sellerId,
        buyerId: order.buyerId,
        role,
        blocker: null,
        existing: await this.findPair(auctionId, order.buyerId),
      };
    }
    const auction = await this.auctions.notice(subject.auctionId);
    if (
      auction === undefined ||
      auction.status === 'DRAFT' ||
      auction.status === 'PENDING_REVIEW'
    ) {
      throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono aukcji.' });
    }
    const orders = await this.orders.latestForPairs([{ auctionId: auction.id, buyerId: userId }]);
    return {
      auctionId: auction.id,
      sellerId: auction.sellerId,
      buyerId: userId,
      role: 'BUYER',
      blocker: auctionStartBlocker({
        userId,
        sellerId: auction.sellerId,
        auctionStatus: auction.status,
        hasOrder: orders.size > 0,
      }),
      existing: userId === auction.sellerId ? undefined : await this.findPair(auction.id, userId),
    };
  }

  /**
   * Pierwsza wiadomość o aukcji albo zamówieniu. Rozmowa pary, która już istnieje, dostaje
   * wiadomość (także po końcu aukcji). Nowej nie da się zacząć o własnej ani zakończonej aukcji
   * bez zamówienia: 409 CONVERSATION_UNAVAILABLE.
   */
  async start(
    userId: string,
    subject: ConversationSubject,
    input: MessageInput,
  ): Promise<{ readonly conversation: ConversationRow; readonly message: MessageRow }> {
    const pair = await this.resolve(userId, subject);
    if (pair.existing === undefined && pair.blocker !== null) {
      throw new DomainError({
        code: 'CONVERSATION_UNAVAILABLE',
        detail: START_BLOCKER_TEXT[pair.blocker],
        extensions: { reason: pair.blocker },
      });
    }
    return this.write(userId, pair, pair.existing, input);
  }

  /** Kolejna wiadomość w rozmowie strony. */
  async send(
    userId: string,
    conversationId: string,
    input: MessageInput,
  ): Promise<{ readonly conversation: ConversationRow; readonly message: MessageRow }> {
    const { conversation, role } = await this.forParty(conversationId, userId);
    return this.write(
      userId,
      {
        auctionId: conversation.auctionId,
        sellerId: conversation.sellerId,
        buyerId: conversation.buyerId,
        role,
        blocker: null,
      },
      conversation,
      input,
    );
  }

  /** Oznacza wiadomości do strony jako przeczytane; zwraca jej liczbę rozmów z nieprzeczytanymi. */
  async markRead(conversationId: string, userId: string): Promise<number> {
    const { counterpartId } = await this.forParty(conversationId, userId);
    const readAt = new Date();
    const updated = await this.db
      .update(messages)
      .set({ readAt })
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.recipientId, userId),
          isNull(messages.readAt),
        ),
      )
      .returning({ id: messages.id });
    const [mine, theirs] = await Promise.all([
      this.unreadConversations(userId),
      updated.length > 0 ? this.unreadConversations(counterpartId) : Promise.resolve(0),
    ]);
    if (updated.length > 0) {
      const event = {
        conversationId,
        readerId: userId,
        readAt: readAt.toISOString(),
        serverTime: new Date().toISOString(),
      };
      this.realtime.publish(
        { userId, event: 'conversation.read', payload: { ...event, unreadCount: mine } },
        {
          userId: counterpartId,
          event: 'conversation.read',
          payload: { ...event, unreadCount: theirs },
        },
      );
    }
    return mine;
  }

  /** Liczba rozmów z nieprzeczytanymi wiadomościami do użytkownika (ikona w nagłówku). */
  async unreadConversations(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ unread: countDistinct(messages.conversationId) })
      .from(messages)
      .where(and(eq(messages.recipientId, userId), isNull(messages.readAt)));
    return row?.unread ?? 0;
  }

  /** Liczba wiadomości użytkownika z danymi kontaktowymi (podstawa reguł antyfraudowych, F-36). */
  async flaggedCount(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ flagged: count() })
      .from(messages)
      .where(and(eq(messages.senderId, userId), sql`${messages.contactFlags} <> '{}'::text[]`));
    return row?.flagged ?? 0;
  }

  /**
   * Zgłoszenie wiadomości drugiej strony (z `messageId`) albo drugiej strony rozmowy, z migawką
   * fragmentu rozmowy. Z `block` zgłaszający od razu blokuje drugą stronę (ta sama transakcja).
   */
  async report(
    conversationId: string,
    userId: string,
    input: ReportInput,
  ): Promise<{ readonly reportId: string; readonly blocked: boolean }> {
    const { conversation, counterpartId } = await this.forParty(conversationId, userId);
    let target: { readonly type: 'MESSAGE' | 'USER'; readonly id: string };
    let snapshot: MessageRow[];
    if (input.messageId === undefined) {
      target = { type: 'USER', id: counterpartId };
      snapshot = await this.db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(desc(messages.id))
        .limit(REPORT_CONTEXT_USER);
    } else {
      const [message] = await this.db
        .select()
        .from(messages)
        .where(and(eq(messages.id, input.messageId), eq(messages.conversationId, conversationId)));
      if (message === undefined) {
        throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono wiadomości.' });
      }
      if (message.senderId === userId) {
        throw new DomainError({
          code: 'VALIDATION_FAILED',
          detail: 'Nie możesz zgłosić własnej wiadomości.',
        });
      }
      target = { type: 'MESSAGE', id: message.id };
      snapshot = await this.db
        .select()
        .from(messages)
        .where(and(eq(messages.conversationId, conversationId), lte(messages.id, message.id)))
        .orderBy(desc(messages.id))
        .limit(REPORT_CONTEXT_BEFORE + 1);
    }
    const reportId = await this.db.transaction(async (tx) => {
      const { report } = await this.reports.create(tx, {
        reporterId: userId,
        targetType: target.type,
        targetId: target.id,
        reason: input.reason,
        details: input.details?.trim() || null,
        context: {
          source: 'CONVERSATION',
          conversationId,
          auctionId: conversation.auctionId,
          reportedUserId: counterpartId,
          messages: snapshot.toReversed().map(reportedMessage),
        },
      });
      if (input.block) {
        await this.blocks.block(userId, counterpartId, tx);
      }
      return report.id;
    });
    return { reportId, blocked: input.block };
  }

  /** Wiadomości rozmowy (najnowsze pierwsze) z kursorem `before` (ID, UUIDv7). */
  async page(
    conversationId: string,
    limit: number,
    before?: string,
  ): Promise<{ readonly items: MessageRow[]; readonly nextBefore: string | null }> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          before === undefined ? undefined : sql`${messages.id} < ${before}`,
        ),
      )
      .orderBy(desc(messages.id))
      .limit(limit + 1);
    const items = rows.slice(0, limit);
    return { items, nextBefore: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
  }

  /** Cała rozmowa od najstarszej wiadomości (wgląd personelu w sporze), najwyżej `limit`. */
  async all(conversationId: string, limit: number): Promise<MessageRow[]> {
    return this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.id))
      .limit(limit);
  }

  /** Czy zdjęcie jest w jakiejś wiadomości tej rozmowy. */
  async hasPhoto(conversationId: string, mediaId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          sql`${messages.mediaIds} @> array[${mediaId}]::uuid[]`,
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  private async write(
    userId: string,
    pair: Omit<ResolvedPair, 'existing'>,
    existing: ConversationRow | undefined,
    input: MessageInput,
  ): Promise<{ readonly conversation: ConversationRow; readonly message: MessageRow }> {
    const body = normalizeBody(input.body);
    if (body.length === 0 && input.mediaIds.length === 0) {
      throw new DomainError({
        code: 'VALIDATION_FAILED',
        detail: 'Napisz wiadomość albo dodaj zdjęcie.',
        errors: [{ path: 'body', code: 'too_small', message: 'Napisz wiadomość.' }],
      });
    }
    const recipientId = userId === pair.sellerId ? pair.buyerId : pair.sellerId;
    const now = new Date();
    const result = await this.db.transaction(async (tx) => {
      // Limity liczone pod blokadą nadawcy: równoległe żądania nie przekroczą progu.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`messages:${userId}`}, 0))`,
      );
      await this.assertWithinLimits(tx, userId, existing === undefined, now);
      const blocks = await this.blocks.between(userId, recipientId, tx);
      if (blocks.byMe || blocks.byThem) {
        throw new DomainError({
          code: 'CONVERSATION_BLOCKED',
          detail: blocks.byMe
            ? 'Zablokowano tę osobę. Odblokuj ją, żeby napisać.'
            : 'Nie możesz pisać w tej rozmowie.',
        });
      }
      const recipient = (await this.profiles.chatProfiles([recipientId], tx)).get(recipientId);
      if (recipient === undefined || recipient.banned) {
        throw new DomainError({
          code: 'CONVERSATION_UNAVAILABLE',
          detail: 'Konto drugiej strony jest niedostępne.',
          extensions: { reason: 'ACCOUNT_UNAVAILABLE' },
        });
      }
      const conversation = existing ?? (await this.createConversation(tx, pair, now));
      await this.media.attach(userId, input.mediaIds, 'MESSAGE_PHOTO', tx);
      const [message] = await tx
        .insert(messages)
        .values({
          conversationId: conversation.id,
          senderId: userId,
          recipientId,
          body,
          mediaIds: [...input.mediaIds],
          contactFlags: detectContactData(body),
          createdAt: now,
        })
        .returning();
      if (message === undefined) {
        throw new Error(`Nie zapisano wiadomości w rozmowie ${conversation.id}`);
      }
      await tx
        .update(conversations)
        .set({ lastMessageAt: now })
        .where(eq(conversations.id, conversation.id));
      return { conversation: { ...conversation, lastMessageAt: now }, message };
    });
    await this.publishMessage(result.message);
    return result;
  }

  private async createConversation(
    tx: Transaction,
    pair: Omit<ResolvedPair, 'existing'>,
    now: Date,
  ): Promise<ConversationRow> {
    const [inserted] = await tx
      .insert(conversations)
      .values({
        auctionId: pair.auctionId,
        sellerId: pair.sellerId,
        buyerId: pair.buyerId,
        lastMessageAt: now,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted !== undefined) {
      return inserted;
    }
    // Równoległa pierwsza wiadomość tej pary utworzyła rozmowę.
    const [concurrent] = await tx
      .select()
      .from(conversations)
      .where(
        and(eq(conversations.auctionId, pair.auctionId), eq(conversations.buyerId, pair.buyerId)),
      );
    if (concurrent === undefined) {
      throw new Error(`Rozmowa aukcji ${pair.auctionId} zniknęła po konflikcie`);
    }
    return concurrent;
  }

  /** Limity nadawcy (decyzja nr 140): 10 na minutę, 200 na dobę, 20 nowych rozmów na dobę. */
  private async assertWithinLimits(
    tx: Transaction,
    userId: string,
    newConversation: boolean,
    now: Date,
  ): Promise<void> {
    const minuteAgo = new Date(now.getTime() - MINUTE_MS);
    const dayAgo = new Date(now.getTime() - DAY_MS);
    const [sent] = await tx
      .select({
        lastMinute: sql<number>`count(*) filter (where ${messages.createdAt} >= ${minuteAgo})::int`,
        lastDay: count(),
      })
      .from(messages)
      .where(and(eq(messages.senderId, userId), gte(messages.createdAt, dayAgo)));
    if ((sent?.lastMinute ?? 0) >= MESSAGE_LIMITS.perMinute) {
      throw rateLimited('Wysyłasz wiadomości za szybko. Spróbuj ponownie za minutę.', 60);
    }
    if ((sent?.lastDay ?? 0) >= MESSAGE_LIMITS.perDay) {
      throw rateLimited(
        `Możesz wysłać najwyżej ${String(MESSAGE_LIMITS.perDay)} wiadomości na dobę. Spróbuj później.`,
        3600,
      );
    }
    if (!newConversation) {
      return;
    }
    const [started] = await tx
      .select({ total: count() })
      .from(conversations)
      .where(and(eq(conversations.buyerId, userId), gte(conversations.createdAt, dayAgo)));
    if ((started?.total ?? 0) >= MESSAGE_LIMITS.newConversationsPerDay) {
      throw rateLimited(
        `Możesz zacząć najwyżej ${String(MESSAGE_LIMITS.newConversationsPerDay)} nowych rozmów na dobę. Spróbuj później.`,
        3600,
      );
    }
  }

  /** `message.new` do obu stron po zatwierdzeniu, z licznikiem każdej z nich. */
  private async publishMessage(message: MessageRow): Promise<void> {
    const [recipientUnread, senderUnread] = await Promise.all([
      this.unreadConversations(message.recipientId),
      this.unreadConversations(message.senderId),
    ]);
    const event = {
      conversationId: message.conversationId,
      messageId: message.id,
      senderId: message.senderId,
      createdAt: message.createdAt.toISOString(),
      serverTime: new Date().toISOString(),
    };
    this.realtime.publish(
      {
        userId: message.recipientId,
        event: 'message.new',
        payload: { ...event, unreadCount: recipientUnread },
      },
      {
        userId: message.senderId,
        event: 'message.new',
        payload: { ...event, unreadCount: senderUnread },
      },
    );
  }
}

// DTO wiadomości (F-29): rozmowy (lista, nagłówek, ekran nowej wiadomości), wiadomości z flagami
// danych kontaktowych i zdjęciami (adresy API: prywatne), blokady, zgłoszenia i wgląd personelu.
import {
  CONTACT_FLAGS,
  MESSAGE_LIMITS,
  REPORT_DETAILS_LIMITS,
  REPORT_REASONS,
} from '@biddy/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { AUCTION_STATUSES, type AuctionSubject } from '../../auctions/index.js';
import type { ChatProfile } from '../../identity/index.js';
import { ORDER_STATUSES, type Order } from '../../orders/index.js';
import type { BlockedUser } from '../application/block.service.js';
import type {
  ConversationDetails,
  ConversationView,
  StaffConversationView,
  StartView,
} from '../application/conversation-reader.js';
import type { MessageRow } from '../db/messaging.schema.js';
import { messagePreview } from '../domain/conversation-rules.js';

const timestamp = z.iso.datetime();
const role = z.enum(['BUYER', 'SELLER']);

const body = z
  .string()
  .max(MESSAGE_LIMITS.bodyMax, `Wiadomość: najwyżej ${String(MESSAGE_LIMITS.bodyMax)} znaków.`)
  .describe('Treść (przycięta); może być pusta, gdy wiadomość ma zdjęcie');

const mediaIds = z
  .array(z.uuid())
  .max(MESSAGE_LIMITS.photos, `Najwyżej ${String(MESSAGE_LIMITS.photos)} zdjęć.`)
  .default([])
  .describe('Zdjęcia MESSAGE_PHOTO (przetworzone, własne)');

function requireContent(
  value: { readonly body: string; readonly mediaIds: readonly string[] },
  context: z.RefinementCtx,
): void {
  if (value.body.trim().length === 0 && value.mediaIds.length === 0) {
    context.addIssue({ code: 'custom', path: ['body'], message: 'Napisz wiadomość.' });
  }
}

const counterpartSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    avatarUrl: z.url().nullable(),
    available: z.boolean().describe('false: konto zablokowane przez Biddy albo usunięte'),
  })
  .describe('Druga strona rozmowy');

const auctionSchema = z
  .object({
    id: z.uuid(),
    publicId: z.string(),
    slug: z.string(),
    title: z.string(),
    coverUrl: z.url().nullable().describe('Miniatura zdjęcia głównego (320 px)'),
    status: z.enum(AUCTION_STATUSES),
  })
  .nullable()
  .describe('Aukcja, o którą toczy się rozmowa');

const orderSchema = z
  .object({ id: z.uuid(), publicId: z.string(), status: z.enum(ORDER_STATUSES) })
  .nullable()
  .describe('Najnowsze zamówienie pary (null przed sprzedażą albo bez zamówienia)');

const lastMessageSchema = z
  .object({
    preview: z.string().describe('Początek treści w jednej linii (do 120 znaków)'),
    senderRole: role,
    hasPhotos: z.boolean(),
    createdAt: timestamp,
  })
  .nullable();

const conversationSummarySchema = z.object({
  id: z.uuid(),
  role: role.describe('Rola oglądającego: SELLER = sprzedający aukcji'),
  counterpart: counterpartSchema,
  auction: auctionSchema,
  order: orderSchema,
  lastMessage: lastMessageSchema,
  unreadCount: z.int().nonnegative().describe('Nieprzeczytane wiadomości do oglądającego'),
  lastMessageAt: timestamp,
});

export class ConversationSummaryDto extends createZodDto(conversationSummarySchema) {}

export class ConversationListDto extends createZodDto(
  z.object({
    items: z.array(conversationSummarySchema),
    nextBefore: z.uuid().nullable().describe('Kursor następnej strony (parametr `before`)'),
  }),
) {}

export class ConversationDto extends createZodDto(
  conversationSummarySchema.extend({
    canSend: z.boolean().describe('false przy blokadzie albo niedostępnym koncie'),
    blockedByMe: z.boolean().describe('Oglądający zablokował drugą stronę'),
  }),
) {}

export class ConversationStartDto extends createZodDto(
  z.object({
    conversationId: z.uuid().nullable().describe('Istniejąca rozmowa pary: przekieruj do niej'),
    role,
    counterpart: counterpartSchema,
    auction: auctionSchema,
    order: orderSchema,
    unavailableReason: z
      .enum(['OWN_AUCTION', 'AUCTION_CLOSED', 'ACCOUNT_UNAVAILABLE'])
      .nullable()
      .describe('Dlaczego nie można zacząć rozmowy'),
    canSend: z.boolean(),
    blockedByMe: z.boolean(),
  }),
) {}

const photoSchema = z.object({ id: z.uuid(), thumbUrl: z.url(), largeUrl: z.url() });

const messageSchema = z.object({
  id: z.uuid(),
  senderRole: role,
  body: z.string(),
  photos: z.array(photoSchema).describe('Zdjęcia z API (prywatne, sesja)'),
  contactFlags: z
    .array(z.enum(CONTACT_FLAGS))
    .describe('Wykryte dane kontaktowe: obie strony widzą ostrzeżenie'),
  createdAt: timestamp,
  readAt: timestamp.nullable().describe('Odczyt przez odbiorcę'),
});

export class MessageDto extends createZodDto(messageSchema) {}

export class MessagePageDto extends createZodDto(
  z.object({
    items: z.array(messageSchema).describe('Najnowsze pierwsze'),
    nextBefore: z.uuid().nullable().describe('Kursor starszych wiadomości (parametr `before`)'),
  }),
) {}

export class ConversationSummaryCountDto extends createZodDto(
  z.object({
    unreadCount: z.int().nonnegative().describe('Rozmowy z nieprzeczytanymi wiadomościami'),
  }),
) {}

export class StartConversationBody extends createZodDto(
  z
    .object({
      auctionId: z.uuid().optional().describe('Pytanie o aukcję'),
      orderId: z.string().min(1).max(64).optional().describe('Zamówienie: UUID albo numer'),
      body,
      mediaIds,
    })
    .strict()
    .superRefine((value, context) => {
      if ((value.auctionId === undefined) === (value.orderId === undefined)) {
        context.addIssue({
          code: 'custom',
          path: ['auctionId'],
          message: 'Podaj aukcję albo zamówienie.',
        });
      }
      requireContent(value, context);
    }),
) {}

export class SendMessageBody extends createZodDto(
  z.object({ body, mediaIds }).strict().superRefine(requireContent),
) {}

export class ReportBody extends createZodDto(
  z
    .object({
      reason: z.enum(REPORT_REASONS),
      messageId: z.uuid().optional().describe('Zgłaszana wiadomość drugiej strony; bez niej osoba'),
      details: z
        .string()
        .trim()
        .max(
          REPORT_DETAILS_LIMITS.max,
          `Opis: najwyżej ${String(REPORT_DETAILS_LIMITS.max)} znaków.`,
        )
        .optional(),
      block: z.boolean().default(false).describe('Od razu zablokuj drugą stronę'),
    })
    .strict()
    .superRefine((value, context) => {
      if (
        value.reason === 'OTHER' &&
        (value.details?.length ?? 0) < REPORT_DETAILS_LIMITS.minForOther
      ) {
        context.addIssue({
          code: 'custom',
          path: ['details'],
          message: `Opisz problem: co najmniej ${String(REPORT_DETAILS_LIMITS.minForOther)} znaków.`,
        });
      }
    }),
) {}

export class ReportResultDto extends createZodDto(
  z.object({ id: z.uuid(), blocked: z.boolean() }),
) {}

const blockedUserSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  avatarUrl: z.url().nullable(),
  blockedAt: timestamp,
});

export class BlockedUserListDto extends createZodDto(
  z.object({ items: z.array(blockedUserSchema) }),
) {}

const staffPartySchema = z.object({ id: z.uuid(), name: z.string() });

export class AdminConversationDto extends createZodDto(
  z.object({
    conversationId: z.uuid().nullable().describe('null: strony nie pisały do siebie'),
    buyer: staffPartySchema,
    seller: staffPartySchema,
    messages: z.array(messageSchema).describe('Najstarsze pierwsze (do 500)'),
  }),
) {}

/** Adresy API zdjęć z rozmowy (`apiUrl` bez /v1). */
function photoUrls(apiUrl: string, conversationId: string, mediaId: string) {
  const base = `${apiUrl}/v1/conversations/${conversationId}/photos/${mediaId}`;
  return { id: mediaId, thumbUrl: `${base}/thumb`, largeUrl: `${base}/large` };
}

function counterpartDto(profile: ChatProfile): z.infer<typeof counterpartSchema> {
  return {
    id: profile.id,
    name: profile.name,
    avatarUrl: profile.avatarUrl,
    available: !profile.banned,
  };
}

function auctionDto(auction: AuctionSubject | undefined): z.infer<typeof auctionSchema> {
  return auction === undefined
    ? null
    : {
        id: auction.id,
        publicId: auction.publicId,
        slug: auction.slug,
        title: auction.title,
        coverUrl: auction.coverUrl,
        status: auction.status,
      };
}

function orderDto(order: Order | undefined): z.infer<typeof orderSchema> {
  return order === undefined
    ? null
    : { id: order.id, publicId: order.publicId, status: order.status };
}

function senderRole(
  conversation: { readonly sellerId: string },
  message: MessageRow,
): 'BUYER' | 'SELLER' {
  return message.senderId === conversation.sellerId ? 'SELLER' : 'BUYER';
}

export function conversationSummaryDto(view: ConversationView): ConversationSummaryDto {
  const { conversation, lastMessage } = view;
  return {
    id: conversation.id,
    role: view.role,
    counterpart: counterpartDto(view.counterpart),
    auction: auctionDto(view.auction),
    order: orderDto(view.order),
    lastMessage:
      lastMessage === undefined
        ? null
        : {
            preview: messagePreview(lastMessage.body),
            senderRole: senderRole(conversation, lastMessage),
            hasPhotos: lastMessage.mediaIds.length > 0,
            createdAt: lastMessage.createdAt.toISOString(),
          },
    unreadCount: view.unreadCount,
    lastMessageAt: conversation.lastMessageAt.toISOString(),
  };
}

export function conversationDto(details: ConversationDetails): ConversationDto {
  const blocked = details.blocks.byMe || details.blocks.byThem;
  return {
    ...conversationSummaryDto(details),
    canSend: !blocked && !details.counterpart.banned,
    blockedByMe: details.blocks.byMe,
  };
}

export function conversationStartDto(view: StartView): ConversationStartDto {
  const unavailableReason =
    view.blocker ?? (view.counterpart.banned ? 'ACCOUNT_UNAVAILABLE' : null);
  return {
    conversationId: view.conversationId,
    role: view.role,
    counterpart: counterpartDto(view.counterpart),
    auction: auctionDto(view.auction),
    order: orderDto(view.order),
    unavailableReason,
    canSend: unavailableReason === null && !view.blocks.byMe && !view.blocks.byThem,
    blockedByMe: view.blocks.byMe,
  };
}

export function messageDto(
  conversation: { readonly id: string; readonly sellerId: string },
  message: MessageRow,
  apiUrl: string,
): MessageDto {
  return {
    id: message.id,
    senderRole: senderRole(conversation, message),
    body: message.body,
    photos: message.mediaIds.map((mediaId) => photoUrls(apiUrl, conversation.id, mediaId)),
    contactFlags: message.contactFlags,
    createdAt: message.createdAt.toISOString(),
    readAt: message.readAt?.toISOString() ?? null,
  };
}

export function blockedUserListDto(items: readonly BlockedUser[]): BlockedUserListDto {
  return {
    items: items.map((item) => ({
      userId: item.userId,
      name: item.name,
      avatarUrl: item.avatarUrl,
      blockedAt: item.blockedAt.toISOString(),
    })),
  };
}

export function adminConversationDto(
  view: StaffConversationView,
  apiUrl: string,
): AdminConversationDto {
  const { conversation } = view;
  return {
    conversationId: conversation?.id ?? null,
    buyer: { id: view.buyer.id, name: view.buyer.name },
    seller: { id: view.seller.id, name: view.seller.name },
    messages:
      conversation === undefined
        ? []
        : view.messages.map((message) => messageDto(conversation, message, apiUrl)),
  };
}

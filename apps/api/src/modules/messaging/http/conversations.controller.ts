// Trasy rozmów dla stron (F-29): lista, licznik, ekran nowej wiadomości, rozpoczęcie rozmowy,
// wiadomości, odczyt, zgłoszenie i zdjęcia (prywatne). Pisanie wymaga potwierdzonego e-maila
// i akceptacji regulaminu (§4). Obca rozmowa: 404.
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { APP_CONFIG, type AppConfig } from '../../../infra/config/index.js';
import { DomainError } from '../../../infra/http/index.js';
import {
  type AuthenticatedUser,
  CurrentUser,
  RequireAcceptedTerms,
  RequireSession,
} from '../../identity/index.js';
import { MediaService } from '../../media/index.js';
import { ConversationReader, MESSAGES_PAGE } from '../application/conversation-reader.js';
import { type ConversationSubject, MessagingService } from '../application/messaging.service.js';
import {
  ConversationDto,
  ConversationListDto,
  ConversationStartDto,
  ConversationSummaryCountDto,
  conversationDto,
  conversationStartDto,
  conversationSummaryDto,
  MessageDto,
  MessagePageDto,
  messageDto,
  ReportBody,
  ReportResultDto,
  SendMessageBody,
  StartConversationBody,
} from './messaging-dto.js';

class ConversationParams extends createZodDto(z.object({ id: z.uuid() })) {}

class PhotoParams extends createZodDto(
  z.object({ id: z.uuid(), mediaId: z.uuid(), variant: z.enum(['thumb', 'large']) }),
) {}

class PageQuery extends createZodDto(
  z.object({ before: z.uuid().optional().describe('ID ostatniego elementu poprzedniej strony') }),
) {}

class StartQuery extends createZodDto(
  z
    .object({
      auctionId: z.uuid().optional(),
      orderId: z.string().min(1).max(64).optional().describe('UUID albo numer zamówienia'),
    })
    .refine((query) => (query.auctionId === undefined) !== (query.orderId === undefined), {
      message: 'Podaj aukcję albo zamówienie.',
      path: ['auctionId'],
    }),
) {}

function subjectOf(input: {
  readonly auctionId?: string | undefined;
  readonly orderId?: string | undefined;
}): ConversationSubject {
  return input.orderId === undefined
    ? { auctionId: input.auctionId ?? '' }
    : { orderId: input.orderId };
}

@ApiTags('messaging')
@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly messaging: MessagingService,
    private readonly reader: ConversationReader,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  @RequireSession()
  @Header('cache-control', 'private, no-store')
  @ApiOperation({ summary: 'Rozmowy (ostatnia aktywność pierwsza, po 30)' })
  @ZodResponse({ status: 200, description: 'Rozmowy', type: ConversationListDto })
  async listConversations(
    @Query() query: PageQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ConversationListDto> {
    const page = await this.reader.list(user.id, query.before);
    return { items: page.items.map(conversationSummaryDto), nextBefore: page.nextBefore };
  }

  @Get('summary')
  @RequireSession()
  @Header('cache-control', 'private, no-store')
  @ApiOperation({ summary: 'Liczba rozmów z nieprzeczytanymi wiadomościami (nagłówek)' })
  @ZodResponse({ status: 200, description: 'Licznik', type: ConversationSummaryCountDto })
  async getConversationSummary(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ConversationSummaryCountDto> {
    return { unreadCount: await this.messaging.unreadConversations(user.id) };
  }

  @Get('start')
  @RequireSession()
  @Header('cache-control', 'private, no-store')
  @ApiOperation({
    summary: 'Ekran nowej wiadomości',
    description:
      'Przedmiot rozmowy, druga strona, istniejąca rozmowa pary (przekierowanie) i powód, gdy nie można zacząć. Obce zamówienie albo niepubliczna aukcja: 404.',
  })
  @ZodResponse({ status: 200, description: 'Nowa rozmowa', type: ConversationStartDto })
  async getConversationStart(
    @Query() query: StartQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ConversationStartDto> {
    return conversationStartDto(await this.reader.start(user.id, subjectOf(query)));
  }

  @Post()
  @RequireAcceptedTerms()
  @Header('cache-control', 'private, no-store')
  @ApiOperation({
    summary: 'Pierwsza wiadomość o aukcji albo zamówieniu',
    description:
      'Rozmowa pary, która już istnieje, dostaje wiadomość. Zakończona aukcja bez zamówienia albo własna: 409 CONVERSATION_UNAVAILABLE; blokada: 403 CONVERSATION_BLOCKED; limity: 429.',
  })
  @ZodResponse({ status: 201, description: 'Rozmowa', type: ConversationDto })
  async startConversation(
    @Body() body: StartConversationBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ConversationDto> {
    const { conversation } = await this.messaging.start(user.id, subjectOf(body), body);
    return conversationDto(await this.reader.details(conversation.id, user.id));
  }

  @Get(':id')
  @RequireSession()
  @Header('cache-control', 'private, no-store')
  @ApiOperation({ summary: 'Nagłówek rozmowy (strony)' })
  @ZodResponse({ status: 200, description: 'Rozmowa', type: ConversationDto })
  async getConversation(
    @Param() params: ConversationParams,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ConversationDto> {
    return conversationDto(await this.reader.details(params.id, user.id));
  }

  @Get(':id/messages')
  @RequireSession()
  @Header('cache-control', 'private, no-store')
  @ApiOperation({ summary: 'Wiadomości rozmowy (najnowsze pierwsze, po 50)' })
  @ZodResponse({ status: 200, description: 'Wiadomości', type: MessagePageDto })
  async listConversationMessages(
    @Param() params: ConversationParams,
    @Query() query: PageQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MessagePageDto> {
    const { conversation } = await this.messaging.forParty(params.id, user.id);
    const page = await this.messaging.page(conversation.id, MESSAGES_PAGE, query.before);
    return {
      items: page.items.map((message) =>
        messageDto(conversation, message, this.config.auth.apiUrl),
      ),
      nextBefore: page.nextBefore,
    };
  }

  @Post(':id/messages')
  @RequireAcceptedTerms()
  @Header('cache-control', 'private, no-store')
  @ApiOperation({
    summary: 'Wiadomość w rozmowie',
    description: 'Blokada: 403 CONVERSATION_BLOCKED; limity: 429 RATE_LIMITED z Retry-After.',
  })
  @ZodResponse({ status: 201, description: 'Wiadomość', type: MessageDto })
  async sendMessage(
    @Param() params: ConversationParams,
    @Body() body: SendMessageBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MessageDto> {
    const { conversation, message } = await this.messaging.send(user.id, params.id, body);
    return messageDto(conversation, message, this.config.auth.apiUrl);
  }

  @Post(':id/read')
  @RequireSession()
  @HttpCode(200)
  @Header('cache-control', 'private, no-store')
  @ApiOperation({ summary: 'Odczyt wiadomości do mnie w rozmowie' })
  @ZodResponse({
    status: 200,
    description: 'Licznik po odczycie',
    type: ConversationSummaryCountDto,
  })
  async markConversationRead(
    @Param() params: ConversationParams,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ConversationSummaryCountDto> {
    return { unreadCount: await this.messaging.markRead(params.id, user.id) };
  }

  @Post(':id/report')
  @RequireAcceptedTerms()
  @Header('cache-control', 'private, no-store')
  @ApiOperation({
    summary: 'Zgłoszenie wiadomości albo drugiej strony',
    description:
      'Z migawką fragmentu rozmowy dla zespołu Biddy; z `block` od razu blokuje drugą stronę. Ponowienie zwraca istniejące zgłoszenie.',
  })
  @ZodResponse({ status: 201, description: 'Zgłoszenie', type: ReportResultDto })
  async reportConversation(
    @Param() params: ConversationParams,
    @Body() body: ReportBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReportResultDto> {
    const { reportId, blocked } = await this.messaging.report(params.id, user.id, body);
    return { id: reportId, blocked };
  }

  @Get(':id/photos/:mediaId/:variant')
  @RequireSession()
  @Header('cache-control', 'private, max-age=3600')
  @ApiProduces('image/webp')
  @ApiOperation({ summary: 'Zdjęcie z rozmowy (strony; personel przy spornym zamówieniu)' })
  @ApiOkResponse({ description: 'Zdjęcie WebP', schema: { type: 'string', format: 'binary' } })
  async getConversationPhoto(
    @Param() params: PhotoParams,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StreamableFile> {
    const allowed = await this.reader.canViewPhoto(
      params.id,
      { id: user.id, staff: user.staffRole !== null },
      params.mediaId,
    );
    const photo = allowed
      ? await this.media.privateVariant(params.mediaId, params.variant)
      : undefined;
    if (photo === undefined) {
      throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono zdjęcia.' });
    }
    return new StreamableFile(photo.data, { type: photo.contentType });
  }
}

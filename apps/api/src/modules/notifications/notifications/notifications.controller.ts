import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES } from '@biddy/shared';
import { Body, Controller, Get, Header, HttpCode, Inject, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { APP_CONFIG, type AppConfig } from '../../../infra/config/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { type AuthenticatedUser, CurrentUser, RequireSession } from '../../identity/index.js';
import { type NotificationView, NotificationService } from './notification.service.js';
import { type PreferenceEntry, PreferenceService } from './preference.service.js';
import { verifyUnsubscribeToken } from './unsubscribe-token.js';

const notificationSchema = z.object({
  id: z.uuid(),
  type: z.enum(NOTIFICATION_TYPES),
  title: z.string().min(1),
  body: z.string(),
  url: z.string().min(1).describe('Ścieżka w web, np. /a/wazon-k3x9qa7m'),
  read: z.boolean(),
  createdAt: z.iso.datetime(),
});

export class NotificationListDto extends createZodDto(
  z.object({
    items: z.array(notificationSchema),
    unreadCount: z.int().min(0),
    nextBefore: z.uuid().nullable().describe('Kursor kolejnej strony (parametr before) albo null'),
  }),
) {}

export class NotificationSummaryDto extends createZodDto(
  z.object({ unreadCount: z.int().min(0) }),
) {}

class ListQuery extends createZodDto(
  z.object({ before: z.uuid().optional().describe('Powiadomienia starsze niż to ID') }),
) {}

export class MarkReadDto extends createZodDto(
  z
    .object({
      ids: z.array(z.uuid()).min(1).max(100).optional(),
      all: z.literal(true).optional(),
    })
    .strict()
    .refine((body) => (body.ids === undefined) !== (body.all === undefined), {
      message: 'Podaj ids albo all: true.',
    }),
) {}

const preferenceSchema = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  channel: z.enum(NOTIFICATION_CHANNELS),
  enabled: z.boolean(),
});

export class NotificationPreferencesDto extends createZodDto(
  z.object({
    items: z.array(
      preferenceSchema.extend({
        configurable: z.boolean().describe('Czy użytkownik może to zmienić'),
      }),
    ),
  }),
) {}

export class UpdatePreferencesDto extends createZodDto(
  z.object({ items: z.array(preferenceSchema).min(1).max(30) }).strict(),
) {}

const tokenField = z.string().min(10).max(300).describe('Token z linku w e-mailu');

class UnsubscribeQuery extends createZodDto(z.object({ token: tokenField })) {}

export class UnsubscribeDto extends createZodDto(z.object({ token: tokenField }).strict()) {}

export class UnsubscribeResultDto extends createZodDto(
  z.object({
    scope: z.enum([...NOTIFICATION_TYPES, 'ALL']).describe('Typ powiadomień albo ALL (wszystkie)'),
    types: z.array(z.enum(NOTIFICATION_TYPES)).describe('Typy e-maili, które wyłączamy'),
  }),
) {}

function notificationDto(view: NotificationView): z.infer<typeof notificationSchema> {
  return {
    id: view.id,
    type: view.type,
    title: view.title,
    body: view.body,
    url: view.path,
    read: view.read,
    createdAt: view.createdAt.toISOString(),
  };
}

function preferencesDto(entries: readonly PreferenceEntry[]): NotificationPreferencesDto {
  return { items: entries.map((entry) => ({ ...entry })) };
}

/** Centrum powiadomień i preferencje zalogowanego użytkownika (F-20). */
@ApiTags('me')
@Controller('me')
@RequireSession()
export class MyNotificationsController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly preferences: PreferenceService,
  ) {}

  @Get('notifications')
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Moje powiadomienia', description: 'Od najnowszych, po 30.' })
  @ZodResponse({ status: 200, description: 'Powiadomienia', type: NotificationListDto })
  async getMyNotifications(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListQuery,
  ): Promise<NotificationListDto> {
    const [page, unreadCount] = await Promise.all([
      this.notifications.list(user.id, query.before),
      this.notifications.unreadCount(user.id),
    ]);
    return { items: page.items.map(notificationDto), unreadCount, nextBefore: page.nextBefore };
  }

  @Get('notifications/summary')
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Liczba nieprzeczytanych powiadomień' })
  @ZodResponse({ status: 200, description: 'Podsumowanie', type: NotificationSummaryDto })
  async getNotificationSummary(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationSummaryDto> {
    return { unreadCount: await this.notifications.unreadCount(user.id) };
  }

  @Post('notifications/read')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: 'Oznacz powiadomienia jako przeczytane',
    description: '{ ids } albo { all: true }.',
  })
  @ZodResponse({
    status: 200,
    description: 'Liczba nieprzeczytanych',
    type: NotificationSummaryDto,
  })
  async markNotificationsRead(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: MarkReadDto,
  ): Promise<NotificationSummaryDto> {
    return {
      unreadCount: await this.notifications.markRead(
        user.id,
        body.all === true ? 'all' : (body.ids ?? []),
      ),
    };
  }

  @Get('notification-preferences')
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Preferencje powiadomień' })
  @ZodResponse({ status: 200, description: 'Preferencje', type: NotificationPreferencesDto })
  async getNotificationPreferences(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationPreferencesDto> {
    return preferencesDto(await this.preferences.list(user.id));
  }

  @Put('notification-preferences')
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: 'Zmiana preferencji powiadomień',
    description: 'W MVP kanał EMAIL typów konfigurowalnych; pozostałe: 400.',
  })
  @ZodResponse({ status: 200, description: 'Preferencje', type: NotificationPreferencesDto })
  async updateNotificationPreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdatePreferencesDto,
  ): Promise<NotificationPreferencesDto> {
    return preferencesDto(await this.preferences.update(user.id, body.items));
  }
}

/** Wypisanie z e-maili linkiem z e-maila, bez logowania (F-20, RFC 8058 przez web). */
@ApiTags('notifications')
@Controller('notifications/unsubscribe')
export class UnsubscribeController {
  constructor(
    private readonly preferences: PreferenceService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Co wyłączy link wypisania' })
  @ZodResponse({ status: 200, description: 'Zakres', type: UnsubscribeResultDto })
  getUnsubscribe(@Query() query: UnsubscribeQuery): UnsubscribeResultDto {
    return this.preview(query.token);
  }

  @Post()
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Wypisanie z e-maili', description: 'Typ z tokenu albo wszystkie.' })
  @ZodResponse({ status: 200, description: 'Wypisano', type: UnsubscribeResultDto })
  async unsubscribe(@Body() body: UnsubscribeDto): Promise<UnsubscribeResultDto> {
    const verified = this.verify(body.token);
    const types = await this.preferences.unsubscribe(verified.userId, verified.scope);
    return { scope: verified.scope, types };
  }

  private preview(token: string): UnsubscribeResultDto {
    const { scope } = this.verify(token);
    return {
      scope,
      types: scope === 'ALL' ? [...NOTIFICATION_TYPES] : [scope],
    };
  }

  private verify(token: string) {
    const verified = verifyUnsubscribeToken(this.config.auth.secret, token);
    if (verified === null) {
      throw new DomainError({
        code: 'VALIDATION_FAILED',
        detail: 'Link wypisania jest nieprawidłowy.',
        errors: [{ path: 'token', code: 'custom', message: 'Nieprawidłowy token.' }],
      });
    }
    return verified;
  }
}

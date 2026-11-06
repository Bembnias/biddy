// Wgląd personelu w rozmowę stron zamówienia (F-29, PROJECT.md §7.5: moderator widzi czat przy
// sporze). Tylko zamówienie ze sporem; wgląd trafia do logu (audit log w F-34). Do panelu admina
// rola personelu pochodzi ze zwykłej sesji konta, jak przy sporach.
import { Controller, Get, Header, Inject, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { APP_CONFIG, type AppConfig } from '../../../infra/config/index.js';
import { type AuthenticatedUser, CurrentUser, RequireStaff } from '../../identity/index.js';
import { ConversationReader } from '../application/conversation-reader.js';
import { AdminConversationDto, adminConversationDto } from './messaging-dto.js';

class OrderParams extends createZodDto(
  z.object({ id: z.string().min(1).max(64).describe('UUID albo numer zamówienia') }),
) {}

@ApiTags('admin')
@Controller('admin/orders')
@RequireStaff('support', 'moderator', 'admin')
export class AdminMessagesController {
  constructor(
    private readonly reader: ConversationReader,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get(':id/messages')
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: 'Rozmowa stron spornego zamówienia',
    description: 'Tylko zamówienie ze sporem (inaczej 404). Bez oznaczania odczytu.',
  })
  @ZodResponse({ status: 200, description: 'Rozmowa', type: AdminConversationDto })
  async getDisputedOrderMessages(
    @Param() params: OrderParams,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AdminConversationDto> {
    return adminConversationDto(
      await this.reader.forDisputedOrder(params.id, user.id),
      this.config.auth.apiUrl,
    );
  }
}

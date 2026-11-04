// Blokady (F-29, decyzja nr 137): lista zablokowanych, blokada i odblokowanie. Blokada wyłącza
// pisanie w rozmowach obu stron; zamówienia, spory i licytowanie działają dalej.
import { Controller, Delete, Get, Header, HttpCode, Param, Put } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  type AuthenticatedUser,
  CurrentUser,
  RequireAcceptedTerms,
  RequireSession,
} from '../../identity/index.js';
import { BlockService } from '../application/block.service.js';
import { BlockedUserListDto, blockedUserListDto } from './messaging-dto.js';

class UserParams extends createZodDto(z.object({ userId: z.uuid() })) {}

@ApiTags('messaging')
@Controller('me/blocks')
export class BlocksController {
  constructor(private readonly blocks: BlockService) {}

  @Get()
  @RequireSession()
  @Header('cache-control', 'private, no-store')
  @ApiOperation({ summary: 'Zablokowani użytkownicy (od najnowszej blokady)' })
  @ZodResponse({ status: 200, description: 'Zablokowani', type: BlockedUserListDto })
  async listBlockedUsers(@CurrentUser() user: AuthenticatedUser): Promise<BlockedUserListDto> {
    return blockedUserListDto(await this.blocks.list(user.id));
  }

  @Put(':userId')
  @RequireAcceptedTerms()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Zablokuj użytkownika',
    description: 'Idempotentne. Żadna strona nie napisze w waszych rozmowach. Siebie: 400.',
  })
  @ApiNoContentResponse({ description: 'Zablokowano' })
  async blockUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: UserParams,
  ): Promise<void> {
    await this.blocks.block(user.id, params.userId);
  }

  @Delete(':userId')
  @RequireSession()
  @HttpCode(204)
  @ApiOperation({ summary: 'Odblokuj użytkownika' })
  @ApiNoContentResponse({ description: 'Odblokowano' })
  async unblockUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: UserParams,
  ): Promise<void> {
    await this.blocks.unblock(user.id, params.userId);
  }
}

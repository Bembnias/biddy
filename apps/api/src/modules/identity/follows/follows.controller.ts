import { Controller, Delete, Get, Header, HttpCode, Param, Put } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import type { AuthenticatedUser } from '../session/session.js';
import { CurrentUser, RequireSession } from '../session/session.guard.js';
import { FollowService } from './follow.service.js';

class SellerParams extends createZodDto(z.object({ userId: z.uuid() })) {}

export class FollowStateDto extends createZodDto(
  z.object({ following: z.boolean().describe('Czy obserwujesz sprzedawcę') }),
) {}

/** Obserwowani sprzedawcy (F-20). */
@ApiTags('me')
@Controller('me/followed-sellers')
@RequireSession()
export class FollowsController {
  constructor(private readonly follows: FollowService) {}

  @Get(':userId')
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Czy obserwujesz sprzedawcę' })
  @ZodResponse({ status: 200, description: 'Stan obserwowania', type: FollowStateDto })
  async getFollowState(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: SellerParams,
  ): Promise<FollowStateDto> {
    return { following: await this.follows.isFollowing(user.id, params.userId) };
  }

  @Put(':userId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Obserwuj sprzedawcę', description: 'Idempotentne; siebie: 400.' })
  @ApiNoContentResponse({ description: 'Obserwujesz' })
  async followSeller(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: SellerParams,
  ): Promise<void> {
    await this.follows.follow(user.id, params.userId);
  }

  @Delete(':userId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Przestań obserwować sprzedawcę' })
  @ApiNoContentResponse({ description: 'Nie obserwujesz' })
  async unfollowSeller(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: SellerParams,
  ): Promise<void> {
    await this.follows.unfollow(user.id, params.userId);
  }
}

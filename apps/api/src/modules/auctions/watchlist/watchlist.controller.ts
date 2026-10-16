import { Controller, Delete, HttpCode, Param, Put } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { type AuthenticatedUser, CurrentUser, RequireSession } from '../../identity/index.js';
import { WatchlistService } from './watchlist.service.js';

class AuctionParams extends createZodDto(z.object({ auctionId: z.uuid() })) {}

/** Obserwowane aukcje (F-20); stan obserwowania w GET /v1/me/bids/{id} (`watching`). */
@ApiTags('me')
@Controller('me/watchlist')
@RequireSession()
export class WatchlistController {
  constructor(private readonly watchlist: WatchlistService) {}

  @Put(':auctionId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Obserwuj aukcję',
    description: 'Tylko aktywna aukcja innego sprzedawcy; idempotentne.',
  })
  @ApiNoContentResponse({ description: 'Obserwujesz' })
  async watchAuction(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: AuctionParams,
  ): Promise<void> {
    await this.watchlist.watch(user.id, params.auctionId);
  }

  @Delete(':auctionId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Przestań obserwować aukcję' })
  @ApiNoContentResponse({ description: 'Nie obserwujesz' })
  async unwatchAuction(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: AuctionParams,
  ): Promise<void> {
    await this.watchlist.unwatch(user.id, params.auctionId);
  }
}

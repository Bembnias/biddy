import { Controller, Delete, Get, Header, HttpCode, Param, Put } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { type AuthenticatedUser, CurrentUser, RequireSession } from '../../identity/index.js';
import { auctionCardDto, auctionCardSchema } from '../public/card-dto.js';
import { MyListsService } from '../public/my-lists.service.js';
import { WatchlistService } from './watchlist.service.js';

class AuctionParams extends createZodDto(z.object({ auctionId: z.uuid() })) {}

export class MyWatchlistDto extends createZodDto(
  z.object({ items: z.array(auctionCardSchema).describe('Aktywne najpierw, potem zakończone') }),
) {}

/** Obserwowane aukcje (F-20); stan obserwowania w GET /v1/me/bids/{id} (`watching`). */
@ApiTags('me')
@Controller('me/watchlist')
@RequireSession()
export class WatchlistController {
  constructor(
    private readonly watchlist: WatchlistService,
    private readonly lists: MyListsService,
  ) {}

  @Get()
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Obserwowane aukcje (Moje Biddy)', description: 'Najwyżej 100.' })
  @ZodResponse({ status: 200, description: 'Obserwowane', type: MyWatchlistDto })
  async getMyWatchlist(@CurrentUser() user: AuthenticatedUser): Promise<MyWatchlistDto> {
    return { items: (await this.lists.watchlist(user.id)).map(auctionCardDto) };
  }

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

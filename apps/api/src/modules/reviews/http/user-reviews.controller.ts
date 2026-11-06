// Publiczna reputacja konta (F-30): średnia i liczba ocen oraz lista widocznych ocen. Konto
// nieznane albo zablokowane: 404, jak profil publiczny. Krótki cache: ocena pojawia się po
// ujawnieniu, więc minuta opóźnienia nie przeszkadza.
import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { ReputationService } from '../application/reputation.service.js';
import {
  PublicReviewListDto,
  publicReviewDto,
  UserRatingDto,
  userRatingDto,
} from './reviews-dto.js';

class UserParams extends createZodDto(z.object({ id: z.string().max(64) })) {}

class PageQuery extends createZodDto(
  z.object({ before: z.uuid().optional().describe('ID ostatniej oceny poprzedniej strony') }),
) {}

@ApiTags('reviews')
@Controller('users')
export class UserReviewsController {
  constructor(private readonly reputation: ReputationService) {}

  @Get(':id/rating')
  @Header('cache-control', 'public, max-age=60')
  @ApiOperation({ summary: 'Średnia i liczba ocen konta (łącznie i według ról)' })
  @ZodResponse({ status: 200, description: 'Reputacja', type: UserRatingDto })
  async getUserRating(@Param() params: UserParams): Promise<UserRatingDto> {
    return userRatingDto(await this.reputation.rating(params.id));
  }

  @Get(':id/reviews')
  @Header('cache-control', 'public, max-age=60')
  @ApiOperation({ summary: 'Oceny konta (najnowsze pierwsze, po 20)' })
  @ZodResponse({ status: 200, description: 'Oceny', type: PublicReviewListDto })
  async listUserReviews(
    @Param() params: UserParams,
    @Query() query: PageQuery,
  ): Promise<PublicReviewListDto> {
    const page = await this.reputation.list(params.id, query.before);
    return { items: page.items.map(publicReviewDto), nextBefore: page.nextBefore };
  }
}

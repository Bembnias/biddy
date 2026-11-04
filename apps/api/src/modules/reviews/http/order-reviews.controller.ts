// Oceny zamówienia dla stron (F-30): stan ocen i wystawienie oceny. `:id` to UUID albo numer
// zamówienia; obce zamówienie: 404. Wystawienie wymaga potwierdzonego e-maila i regulaminu.
import { Body, Controller, Get, Header, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  type AuthenticatedUser,
  CurrentUser,
  RequireAcceptedTerms,
  RequireSession,
} from '../../identity/index.js';
import { ReviewService } from '../application/review.service.js';
import { OrderReviewsDto, orderReviewsDto, SubmitReviewBody } from './reviews-dto.js';

class OrderParams extends createZodDto(
  z.object({ id: z.string().min(1).max(64).describe('UUID albo numer zamówienia') }),
) {}

@ApiTags('reviews')
@Controller('orders')
export class OrderReviewsController {
  constructor(private readonly reviews: ReviewService) {}

  @Get(':id/reviews')
  @RequireSession()
  @Header('cache-control', 'private, no-store')
  @ApiOperation({
    summary: 'Oceny zamówienia (strony)',
    description:
      'Moja ocena, ocena drugiej strony po ujawnieniu, termin i powód, gdy nie mogę ocenić.',
  })
  @ZodResponse({ status: 200, description: 'Oceny zamówienia', type: OrderReviewsDto })
  async getOrderReviews(
    @Param() params: OrderParams,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrderReviewsDto> {
    return orderReviewsDto(await this.reviews.forOrder(params.id, user.id));
  }

  @Post(':id/review')
  @RequireAcceptedTerms()
  @Header('cache-control', 'private, no-store')
  @ApiOperation({
    summary: 'Ocena drugiej strony zamówienia',
    description:
      'Raz na stronę, w ciągu 14 dni od zakończenia zamówienia (sprzedaż albo zwrot po sporze). Zamówienie w toku, po terminie albo już ocenione: 409 REVIEW_UNAVAILABLE z `reason`.',
  })
  @ZodResponse({ status: 201, description: 'Oceny zamówienia po zapisie', type: OrderReviewsDto })
  async submitOrderReview(
    @Param() params: OrderParams,
    @Body() body: SubmitReviewBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrderReviewsDto> {
    return orderReviewsDto(await this.reviews.submit(params.id, user.id, body));
  }
}

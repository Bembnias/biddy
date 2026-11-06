// Oferta drugiej szansy dla licytującego (F-26, PROJECT.md §6.8): podgląd, akceptacja (nowe
// zamówienie do zapłaty) i odrzucenie bez konsekwencji. Ofertę widzi tylko jej adresat.
import { auctionSlug, CURRENCIES, type CurrencyCode } from '@biddy/shared';
import { Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { type AuthenticatedUser, CurrentUser, RequireSession } from '../../identity/index.js';
import { SECOND_CHANCE_STATUSES } from '../db/orders.schema.js';
import { type BidderOfferView, SecondChanceService } from './second-chance.service.js';

const currency = z.enum(Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]]);
const grosze = z.int().nonnegative();

class OfferParams extends createZodDto(z.object({ id: z.uuid().describe('ID oferty') })) {}

export class SecondChanceOfferDto extends createZodDto(
  z.object({
    id: z.uuid(),
    status: z.enum(SECOND_CHANCE_STATUSES),
    title: z.string(),
    photoUrl: z.string().min(1).nullable(),
    auction: z.object({ publicId: z.string().min(1), slug: z.string().min(1) }),
    currency,
    amount: grosze.describe('Cena: najwyższa oferta licytującego'),
    pokFee: grosze,
    total: grosze.describe('Do zapłaty bez dostawy'),
    expiresAt: z.iso.datetime(),
    respondedAt: z.iso.datetime().nullable(),
    orderPublicId: z.string().min(1).nullable().describe('Zamówienie po akceptacji'),
  }),
) {}

function offerDto(view: BidderOfferView): SecondChanceOfferDto {
  const { offer, snapshot } = view;
  const cover = snapshot.item.photos[0]?.urls;
  return {
    id: offer.id,
    status: offer.status,
    title: snapshot.item.title,
    photoUrl: cover?.['thumb'] ?? cover?.['medium'] ?? null,
    auction: { publicId: snapshot.auction.publicId, slug: auctionSlug(snapshot.item.title) },
    currency: offer.currency,
    amount: offer.amount,
    pokFee: view.pokFee.amount,
    total: view.total.amount,
    expiresAt: offer.expiresAt.toISOString(),
    respondedAt: offer.respondedAt?.toISOString() ?? null,
    orderPublicId: view.orderPublicId,
  };
}

@ApiTags('orders')
@Controller('second-chance-offers')
export class SecondChanceController {
  constructor(private readonly secondChance: SecondChanceService) {}

  @Get(':id')
  @RequireSession()
  @Header('cache-control', 'private, no-store')
  @ApiOperation({ summary: 'Oferta drugiej szansy (licytujący)' })
  @ZodResponse({ status: 200, description: 'Oferta', type: SecondChanceOfferDto })
  async getSecondChanceOffer(
    @Param() params: OfferParams,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SecondChanceOfferDto> {
    return offerDto(await this.secondChance.forBidder(params.id, user.id));
  }

  @Post(':id/accept')
  @RequireSession()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Przyjęcie oferty drugiej szansy',
    description: 'Tworzy zamówienie do zapłaty w 24 h. Ponowienie zwraca to samo zamówienie.',
  })
  @ZodResponse({ status: 200, description: 'Oferta przyjęta', type: SecondChanceOfferDto })
  async acceptSecondChanceOffer(
    @Param() params: OfferParams,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SecondChanceOfferDto> {
    return offerDto(await this.secondChance.accept(params.id, user.id));
  }

  @Post(':id/decline')
  @RequireSession()
  @HttpCode(200)
  @ApiOperation({ summary: 'Odrzucenie oferty drugiej szansy (bez konsekwencji)' })
  @ZodResponse({ status: 200, description: 'Oferta odrzucona', type: SecondChanceOfferDto })
  async declineSecondChanceOffer(
    @Param() params: OfferParams,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SecondChanceOfferDto> {
    return offerDto(await this.secondChance.decline(params.id, user.id));
  }
}

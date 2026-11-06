// Trasy sporu dla stron (F-28, PROJECT.md §7.5): zgłoszenie i odczyt po numerze zamówienia, akcje
// po ID sporu, etykieta zwrotu i zdjęcia z historii (prywatne). Rolę i stan sprawdza serwis.
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { APP_CONFIG, type AppConfig } from '../../../infra/config/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { type AuthenticatedUser, CurrentUser, RequireSession } from '../../identity/index.js';
import { DisputeService } from '../application/dispute.service.js';
import { DisputeViewService, type DisputeViewer } from '../application/dispute-view.service.js';
import type { DisputeRow } from '../db/disputes.schema.js';
import {
  CommentBody,
  DisputeDto,
  disputeDto,
  OfferResponseBody,
  OpenDisputeBody,
  ReturnReviewBody,
  SellerResponseBody,
  sellerResponseInput,
  ShipReturnBody,
} from './dispute-dto.js';

class OrderParams extends createZodDto(
  z.object({ id: z.string().min(1).max(64).describe('UUID albo numer zamówienia') }),
) {}

class DisputeParams extends createZodDto(z.object({ id: z.uuid() })) {}

class PhotoParams extends createZodDto(
  z.object({ id: z.uuid(), mediaId: z.uuid(), variant: z.enum(['thumb', 'large']) }),
) {}

@ApiTags('disputes')
@Controller()
export class DisputesController {
  constructor(
    private readonly disputes: DisputeService,
    private readonly views: DisputeViewService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('orders/:id/dispute')
  @RequireSession()
  @Header('cache-control', 'private, no-store')
  @ApiOperation({ summary: 'Spór zamówienia (strony)', description: 'Brak sporu: 404.' })
  @ZodResponse({ status: 200, description: 'Spór', type: DisputeDto })
  async getOrderDispute(
    @Param() params: OrderParams,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DisputeDto> {
    const { dispute, role } = await this.disputes.forOrder(params.id, user.id);
    return this.dto(dispute, role);
  }

  @Post('orders/:id/dispute')
  @RequireSession()
  @Header('cache-control', 'private, no-store')
  @ApiOperation({
    summary: 'Zgłoszenie problemu (kupujący, 36 h od odbioru)',
    description:
      'Zamówienie przechodzi w DISPUTED, a sprzedający ma 48 h na odpowiedź. Ponowienie zwraca istniejący spór (200).',
  })
  @ZodResponse({ status: 201, description: 'Spór', type: DisputeDto })
  async openDispute(
    @Param() params: OrderParams,
    @Body() body: OpenDisputeBody,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<DisputeDto> {
    const { dispute, created } = await this.disputes.open(params.id, user.id, body);
    if (!created) {
      void reply.status(HttpStatus.OK);
    }
    return this.dto(dispute, 'BUYER');
  }

  @Post('disputes/:id/seller-response')
  @RequireSession()
  @HttpCode(200)
  @Header('cache-control', 'private, no-store')
  @ApiOperation({
    summary: 'Odpowiedź sprzedającego',
    description: 'Zwrot (z odesłaniem albo bez), propozycja zwrotu części ceny albo odrzucenie.',
  })
  @ZodResponse({ status: 200, description: 'Spór', type: DisputeDto })
  async respondToDispute(
    @Param() params: DisputeParams,
    @Body() body: SellerResponseBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DisputeDto> {
    await this.disputes.respondAsSeller(params.id, user.id, sellerResponseInput(body));
    return this.partyDto(params.id, user.id);
  }

  @Post('disputes/:id/offer-response')
  @RequireSession()
  @HttpCode(200)
  @Header('cache-control', 'private, no-store')
  @ApiOperation({ summary: 'Odpowiedź kupującego na propozycję zwrotu części ceny' })
  @ZodResponse({ status: 200, description: 'Spór', type: DisputeDto })
  async answerDisputeOffer(
    @Param() params: DisputeParams,
    @Body() body: OfferResponseBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DisputeDto> {
    await this.disputes.answerOffer(params.id, user.id, body);
    return this.partyDto(params.id, user.id);
  }

  @Post('disputes/:id/comments')
  @RequireSession()
  @HttpCode(200)
  @Header('cache-control', 'private, no-store')
  @ApiOperation({ summary: 'Wyjaśnienie strony (notatka i zdjęcia) przed rozstrzygnięciem' })
  @ZodResponse({ status: 200, description: 'Spór', type: DisputeDto })
  async commentOnDispute(
    @Param() params: DisputeParams,
    @Body() body: CommentBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DisputeDto> {
    await this.disputes.comment(params.id, user.id, body);
    return this.partyDto(params.id, user.id);
  }

  @Post('disputes/:id/return-shipment')
  @RequireSession()
  @HttpCode(200)
  @Header('cache-control', 'private, no-store')
  @ApiOperation({
    summary: 'Nadanie zwrotu (kupujący)',
    description: 'Dane nadawcy i sposób nadania; przesyłkę u przewoźnika tworzy worker (F-24).',
  })
  @ZodResponse({ status: 200, description: 'Spór', type: DisputeDto })
  async shipDisputeReturn(
    @Param() params: DisputeParams,
    @Body() body: ShipReturnBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DisputeDto> {
    await this.disputes.shipReturn(params.id, user.id, body);
    return this.partyDto(params.id, user.id);
  }

  @Get('disputes/:id/return-label')
  @RequireSession()
  @Header('cache-control', 'private, no-store')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'Etykieta PDF zwrotu (kupujący)' })
  @ApiOkResponse({ description: 'Etykieta', schema: { type: 'string', format: 'binary' } })
  async getDisputeReturnLabel(
    @Param() params: DisputeParams,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StreamableFile> {
    const pdf = await this.disputes.returnLabel(params.id, user.id);
    if (pdf === undefined) {
      throw new DomainError({ code: 'NOT_FOUND', detail: 'Etykieta nie jest jeszcze gotowa.' });
    }
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: 'attachment; filename="etykieta-zwrot.pdf"',
    });
  }

  @Post('disputes/:id/return-review')
  @RequireSession()
  @HttpCode(200)
  @Header('cache-control', 'private, no-store')
  @ApiOperation({
    summary: 'Weryfikacja zwrotu (sprzedający)',
    description:
      'Przyjęcie zwraca pieniądze kupującemu, zakwestionowanie przekazuje spór do Biddy.',
  })
  @ZodResponse({ status: 200, description: 'Spór', type: DisputeDto })
  async reviewDisputeReturn(
    @Param() params: DisputeParams,
    @Body() body: ReturnReviewBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DisputeDto> {
    await this.disputes.reviewReturn(params.id, user.id, body);
    return this.partyDto(params.id, user.id);
  }

  @Get('disputes/:id/photos/:mediaId/:variant')
  @RequireSession()
  @Header('cache-control', 'private, max-age=3600')
  @ApiProduces('image/webp')
  @ApiOperation({ summary: 'Zdjęcie ze sporu (strony i personel)' })
  @ApiOkResponse({ description: 'Zdjęcie WebP', schema: { type: 'string', format: 'binary' } })
  async getDisputePhoto(
    @Param() params: PhotoParams,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StreamableFile> {
    const dispute = await this.disputes.byId(params.id);
    const allowed =
      dispute !== undefined &&
      (user.staffRole !== null || dispute.buyerId === user.id || dispute.sellerId === user.id);
    const photo = allowed
      ? await this.views.photo(dispute, params.mediaId, params.variant)
      : undefined;
    if (photo === undefined) {
      throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono zdjęcia.' });
    }
    return new StreamableFile(photo.data, { type: photo.contentType });
  }

  private async partyDto(disputeId: string, userId: string): Promise<DisputeDto> {
    const { dispute, role } = await this.disputes.forParty(disputeId, userId);
    return this.dto(dispute, role);
  }

  private async dto(dispute: DisputeRow, viewer: DisputeViewer): Promise<DisputeDto> {
    return disputeDto(await this.views.view(dispute, viewer), this.config.auth.apiUrl);
  }
}

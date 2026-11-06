// Spory od strony personelu (F-28): kolejka po eskalacji, widok sporu i decyzja z uzasadnieniem.
// Do panelu admina (F-34) rola personelu pochodzi ze zwykłej sesji konta, jak przy strike'ach.
import { DISPUTE_STATUSES } from '@biddy/shared';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { APP_CONFIG, type AppConfig } from '../../../infra/config/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { type AuthenticatedUser, CurrentUser, RequireStaff } from '../../identity/index.js';
import { DisputeService } from '../application/dispute.service.js';
import { DisputeViewService } from '../application/dispute-view.service.js';
import {
  AdminDisputeDto,
  AdminDisputeListDto,
  adminDisputeDto,
  DecisionBody,
} from './dispute-dto.js';

class DisputeParams extends createZodDto(z.object({ id: z.uuid() })) {}

class QueueQuery extends createZodDto(
  z.object({ status: z.enum(DISPUTE_STATUSES).default('ESCALATED') }),
) {}

@ApiTags('admin')
@Controller('admin/disputes')
@RequireStaff('support', 'moderator', 'admin')
export class AdminDisputesController {
  constructor(
    private readonly disputes: DisputeService,
    private readonly views: DisputeViewService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: 'Kolejka sporów',
    description: 'Domyślnie spory u zespołu Biddy, najstarsza eskalacja pierwsza (SLA 72 h).',
  })
  @ZodResponse({ status: 200, description: 'Spory', type: AdminDisputeListDto })
  async listDisputes(@Query() query: QueueQuery): Promise<AdminDisputeListDto> {
    const rows = await this.disputes.queue(query.status);
    return {
      items: rows.map((dispute) => ({
        id: dispute.id,
        orderPublicId: dispute.orderPublicId,
        title: dispute.title,
        status: dispute.status,
        reason: dispute.reason,
        currency: dispute.currency,
        itemsTotal: dispute.itemsTotal,
        createdAt: dispute.createdAt.toISOString(),
        escalatedAt: dispute.escalatedAt?.toISOString() ?? null,
        decisionDueAt: dispute.decisionDueAt?.toISOString() ?? null,
      })),
    };
  }

  @Get(':id')
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Spór z historią, zdjęciami i przesyłką zwrotną' })
  @ZodResponse({ status: 200, description: 'Spór', type: AdminDisputeDto })
  async getAdminDispute(@Param() params: DisputeParams): Promise<AdminDisputeDto> {
    return this.view(params.id);
  }

  @Post(':id/decision')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: 'Decyzja w sporze po eskalacji',
    description:
      'SELLER_FAVOR kończy zamówienie, FULL_REFUND (wina SELLER albo CARRIER, opcjonalnie z odesłaniem) i PARTIAL_REFUND (kwota do ceny) zlecają zwrot. Uzasadnienie widzą obie strony (DSA).',
  })
  @ZodResponse({ status: 200, description: 'Spór po decyzji', type: AdminDisputeDto })
  async decideDispute(
    @Param() params: DisputeParams,
    @Body() body: DecisionBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AdminDisputeDto> {
    await this.disputes.decide(params.id, user.id, body);
    return this.view(params.id);
  }

  private async view(disputeId: string): Promise<AdminDisputeDto> {
    const dispute = await this.disputes.byId(disputeId);
    if (dispute === undefined) {
      throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono sporu.' });
    }
    return adminDisputeDto(await this.views.view(dispute, 'STAFF'), this.config.auth.apiUrl);
  }
}

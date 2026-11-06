import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { type AuthenticatedUser, CurrentUser, RequireSession } from '../../identity/index.js';
import {
  MAX_SAVED_PICKUP_POINTS,
  SavedPickupPointService,
} from '../application/saved-pickup-points.service.js';
import type { SavedPickupPointRow } from '../db/shipping.schema.js';

export class SavedPickupPointDto extends createZodDto(
  z.object({
    id: z.uuid(),
    carrierId: z.string().min(1).describe('Usługa, np. inpost-paczkomat'),
    pointId: z.string().min(1).describe('Kod punktu u dostawcy, np. WAW01M'),
    name: z.string().min(1),
    address: z.string().describe('Adres jednym tekstem (kopia z zapisu)'),
    openingHours: z.string().min(1).nullable(),
    isDefault: z.boolean().describe('Domyślny punkt tej usługi'),
    createdAt: z.iso.datetime(),
  }),
) {}

class SavePickupPointDto extends createZodDto(
  z.object({
    carrierId: z.string().trim().min(1).max(60),
    pointId: z.string().trim().min(1, 'Wybierz punkt odbioru.').max(100),
    isDefault: z.boolean().optional().describe('Ustaw jako domyślny dla usługi'),
  }),
) {}

class UpdatePickupPointDto extends createZodDto(
  z.object({ isDefault: z.literal(true).describe('Jedyna zmiana: punkt domyślny usługi') }),
) {}

class PickupPointIdParams extends createZodDto(z.object({ id: z.uuid() })) {}

function toDto(point: SavedPickupPointRow): SavedPickupPointDto {
  return {
    id: point.id,
    carrierId: point.carrierId,
    pointId: point.pointId,
    name: point.name,
    address: point.address,
    openingHours: point.openingHours,
    isDefault: point.isDefault,
    createdAt: point.createdAt.toISOString(),
  };
}

/**
 * Zapisane punkty odbioru zalogowanego użytkownika (F-64): lista dla bieżącego dostawcy
 * punktów, zapis ze sprawdzeniem punktu u dostawcy, domyślny na usługę. Cudzy punkt to 404.
 */
@ApiTags('me')
@Controller('me/pickup-points')
@RequireSession()
export class SavedPickupPointsController {
  constructor(private readonly points: SavedPickupPointService) {}

  @Get()
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Zapisane punkty odbioru' })
  @ZodResponse({
    status: 200,
    description: 'Punkty (najpierw domyślne, potem od najnowszych)',
    type: [SavedPickupPointDto],
  })
  async getMyPickupPoints(@CurrentUser() user: AuthenticatedUser): Promise<SavedPickupPointDto[]> {
    return (await this.points.list(user.id)).map(toDto);
  }

  @Post()
  @ApiOperation({
    summary: 'Zapis punktu odbioru',
    description: `Sprawdza punkt u dostawcy i zapisuje kopię nazwy i adresu. Pierwszy punkt usługi jest domyślny. Już zapisany punkt: 200 bez drugiego wpisu. Najwyżej ${MAX_SAVED_PICKUP_POINTS} punktów (409 PICKUP_POINT_LIMIT_REACHED); punkt nieczynny: 422 PICKUP_POINT_NOT_FOUND.`,
  })
  @ZodResponse({ status: 201, description: 'Zapisany punkt', type: SavedPickupPointDto })
  @ApiOkResponse({ description: 'Punkt był już zapisany', type: SavedPickupPointDto })
  async savePickupPoint(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SavePickupPointDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SavedPickupPointDto> {
    const { point, created } = await this.points.save(user.id, body);
    if (!created) {
      void reply.status(200);
    }
    return toDto(point);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Punkt domyślny usługi' })
  @ZodResponse({ status: 200, description: 'Punkt domyślny', type: SavedPickupPointDto })
  async updatePickupPoint(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: PickupPointIdParams,
    @Body() _body: UpdatePickupPointDto,
  ): Promise<SavedPickupPointDto> {
    return toDto(await this.points.setDefault(user.id, params.id));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Usunięcie punktu odbioru',
    description: 'Usunięcie domyślnego punktu nie wybiera nowego domyślnego.',
  })
  @ApiNoContentResponse({ description: 'Punkt usunięty' })
  async deletePickupPoint(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: PickupPointIdParams,
  ): Promise<void> {
    await this.points.delete(user.id, params.id);
  }
}

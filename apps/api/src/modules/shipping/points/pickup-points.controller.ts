import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { RequireSession } from '../../identity/index.js';
import { MAX_PICKUP_POINTS, PickupPointService } from '../application/pickup-point.service.js';
import { PickupPointDto, pickupPointDto } from '../http/shipment-dto.js';

class PickupPointsQuery extends createZodDto(
  z
    .object({
      carrier: z.string().min(1).max(60).describe('Usługa, np. inpost-paczkomat'),
      lat: z.coerce.number().min(-90).max(90).optional(),
      lng: z.coerce.number().min(-180).max(180).optional(),
      q: z.string().trim().min(2).max(100).optional().describe('Miasto, adres albo kod punktu'),
      limit: z.coerce.number().int().min(1).max(MAX_PICKUP_POINTS).optional(),
    })
    .refine((query) => (query.lat === undefined) === (query.lng === undefined), {
      message: 'Podaj obie współrzędne (lat i lng) albo żadnej.',
      path: ['lat'],
    })
    .refine((query) => query.lat !== undefined || query.q !== undefined, {
      message: 'Podaj współrzędne (lat, lng) albo frazę (q).',
      path: ['q'],
    }),
) {}

/**
 * Punkty odbioru usługi u dostawcy (F-24): mapa w checkoutcie (F-25). Wymaga sesji, bo każde
 * zapytanie zużywa limit API dostawcy.
 */
@ApiTags('shipping')
@Controller('shipping')
export class PickupPointsController {
  constructor(private readonly points: PickupPointService) {}

  @Get('points')
  @RequireSession()
  @Header('cache-control', 'private, max-age=60')
  @ApiOperation({
    summary: 'Punkty odbioru usługi',
    description: `Paczkomaty i punkty blisko współrzędnych albo frazy (najwyżej ${MAX_PICKUP_POINTS}). Kurier nie ma punktów (422).`,
  })
  @ZodResponse({ status: 200, description: 'Punkty odbioru', type: [PickupPointDto] })
  async getPickupPoints(@Query() query: PickupPointsQuery): Promise<PickupPointDto[]> {
    const points = await this.points.search({
      carrierId: query.carrier,
      ...(query.lat === undefined || query.lng === undefined
        ? {}
        : { near: { lat: query.lat, lng: query.lng } }),
      ...(query.q === undefined ? {} : { phrase: query.q }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
    return points.map(pickupPointDto);
  }
}

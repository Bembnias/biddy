import { Controller, Get, Header, Param, Query } from '@nestjs/common';
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

class PickupPointParams extends createZodDto(
  z.object({ pointId: z.string().trim().min(1).max(100).describe('Kod punktu, np. WAW01M') }),
) {}

class PickupPointCarrierQuery extends createZodDto(
  z.object({ carrier: z.string().min(1).max(60).describe('Usługa, np. inpost-paczkomat') }),
) {}

/**
 * Punkty odbioru usługi u dostawcy punktów (F-24, F-64): wyszukiwarka i punkt po kodzie z mapy.
 * Wymaga sesji, bo każde zapytanie zużywa limit API dostawcy.
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

  @Get('points/:pointId')
  @RequireSession()
  @Header('cache-control', 'private, max-age=60')
  @ApiOperation({
    summary: 'Punkt odbioru po kodzie',
    description:
      'Punkt wybrany na mapie (F-64): nazwa, adres i godziny od dostawcy punktów. 422 PICKUP_POINT_NOT_FOUND (nieczynny albo nieznany) i SHIPPING_OPTION_UNAVAILABLE (kurier, nieznana usługa).',
  })
  @ZodResponse({ status: 200, description: 'Punkt odbioru', type: PickupPointDto })
  async getPickupPoint(
    @Param() params: PickupPointParams,
    @Query() query: PickupPointCarrierQuery,
  ): Promise<PickupPointDto> {
    const { point } = await this.points.byId(query.carrier, params.pointId);
    return pickupPointDto(point);
  }
}

import { PACKAGE_SIZES } from '@biddy/shared';
import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { ShippingQuoteService } from '../application/shipping-quote.service.js';
import { CARRIER_KINDS } from '../db/shipping.schema.js';
import { pointMapSchema } from '../http/shipment-dto.js';
import { CarrierService } from './carrier.service.js';

export class CarrierDto extends createZodDto(
  z.object({
    id: z.string().min(1).describe('Identyfikator usługi, np. inpost-paczkomat'),
    name: z.string().min(1),
    kind: z.enum(CARRIER_KINDS).describe('Paczkomat, punkt odbioru albo kurier'),
    packageSizes: z.array(z.enum(PACKAGE_SIZES)).describe('Obsługiwane gabaryty'),
    pointMap: pointMapSchema,
  }),
) {}

/** Przewoźnicy do wyboru w kreatorze aukcji (F-14). Publiczne, z cache. */
@ApiTags('shipping')
@Controller('shipping')
export class CarriersController {
  constructor(
    private readonly carriers: CarrierService,
    private readonly quotes: ShippingQuoteService,
  ) {}

  @Get('carriers')
  @Header('cache-control', 'public, max-age=300')
  @ApiOperation({ summary: 'Przewoźnicy i obsługiwane gabaryty' })
  @ZodResponse({ status: 200, description: 'Przewoźnicy', type: [CarrierDto] })
  async getCarriers(): Promise<CarrierDto[]> {
    return (await this.carriers.configs()).map((carrier) => ({
      id: carrier.id,
      name: carrier.name,
      kind: carrier.kind,
      packageSizes: [...carrier.packageSizes],
      pointMap: this.quotes.pointMap(carrier),
    }));
  }
}

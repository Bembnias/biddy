import { Module } from '@nestjs/common';

import { CarrierService } from './carriers/carrier.service.js';
import { CarriersController } from './carriers/carriers.controller.js';

/**
 * Moduł domenowy `shipping` (PROJECT.md §10.3): przewoźnicy i gabaryty (F-14); wyceny, etykiety
 * i tracking w F-24. Publiczne API: ./index.ts.
 */
@Module({
  controllers: [CarriersController],
  providers: [CarrierService],
  exports: [CarrierService],
})
export class ShippingModule {}

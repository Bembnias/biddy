import { Module } from '@nestjs/common';

import { PaymentsModule } from '../payments/index.js';
import { ShippingModule } from '../shipping/index.js';
import { OrderShippingController } from './orders/order-shipping.controller.js';
import { OrderService } from './orders/order.service.js';

/**
 * Moduł domenowy `orders` (PROJECT.md §10.3): zamówienia ze sprzedanych aukcji (F-16), dostawa
 * zamówienia i „Nadaj” (F-24); checkout, maszyna stanów i terminy w F-25 i F-26. Publiczne API:
 * ./index.ts.
 */
@Module({
  imports: [PaymentsModule, ShippingModule],
  controllers: [OrderShippingController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrdersModule {}

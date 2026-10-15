import { Module } from '@nestjs/common';

import { PaymentsModule } from '../payments/index.js';
import { OrderService } from './orders/order.service.js';

/**
 * Moduł domenowy `orders` (PROJECT.md §10.3): zamówienia ze sprzedanych aukcji (F-16); checkout,
 * maszyna stanów i terminy w F-25 i F-26. Publiczne API: ./index.ts.
 */
@Module({
  imports: [PaymentsModule],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrdersModule {}

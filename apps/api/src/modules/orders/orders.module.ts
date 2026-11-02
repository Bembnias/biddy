import { Module } from '@nestjs/common';

import { PaymentsModule } from '../payments/index.js';
import { ShippingModule } from '../shipping/index.js';
import { CheckoutController } from './checkout/checkout.controller.js';
import { CheckoutService } from './checkout/checkout.service.js';
import { OrderPaymentLifecycle } from './checkout/order-payment-lifecycle.js';
import { OrderShippingController } from './orders/order-shipping.controller.js';
import { OrderStandingSources } from './orders/order-standing-sources.js';
import { OrderService } from './orders/order.service.js';

/**
 * Moduł domenowy `orders` (PROJECT.md §10.3): zamówienia ze sprzedanych aukcji (F-16), dostawa
 * zamówienia i „Nadaj” (F-24), checkout z opłaceniem i anulowaniem nieopłaconych (F-25),
 * historia zamówień i strike'i kupującego w stanie konta (F-61); pozostałe przejścia stanów
 * i terminy w F-26. Publiczne API: ./index.ts.
 */
@Module({
  imports: [PaymentsModule, ShippingModule],
  controllers: [OrderShippingController, CheckoutController],
  providers: [OrderService, CheckoutService, OrderPaymentLifecycle, OrderStandingSources],
  exports: [OrderService],
})
export class OrdersModule {}

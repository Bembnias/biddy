import { Module } from '@nestjs/common';

import { LedgerModule } from '../ledger/index.js';
import { PaymentsModule } from '../payments/index.js';
import { ShippingModule } from '../shipping/index.js';
import { SellerBalanceController } from './balance/seller-balance.controller.js';
import { SellerBalanceService } from './balance/seller-balance.service.js';
import { CheckoutController } from './checkout/checkout.controller.js';
import { CheckoutService } from './checkout/checkout.service.js';
import { OrderPaymentLifecycle } from './checkout/order-payment-lifecycle.js';
import { OrderDisputes } from './lifecycle/order-disputes.js';
import { OrderLifecycle } from './lifecycle/order-lifecycle.js';
import { OrderDetailsService } from './orders/order-details.service.js';
import { OrderShippingController } from './orders/order-shipping.controller.js';
import { OrderStandingSources } from './orders/order-standing-sources.js';
import { OrderService } from './orders/order.service.js';
import { OrdersController } from './orders/orders.controller.js';
import { SecondChanceController } from './second-chance/second-chance.controller.js';
import { SecondChanceService } from './second-chance/second-chance.service.js';

/**
 * Moduł domenowy `orders` (PROJECT.md §10.3): zamówienia ze sprzedanych aukcji (F-16), dostawa
 * zamówienia i „Nadaj” (F-24), checkout z opłaceniem i anulowaniem nieopłaconych (F-25),
 * historia zamówień i strike'i w stanie konta (F-61), cykl życia z terminami, widok zamówienia
 * i oferty drugiej szansy (F-26), widok salda sprzedającego z historią (F-27), zamówienie
 * w sporze z rozliczeniem (F-28, przebieg sporu prowadzi moduł disputes). Publiczne API:
 * ./index.ts.
 */
@Module({
  imports: [LedgerModule, PaymentsModule, ShippingModule],
  controllers: [
    OrdersController,
    OrderShippingController,
    CheckoutController,
    SecondChanceController,
    SellerBalanceController,
  ],
  providers: [
    OrderService,
    CheckoutService,
    OrderPaymentLifecycle,
    OrderStandingSources,
    OrderLifecycle,
    OrderDisputes,
    OrderDetailsService,
    SecondChanceService,
    SellerBalanceService,
  ],
  exports: [OrderService, OrderDisputes],
})
export class OrdersModule {}

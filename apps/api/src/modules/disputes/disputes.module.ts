import { Module } from '@nestjs/common';

import { MediaModule } from '../media/index.js';
import { OrdersModule } from '../orders/index.js';
import { PaymentsModule } from '../payments/index.js';
import { ShippingModule } from '../shipping/index.js';
import { DisputeDeadlines } from './application/dispute-deadlines.js';
import { DisputeService } from './application/dispute.service.js';
import { DisputeTransitions } from './application/dispute-transitions.js';
import { DisputeViewService } from './application/dispute-view.service.js';
import { AdminDisputesController } from './http/admin-disputes.controller.js';
import { DisputesController } from './http/disputes.controller.js';

/**
 * Moduł domenowy `disputes` (PROJECT.md §10.3): spory o zamówienia (F-28) ze zgłoszeniem,
 * odpowiedziami stron, eskalacją i decyzją personelu, zwrotem z odesłaniem i terminami.
 * Pieniądze i stan zamówienia rusza moduł orders (OrderDisputes). Publiczne API: ./index.ts.
 */
@Module({
  imports: [OrdersModule, PaymentsModule, ShippingModule, MediaModule],
  controllers: [DisputesController, AdminDisputesController],
  providers: [DisputeService, DisputeTransitions, DisputeDeadlines, DisputeViewService],
  exports: [DisputeService],
})
export class DisputesModule {}

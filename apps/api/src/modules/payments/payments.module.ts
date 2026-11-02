import { Inject, Module, type OnModuleInit, Optional } from '@nestjs/common';
import { type AbstractHttpAdapter, HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';

import { APP_CONFIG, type AppConfig } from '../../infra/config/index.js';
import { LedgerModule } from '../ledger/index.js';
import {
  FakeGatewayDevController,
  FakeGatewayEnabledGuard,
} from './adapters/fake/fake-gateway-dev.controller.js';
import { FakeGatewayJobs } from './adapters/fake/fake-gateway-jobs.js';
import {
  FAKE_GATEWAY_SCHEDULE,
  QueuedFakeGatewaySchedule,
} from './adapters/fake/fake-gateway-schedule.js';
import { FakeGatewaySimulator } from './adapters/fake/fake-gateway-simulator.js';
import { FakeGateway } from './adapters/fake/fake-gateway.js';
import { GatewayRegistry, PAYMENT_GATEWAYS } from './application/gateway-registry.js';
import { PaymentEventProcessor } from './application/payment-event-processor.js';
import { PaymentTransitions } from './application/payment-transitions.js';
import { PaymentService } from './application/payment.service.js';
import { PendingPaymentsPoller } from './application/pending-payments-poller.js';
import { RefundService } from './application/refund.service.js';
import { SellerAccountService } from './application/seller-account.service.js';
import { FeeScheduleService } from './fees/fee-schedule.service.js';
import { FeeSchedulesController } from './fees/fee-schedules.controller.js';
import type { PaymentGateway } from './ports/payment-gateway.port.js';
import { registerPaymentWebhookRoutes } from './webhooks/payment-webhook-routes.js';

/**
 * Moduł domenowy `payments` (PROJECT.md §10.3, §7.8): cenniki POK (F-13), port płatności,
 * rejestr adapterów, FakeGateway, płatności, konta sprzedawców u operatora, webhooki i polling
 * zapasowy (F-23), zwroty (F-25); wypłaty i chargebacki w kolejnych feature'ach. Publiczne API:
 * ./index.ts. Trasę webhooków (surowe body) rejestruje tylko w procesie HTTP.
 */
@Module({
  imports: [LedgerModule],
  controllers: [FeeSchedulesController, FakeGatewayDevController],
  providers: [
    FeeScheduleService,
    { provide: FAKE_GATEWAY_SCHEDULE, useClass: QueuedFakeGatewaySchedule },
    FakeGateway,
    FakeGatewaySimulator,
    FakeGatewayJobs,
    FakeGatewayEnabledGuard,
    {
      // FakeGateway tylko poza produkcją (DEPLOYMENT_ENV); prawdziwe adaptery dojdą w F-31.
      provide: PAYMENT_GATEWAYS,
      inject: [APP_CONFIG, FakeGateway],
      useFactory: (config: AppConfig, fake: FakeGateway): PaymentGateway[] =>
        config.payments.fake.enabled ? [fake] : [],
    },
    GatewayRegistry,
    PaymentTransitions,
    SellerAccountService,
    PaymentService,
    RefundService,
    PaymentEventProcessor,
    PendingPaymentsPoller,
  ],
  exports: [
    FeeScheduleService,
    GatewayRegistry,
    PaymentService,
    RefundService,
    SellerAccountService,
    PaymentEventProcessor,
    PendingPaymentsPoller,
  ],
})
export class PaymentsModule implements OnModuleInit {
  constructor(
    private readonly processor: PaymentEventProcessor,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() private readonly adapterHost?: HttpAdapterHost,
  ) {}

  onModuleInit(): void {
    // W workerze (createApplicationContext) HttpAdapterHost istnieje, ale bez adaptera (null).
    const adapter = this.adapterHost?.httpAdapter as AbstractHttpAdapter | null | undefined;
    if (adapter === null || adapter === undefined) {
      return;
    }
    registerPaymentWebhookRoutes(
      adapter.getInstance<FastifyInstance>(),
      this.processor,
      this.config,
    );
  }
}

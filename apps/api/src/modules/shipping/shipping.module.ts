import { Inject, Module, type OnModuleInit, Optional } from '@nestjs/common';
import { type AbstractHttpAdapter, HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';

import { APP_CONFIG, type AppConfig } from '../../infra/config/index.js';
import {
  FakeShippingDevController,
  FakeShippingEnabledGuard,
} from './adapters/fake/fake-shipping-dev.controller.js';
import { FakeShippingJobs } from './adapters/fake/fake-shipping-jobs.js';
import { FakeShippingProvider } from './adapters/fake/fake-shipping-provider.js';
import {
  FAKE_SHIPPING_SCHEDULE,
  QueuedFakeShippingSchedule,
} from './adapters/fake/fake-shipping-schedule.js';
import { FakeShippingSimulator } from './adapters/fake/fake-shipping-simulator.js';
import { FurgonetkaClient } from './adapters/furgonetka/furgonetka-client.js';
import { FurgonetkaProvider } from './adapters/furgonetka/furgonetka-provider.js';
import { DbFurgonetkaTokenStore } from './adapters/furgonetka/furgonetka-token-store.js';
import { CarrierClaimService } from './application/carrier-claim.service.js';
import { PickupPointService } from './application/pickup-point.service.js';
import { SHIPPING_PROVIDERS, ShippingProviderRegistry } from './application/provider-registry.js';
import { ShipmentService } from './application/shipment.service.js';
import { ShippingJobs } from './application/shipping-jobs.js';
import { ShippingQuoteService } from './application/shipping-quote.service.js';
import { ShippingWebhookProcessor } from './application/shipping-webhook-processor.js';
import { TrackingSync } from './application/tracking-sync.js';
import { CarrierService } from './carriers/carrier.service.js';
import { CarriersController } from './carriers/carriers.controller.js';
import { PickupPointsController } from './points/pickup-points.controller.js';
import type { ShippingProvider } from './ports/shipping-provider.port.js';
import { registerShippingWebhookRoutes } from './webhooks/shipping-webhook-routes.js';

/**
 * Moduł domenowy `shipping` (PROJECT.md §10.3, §8): przewoźnicy i gabaryty (F-14), cennik
 * dostaw, port dostawców z FakeShipping i Furgonetką, przesyłki z etykietami, tracking przez
 * webhooki i polling, reklamacje u przewoźników (F-24). Publiczne API: ./index.ts. Trasę
 * webhooków (surowe body) rejestruje tylko w procesie HTTP.
 */
@Module({
  controllers: [CarriersController, PickupPointsController, FakeShippingDevController],
  providers: [
    CarrierService,
    ShippingQuoteService,
    { provide: FAKE_SHIPPING_SCHEDULE, useClass: QueuedFakeShippingSchedule },
    FakeShippingProvider,
    FakeShippingSimulator,
    FakeShippingJobs,
    FakeShippingEnabledGuard,
    DbFurgonetkaTokenStore,
    {
      // FakeShipping tylko poza produkcją (DEPLOYMENT_ENV), Furgonetka ze zmiennymi FURGONETKA_*.
      provide: SHIPPING_PROVIDERS,
      inject: [APP_CONFIG, FakeShippingProvider, DbFurgonetkaTokenStore],
      useFactory: (
        config: AppConfig,
        fake: FakeShippingProvider,
        tokens: DbFurgonetkaTokenStore,
      ): ShippingProvider[] => {
        const furgonetka = config.shipping.furgonetka;
        return [
          ...(config.shipping.fake.enabled ? [fake] : []),
          ...(furgonetka === undefined
            ? []
            : [
                new FurgonetkaProvider(
                  new FurgonetkaClient(furgonetka, tokens),
                  furgonetka.webhookToken,
                ),
              ]),
        ];
      },
    },
    ShippingProviderRegistry,
    PickupPointService,
    ShipmentService,
    TrackingSync,
    ShippingWebhookProcessor,
    ShippingJobs,
    CarrierClaimService,
  ],
  exports: [
    CarrierService,
    ShippingQuoteService,
    PickupPointService,
    ShipmentService,
    TrackingSync,
    CarrierClaimService,
    ShippingProviderRegistry,
  ],
})
export class ShippingModule implements OnModuleInit {
  constructor(
    private readonly processor: ShippingWebhookProcessor,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() private readonly adapterHost?: HttpAdapterHost,
  ) {}

  onModuleInit(): void {
    // W workerze (createApplicationContext) HttpAdapterHost istnieje, ale bez adaptera (null).
    const adapter = this.adapterHost?.httpAdapter as AbstractHttpAdapter | null | undefined;
    if (adapter === null || adapter === undefined) {
      return;
    }
    registerShippingWebhookRoutes(
      adapter.getInstance<FastifyInstance>(),
      this.processor,
      this.config,
    );
  }
}

// Webhooki dostawców przesyłek (F-24, PROJECT.md §8.3): POST /v1/webhooks/shipping/:provider.
// Webhook jest tylko wskazówką „przesyłka się zmieniła”: adapter weryfikuje go i wskazuje
// przesyłki, a stan pobiera job synchronizacji z API dostawcy. Webhook o przesyłce, której nie
// znamy (Furgonetka wysyła o wszystkich paczkach konta), pomijamy z ostrzeżeniem.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { shipments } from '../db/shipping.schema.js';
import {
  isShippingProviderError,
  type RawWebhookRequest,
} from '../ports/shipping-provider.port.js';
import { ShippingProviderRegistry } from './provider-registry.js';
import { TrackingSync } from './tracking-sync.js';

export interface ShippingWebhookReceipt {
  /** „OK”: odpowiedź, której oczekuje Furgonetka. */
  readonly status: 'OK';
  /** Przesyłki, o których mówi webhook. */
  readonly received: number;
  /** Ile z nich nie znamy (pominięte). */
  readonly unknown: number;
}

@Injectable()
export class ShippingWebhookProcessor {
  private readonly logger = new Logger(ShippingWebhookProcessor.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(ShippingProviderRegistry) private readonly registry: ShippingProviderRegistry,
    @Inject(TrackingSync) private readonly tracking: TrackingSync,
  ) {}

  /** 404 nieznany dostawca, 401 zły podpis, 400 zły format; inaczej 200 z liczbami. */
  async receive(providerName: string, request: RawWebhookRequest): Promise<ShippingWebhookReceipt> {
    const provider = this.registry.find(providerName);
    if (provider === undefined) {
      throw new DomainError({ code: 'NOT_FOUND' });
    }
    let hint;
    try {
      hint = await provider.parseWebhook(request);
    } catch (error) {
      if (isShippingProviderError(error, 'INVALID_SIGNATURE')) {
        this.logger.warn({ provider: providerName }, 'Webhook przesyłek: zły podpis');
        throw new DomainError({ code: 'UNAUTHORIZED', detail: 'Nieprawidłowy podpis webhooka.' });
      }
      if (isShippingProviderError(error, 'INVALID_REQUEST')) {
        throw new DomainError({ code: 'BAD_REQUEST', detail: error.message });
      }
      throw error;
    }
    const ids = [...new Set(hint.providerShipmentIds)];
    const known =
      ids.length === 0
        ? []
        : await this.db
            .select({ id: shipments.id })
            .from(shipments)
            .where(
              and(
                eq(shipments.provider, provider.provider),
                inArray(shipments.providerShipmentId, ids),
              ),
            );
    for (const { id } of known) {
      await this.tracking.enqueueSync(id);
    }
    const unknown = ids.length - known.length;
    if (unknown > 0) {
      this.logger.warn(
        { provider: providerName, unknown },
        'Webhook przesyłek: nieznane przesyłki pominięte',
      );
    }
    this.logger.log(
      { provider: providerName, received: ids.length, unknown },
      'Webhook przesyłek odebrany',
    );
    return { status: 'OK', received: ids.length, unknown };
  }
}

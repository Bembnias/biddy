// Punkty odbioru (F-24, PROJECT.md §8.3): paczkomaty i punkty usługi u dostawcy domyślnego.
// Lista do mapy w checkoutcie (F-25) i sprawdzenie punktu przy wyborze dostawy.
import { Inject, Injectable } from '@nestjs/common';

import { DomainError } from '../../../infra/http/index.js';
import { CarrierService, type CarrierConfigRow } from '../carriers/carrier.service.js';
import type { PickupPoint, ShippingProvider } from '../ports/shipping-provider.port.js';
import { ShippingProviderRegistry } from './provider-registry.js';
import { providerCall } from './provider-errors.js';

/** Najwięcej punktów w jednej odpowiedzi. */
export const MAX_PICKUP_POINTS = 50;

export interface PickupPointSearch {
  readonly carrierId: string;
  readonly near?: { readonly lat: number; readonly lng: number };
  readonly phrase?: string;
  readonly limit?: number;
}

@Injectable()
export class PickupPointService {
  constructor(
    @Inject(CarrierService) private readonly carriers: CarrierService,
    @Inject(ShippingProviderRegistry) private readonly registry: ShippingProviderRegistry,
  ) {}

  /** Punkty usługi blisko miejsca albo frazy. 422 dla kuriera i nieznanej usługi. */
  async search(search: PickupPointSearch): Promise<PickupPoint[]> {
    const carrier = await this.pointCarrier(search.carrierId);
    const provider = this.registry.default();
    return providerCall(() =>
      provider.findPoints({
        carrier,
        ...(search.near === undefined ? {} : { near: search.near }),
        ...(search.phrase === undefined ? {} : { phrase: search.phrase }),
        limit: Math.min(search.limit ?? MAX_PICKUP_POINTS, MAX_PICKUP_POINTS),
      }),
    );
  }

  /** Punkt po identyfikatorze u dostawcy; undefined, gdy go nie ma (albo jest nieaktywny). */
  async point(
    carrier: CarrierConfigRow,
    pointId: string,
    provider: ShippingProvider = this.registry.default(),
  ): Promise<PickupPoint | undefined> {
    const points = await providerCall(() => provider.findPoints({ carrier, pointId, limit: 1 }));
    return points.find((point) => point.id === pointId);
  }

  private async pointCarrier(carrierId: string): Promise<CarrierConfigRow> {
    const carrier = (await this.carriers.configs()).find((config) => config.id === carrierId);
    if (carrier === undefined) {
      throw new DomainError({
        code: 'SHIPPING_OPTION_UNAVAILABLE',
        detail: 'Nie ma takiej usługi dostawy.',
      });
    }
    if (carrier.kind === 'COURIER') {
      throw new DomainError({
        code: 'SHIPPING_OPTION_UNAVAILABLE',
        detail: 'Kurier dostarcza pod adres: ta usługa nie ma punktów odbioru.',
      });
    }
    return carrier;
  }
}

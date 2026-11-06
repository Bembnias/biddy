// Rejestr adapterów dostawców przesyłek (F-24, PROJECT.md §8.1). Adapter wybieramy po polu
// `provider` przesyłki, więc po zmianie dostawcy (np. Furgonetka → InPost ShipX w v1) stare
// przesyłki dokończą tracking u starego, a nowe pójdą do SHIPPING_DEFAULT_PROVIDER.
import { Inject, Injectable } from '@nestjs/common';

import {
  APP_CONFIG,
  type AppConfig,
  type ShippingProviderName,
} from '../../../infra/config/index.js';
import type { ShippingProvider } from '../ports/shipping-provider.port.js';

/** Token DI listy adapterów dostępnych w tym środowisku (FakeShipping tylko poza produkcją). */
export const SHIPPING_PROVIDERS = Symbol('SHIPPING_PROVIDERS');

/** Brak adaptera dla dostawcy z przesyłki albo z adresu webhooka. */
export class UnknownShippingProviderError extends Error {
  constructor(readonly provider: string) {
    super(`Brak adaptera dostawcy przesyłek „${provider}”`);
    this.name = 'UnknownShippingProviderError';
  }
}

@Injectable()
export class ShippingProviderRegistry {
  private readonly providers: ReadonlyMap<string, ShippingProvider>;
  readonly defaultProvider: ShippingProviderName;
  /** Dostawca punktów odbioru (F-64): wyszukiwarka, punkt po kodzie, mapa. */
  readonly pointsProvider: ShippingProviderName;

  /**
   * @throws {Error} przy starcie, gdy dostawca domyślny nie ma adaptera (np. furgonetka bez
   *   zmiennych FURGONETKA_*): aplikacja nie wystartuje z przesyłkami, których nie da się nadać.
   */
  constructor(
    @Inject(SHIPPING_PROVIDERS) providers: readonly ShippingProvider[],
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.providers = new Map(providers.map((provider) => [provider.provider, provider]));
    const { defaultProvider, pointsProvider } = config.shipping;
    for (const [variable, provider] of [
      ['SHIPPING_DEFAULT_PROVIDER', defaultProvider],
      ['SHIPPING_POINTS_PROVIDER', pointsProvider],
    ] as const) {
      if (!this.providers.has(provider)) {
        const available = [...this.providers.keys()].join(', ') || 'brak';
        throw new Error(
          `${variable}=${provider}: brak adaptera tego dostawcy (dostępne: ${available}). FakeShipping (fake) działa tylko poza produkcją, a Furgonetka wymaga zmiennych FURGONETKA_*.`,
        );
      }
    }
    this.defaultProvider = defaultProvider;
    this.pointsProvider = pointsProvider;
  }

  /** Adapter dostawcy nowych przesyłek. */
  default(): ShippingProvider {
    return this.get(this.defaultProvider);
  }

  /** Adapter dostawcy punktów odbioru (F-64). */
  points(): ShippingProvider {
    return this.get(this.pointsProvider);
  }

  /** Adapter dla dostawcy albo undefined, gdy nie działa w tym środowisku. */
  find(provider: string): ShippingProvider | undefined {
    return this.providers.get(provider);
  }

  /** @throws {UnknownShippingProviderError} */
  get(provider: string): ShippingProvider {
    const adapter = this.providers.get(provider);
    if (adapter === undefined) {
      throw new UnknownShippingProviderError(provider);
    }
    return adapter;
  }
}

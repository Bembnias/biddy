// Rejestr adapterów operatorów płatności (F-23, PROJECT.md §7.8). Adapter wybieramy po polu
// `provider` rekordu (płatność, konto sprzedawcy), więc po zmianie operatora stare płatności
// dokończą się u starego, a nowe pójdą do operatora z PAYMENTS_DEFAULT_PROVIDER.
import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../../infra/config/index.js';
import { isPaymentProvider, type PaymentProvider } from '../domain/payment-values.js';
import type { PaymentGateway } from '../ports/payment-gateway.port.js';

/** Token DI listy adapterów dostępnych w tym środowisku (FakeGateway tylko poza produkcją). */
export const PAYMENT_GATEWAYS = Symbol('PAYMENT_GATEWAYS');

/** Brak adaptera dla operatora z rekordu albo z konfiguracji. */
export class UnknownPaymentProviderError extends Error {
  constructor(readonly provider: string) {
    super(`Brak adaptera operatora płatności „${provider}”`);
    this.name = 'UnknownPaymentProviderError';
  }
}

@Injectable()
export class GatewayRegistry {
  private readonly gateways: ReadonlyMap<string, PaymentGateway>;
  readonly defaultProvider: PaymentProvider;

  /**
   * @throws {Error} przy starcie aplikacji, gdy operator domyślny nie ma adaptera (np.
   *   PAYMENTS_DEFAULT_PROVIDER=payu przed F-31): aplikacja nie wystartuje z płatnościami,
   *   których nie da się utworzyć.
   */
  constructor(
    @Inject(PAYMENT_GATEWAYS) gateways: readonly PaymentGateway[],
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.gateways = new Map(gateways.map((gateway) => [gateway.provider, gateway]));
    const provider = config.payments.defaultProvider;
    if (!isPaymentProvider(provider) || !this.gateways.has(provider)) {
      const available = [...this.gateways.keys()].join(', ') || 'brak';
      throw new Error(
        `PAYMENTS_DEFAULT_PROVIDER=${provider}: brak adaptera tego operatora (dostępne: ${available}). FakeGateway (fake) działa tylko poza produkcją.`,
      );
    }
    this.defaultProvider = provider;
  }

  /** Adapter operatora nowych płatności. */
  default(): PaymentGateway {
    return this.get(this.defaultProvider);
  }

  /** Adapter dla operatora z rekordu albo undefined, gdy nie działa w tym środowisku. */
  find(provider: string): PaymentGateway | undefined {
    return this.gateways.get(provider);
  }

  /** @throws {UnknownPaymentProviderError} */
  get(provider: string): PaymentGateway {
    const gateway = this.gateways.get(provider);
    if (gateway === undefined) {
      throw new UnknownPaymentProviderError(provider);
    }
    return gateway;
  }

  /** Operatorzy z adapterem w tym środowisku. */
  providers(): string[] {
    return [...this.gateways.keys()];
  }
}

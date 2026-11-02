import { describe, expect, it } from 'vitest';

import { type AppConfig, loadConfig } from '../../../infra/config/index.js';
import type { PaymentGateway } from '../ports/payment-gateway.port.js';
import { GatewayRegistry, UnknownPaymentProviderError } from './gateway-registry.js';

const DATABASE_URL = 'postgres://biddy:biddy@localhost:5432/biddy';

function config(env: Record<string, string> = {}): AppConfig {
  return loadConfig({ DATABASE_URL, ...env });
}

const fake = { provider: 'fake' } as PaymentGateway;

describe('GatewayRegistry', () => {
  it('adapter domyślny z PAYMENTS_DEFAULT_PROVIDER i adapter po nazwie z rekordu', () => {
    const registry = new GatewayRegistry([fake], config());
    expect(registry.defaultProvider).toBe('fake');
    expect(registry.default()).toBe(fake);
    expect(registry.get('fake')).toBe(fake);
    expect(registry.find('payu')).toBeUndefined();
    expect(() => registry.get('payu')).toThrow(UnknownPaymentProviderError);
    expect(registry.providers()).toEqual(['fake']);
  });

  it('bez adaptera operatora domyślnego aplikacja nie startuje', () => {
    expect(
      () => new GatewayRegistry([fake], config({ PAYMENTS_DEFAULT_PROVIDER: 'payu' })),
    ).toThrow(/PAYMENTS_DEFAULT_PROVIDER=payu: brak adaptera tego operatora \(dostępne: fake\)/);
    expect(() => new GatewayRegistry([], config())).toThrow(/dostępne: brak/);
    expect(
      () => new GatewayRegistry([fake], config({ PAYMENTS_DEFAULT_PROVIDER: 'nieznany' })),
    ).toThrow(/brak adaptera/);
  });
});

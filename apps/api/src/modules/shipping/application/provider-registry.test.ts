import { describe, expect, it } from 'vitest';

import { type AppConfig, loadConfig } from '../../../infra/config/index.js';
import type { ShippingProvider } from '../ports/shipping-provider.port.js';
import { ShippingProviderRegistry, UnknownShippingProviderError } from './provider-registry.js';

const DATABASE_URL = 'postgres://biddy:biddy@localhost:5432/biddy';

function config(env: Record<string, string> = {}): AppConfig {
  return loadConfig({ DATABASE_URL, ...env });
}

const fake = { provider: 'fake' } as ShippingProvider;
const furgonetka = { provider: 'furgonetka' } as ShippingProvider;

describe('ShippingProviderRegistry', () => {
  it('dostawca domyślny z SHIPPING_DEFAULT_PROVIDER i adapter po nazwie z przesyłki', () => {
    const registry = new ShippingProviderRegistry([fake, furgonetka], config());
    expect(registry.defaultProvider).toBe('fake');
    expect(registry.default()).toBe(fake);
    expect(registry.get('furgonetka')).toBe(furgonetka);
    expect(registry.find('inpost')).toBeUndefined();
    expect(() => registry.get('inpost')).toThrow(UnknownShippingProviderError);
  });

  it('dostawca punktów (F-64): osobny adapter, bez niego aplikacja nie startuje', () => {
    const staging = config({
      SHIPPING_POINTS_PROVIDER: 'furgonetka',
      FURGONETKA_CLIENT_ID: 'id',
      FURGONETKA_CLIENT_SECRET: 'secret',
      FURGONETKA_USERNAME: 'konto',
      FURGONETKA_PASSWORD: 'haslo',
      FURGONETKA_WEBHOOK_TOKEN: 'token',
    });
    const registry = new ShippingProviderRegistry([fake, furgonetka], staging);
    expect(registry.default()).toBe(fake);
    expect(registry.points()).toBe(furgonetka);
    expect(registry.pointsProvider).toBe('furgonetka');
    expect(() => new ShippingProviderRegistry([fake], staging)).toThrow(
      /SHIPPING_POINTS_PROVIDER=furgonetka: brak adaptera/,
    );
  });

  it('bez adaptera dostawcy domyślnego aplikacja nie startuje', () => {
    const withFurgonetka = config({
      SHIPPING_DEFAULT_PROVIDER: 'furgonetka',
      FURGONETKA_CLIENT_ID: 'id',
      FURGONETKA_CLIENT_SECRET: 'secret',
      FURGONETKA_USERNAME: 'konto',
      FURGONETKA_PASSWORD: 'haslo',
      FURGONETKA_WEBHOOK_TOKEN: 'token',
    });
    expect(() => new ShippingProviderRegistry([fake], withFurgonetka)).toThrow(
      /SHIPPING_DEFAULT_PROVIDER=furgonetka: brak adaptera tego dostawcy \(dostępne: fake\)/,
    );
    expect(() => new ShippingProviderRegistry([], config())).toThrow(/dostępne: brak/);
  });
});

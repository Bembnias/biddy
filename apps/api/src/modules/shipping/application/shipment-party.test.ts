import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../../infra/config/index.js';
import type { DomainError } from '../../../infra/http/index.js';
import { FakeShippingEnabledGuard } from '../adapters/fake/fake-shipping-dev.controller.js';
import { normalizeParty } from './shipment-party.js';

describe('normalizeParty (nadawca i odbiorca)', () => {
  it('telefon w E.164, kod NN-NNN, adres w Polsce, e-mail opcjonalny', () => {
    expect(
      normalizeParty(
        {
          name: '  Anna Nowak ',
          phone: '500 600 700',
          address: { street: 'ul. Prosta 1', postalCode: '00001', city: 'Warszawa' },
        },
        { path: 'sender', requireAddress: true },
      ),
    ).toEqual({
      name: 'Anna Nowak',
      phone: '+48500600700',
      email: null,
      address: {
        street: 'ul. Prosta 1',
        postalCode: '00-001',
        city: 'Warszawa',
        countryCode: 'PL',
      },
    });
  });

  it('błędy pól z pełną ścieżką; brak wymaganego adresu', () => {
    try {
      normalizeParty({ name: 'An', phone: '123' }, { path: 'sender', requireAddress: true });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect((error as DomainError).errors?.map((issue) => issue.path)).toEqual([
        'sender.name',
        'sender.phone',
        'sender.address',
      ]);
    }
    expect(() =>
      normalizeParty(
        {
          name: 'Anna Nowak',
          phone: '+48500600700',
          address: { street: 'ul. Prosta 1', postalCode: '0-1', city: 'Warszawa' },
        },
        { path: 'recipient', requireAddress: false },
      ),
    ).toThrow(
      expect.objectContaining({
        errors: [expect.objectContaining({ path: 'recipient.address.postalCode' })],
      }) as Error,
    );
  });
});

describe('FakeShipping wyłączony (DEPLOYMENT_ENV=production)', () => {
  it('trasy deweloperskie odpowiadają 404, zanim sprawdzą sesję', () => {
    const production = loadConfig({
      DATABASE_URL: 'postgres://biddy:biddy@localhost:5432/biddy',
      DEPLOYMENT_ENV: 'production',
      PAYMENTS_DEFAULT_PROVIDER: 'payu',
      SHIPPING_DEFAULT_PROVIDER: 'furgonetka',
      FURGONETKA_CLIENT_ID: 'id',
      FURGONETKA_CLIENT_SECRET: 'secret',
      FURGONETKA_USERNAME: 'konto',
      FURGONETKA_PASSWORD: 'haslo',
      FURGONETKA_WEBHOOK_TOKEN: 'token',
    });
    expect(production.shipping.fake.enabled).toBe(false);
    expect(() => new FakeShippingEnabledGuard(production).canActivate()).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND', status: 404 }) as DomainError,
    );
    expect(
      new FakeShippingEnabledGuard(
        loadConfig({ DATABASE_URL: 'postgres://biddy:biddy@localhost:5432/biddy' }),
      ).canActivate(),
    ).toBe(true);
  });
});

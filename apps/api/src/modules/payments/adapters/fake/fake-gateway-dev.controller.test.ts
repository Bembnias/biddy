import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../../../infra/config/index.js';
import type { DomainError } from '../../../../infra/http/index.js';
import { GatewayRegistry } from '../../application/gateway-registry.js';
import { PaymentEventProcessor } from '../../application/payment-event-processor.js';
import type { PaymentGateway } from '../../ports/payment-gateway.port.js';
import { FakeGatewayEnabledGuard } from './fake-gateway-dev.controller.js';

const DATABASE_URL = 'postgres://biddy:biddy@localhost:5432/biddy';

/** Konfiguracja produkcji z operatorem domyślnym, który ma adapter (atrapa „payu”). */
const production = loadConfig({
  DATABASE_URL,
  DEPLOYMENT_ENV: 'production',
  PAYMENTS_DEFAULT_PROVIDER: 'payu',
});

describe('FakeGateway wyłączony (DEPLOYMENT_ENV=production)', () => {
  it('trasy deweloperskie odpowiadają 404, zanim sprawdzą sesję', () => {
    expect(production.payments.fake.enabled).toBe(false);
    expect(() => new FakeGatewayEnabledGuard(production).canActivate()).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND', status: 404 }) as DomainError,
    );
    expect(new FakeGatewayEnabledGuard(loadConfig({ DATABASE_URL })).canActivate()).toBe(true);
  });

  it('webhook na /webhooks/payments/fake: 404, bo rejestr nie ma FakeGateway', async () => {
    const payu = { provider: 'payu' } as PaymentGateway;
    const registry = new GatewayRegistry([payu], production);
    const processor = new PaymentEventProcessor({} as never, registry, {} as never, {} as never);
    await expect(
      processor.receive('fake', { headers: {}, rawBody: Buffer.from('{}') }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

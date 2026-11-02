// Testy kontraktowe portu ShippingProvider (F-24, PROJECT.md §8.1): FakeShipping na prawdziwym
// Postgresie (stan dostawcy w tabelach fake_shipping_*) z przesuwaniem statusu przez symulator,
// bez kolejki. Furgonetka przechodzi ten sam zestaw na swoim sandboksie, gdy są dane dostępu
// (FURGONETKA_SANDBOX_CLIENT_ID itd.); bez nich ten zestaw jest pomijany.
import { Pool } from 'pg';
import { afterAll, describe, it } from 'vitest';

import { createDatabase, type Database } from '../../src/infra/db/database.js';
import {
  FAKE_SHIPPING_SIGNATURE_HEADER,
  signFakeShippingWebhook,
} from '../../src/modules/shipping/adapters/fake/fake-shipping-format.js';
import { FakeShippingProvider } from '../../src/modules/shipping/adapters/fake/fake-shipping-provider.js';
import type { FakeShippingSchedule } from '../../src/modules/shipping/adapters/fake/fake-shipping-schedule.js';
import { FakeShippingSimulator } from '../../src/modules/shipping/adapters/fake/fake-shipping-simulator.js';
import { FurgonetkaClient } from '../../src/modules/shipping/adapters/furgonetka/furgonetka-client.js';
import { furgonetkaChecksum } from '../../src/modules/shipping/adapters/furgonetka/furgonetka-format.js';
import { FurgonetkaProvider } from '../../src/modules/shipping/adapters/furgonetka/furgonetka-provider.js';
import { DbFurgonetkaTokenStore } from '../../src/modules/shipping/adapters/furgonetka/furgonetka-token-store.js';
import { describeShippingProviderContract } from '../support/shipping-provider-contract.js';
import { integrationConfig } from './support/app.js';
import type { ScratchDatabase } from './support/database.js';
import { createMigratedDatabase } from './support/worker.js';

/** Harmonogram bez kolejki: statusy przesuwa uprząż, webhooków nie wysyłamy. */
const noSchedule: FakeShippingSchedule = {
  advanceLater: () => Promise.resolve(),
  deliver: () => Promise.resolve(),
};

const databases: ScratchDatabase[] = [];
const pools: Pool[] = [];

afterAll(async () => {
  for (const pool of pools) {
    await pool.end();
  }
  for (const database of databases) {
    await database.drop();
  }
});

async function scratch() {
  const database = await createMigratedDatabase();
  const pool = new Pool({ connectionString: database.url, max: 4 });
  databases.push(database);
  pools.push(pool);
  // Adaptery dostają bazę jako typ modułu (Database), a createDatabase zwraca pełny schemat.
  return { database, db: createDatabase(pool) as unknown as Database };
}

describeShippingProviderContract('FakeShipping', async () => {
  const { database, db } = await scratch();
  const config = integrationConfig({ DATABASE_URL: database.url });
  const provider = new FakeShippingProvider(db, config, noSchedule);
  const simulator = new FakeShippingSimulator(db, config, noSchedule);
  const secret = config.shipping.fake.webhookSecret;
  return {
    provider,
    locker: { id: 'inpost-paczkomat', kind: 'LOCKER', providerCodes: {} },
    pointId: 'inpost-paczkomat-01',
    moveInTransit: async (id) => {
      await simulator.advance(id, { deliverWebhook: false });
      await simulator.advance(id, { deliverWebhook: false });
    },
    webhook: (id) => {
      const body = JSON.stringify({
        id: `fsw_contract_${id}`,
        type: 'parcel.updated',
        created: new Date().toISOString(),
        parcel_id: id,
      });
      return Promise.resolve({
        headers: {
          [FAKE_SHIPPING_SIGNATURE_HEADER]: signFakeShippingWebhook(
            secret,
            body,
            Math.floor(Date.now() / 1000),
          ),
        },
        rawBody: Buffer.from(body),
      });
    },
  };
});

const sandbox = {
  clientId: process.env['FURGONETKA_SANDBOX_CLIENT_ID'],
  clientSecret: process.env['FURGONETKA_SANDBOX_CLIENT_SECRET'],
  username: process.env['FURGONETKA_SANDBOX_USERNAME'],
  password: process.env['FURGONETKA_SANDBOX_PASSWORD'],
  webhookToken: process.env['FURGONETKA_SANDBOX_WEBHOOK_TOKEN'] ?? '',
};

if (
  sandbox.clientId === undefined ||
  sandbox.clientSecret === undefined ||
  sandbox.username === undefined ||
  sandbox.password === undefined
) {
  describe('Kontrakt ShippingProvider: Furgonetka (sandbox)', () => {
    it.skip('wymaga FURGONETKA_SANDBOX_CLIENT_ID, _CLIENT_SECRET, _USERNAME i _PASSWORD', () => {
      // Pominięte bez danych dostępu do sandboksa.
    });
  });
} else {
  const { clientId, clientSecret, username, password, webhookToken } = sandbox;
  describeShippingProviderContract('Furgonetka (sandbox)', async () => {
    const { database, db } = await scratch();
    const config = integrationConfig({ DATABASE_URL: database.url });
    const client = new FurgonetkaClient(
      {
        apiUrl: 'https://api.sandbox.furgonetka.pl',
        clientId,
        clientSecret,
        username,
        password,
        webhookToken,
      },
      new DbFurgonetkaTokenStore(db, config),
    );
    return {
      provider: new FurgonetkaProvider(client, webhookToken),
      locker: { id: 'inpost-paczkomat', kind: 'LOCKER', providerCodes: { furgonetka: 'inpost' } },
      pointId: process.env['FURGONETKA_SANDBOX_POINT'] ?? 'WAW01M',
      // Sandbox: PUT /packages/tracking/simulate zastępuje historię zdarzeniami syntetycznymi.
      moveInTransit: async (id) => {
        const shipment = (await client.json('GET', `/packages/${id}`, { version: 2 })) as {
          parcels?: { package_no?: string }[];
        };
        await client.json('PUT', '/packages/tracking/simulate', {
          version: 1,
          body: {
            packages_id: id,
            package_no: shipment.parcels?.[0]?.package_no,
            states: ['collected', 'transit'],
          },
        });
      },
      webhook: (id) => {
        const payload = {
          package_id: id,
          package_no: '',
          partner_order_id: '',
          tracking: { state: 'transit', description: 'W drodze', datetime: '', branch: '' },
        };
        const control = furgonetkaChecksum(payload, webhookToken);
        return Promise.resolve({
          headers: { 'content-type': 'application/json' },
          rawBody: Buffer.from(JSON.stringify({ ...payload, control })),
        });
      },
    };
  });
}

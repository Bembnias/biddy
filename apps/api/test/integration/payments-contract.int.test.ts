// Testy kontraktowe portu PaymentGateway dla FakeGateway (F-23, PROJECT.md §7.8) na prawdziwym
// Postgresie (stan symulowanego operatora jest w tabelach fake_gateway_*). Rozliczenia robi
// uprząż wprost przez symulator, bez kolejki; asynchroniczną ścieżkę z workerem i HTTP sprawdza
// payments.int.test.ts.
import { Pool } from 'pg';
import { afterAll } from 'vitest';

import { createDatabase } from '../../src/infra/db/database.js';
import { newId } from '../../src/infra/db/index.js';
import { FakeGateway } from '../../src/modules/payments/adapters/fake/fake-gateway.js';
import type { FakeGatewaySchedule } from '../../src/modules/payments/adapters/fake/fake-gateway-schedule.js';
import { FakeGatewaySimulator } from '../../src/modules/payments/adapters/fake/fake-gateway-simulator.js';
import { FAKE_BLIK_CODES } from '../../src/modules/payments/adapters/fake/fake-scenarios.js';
import {
  FAKE_SIGNATURE_HEADER,
  type FakeWebhookBody,
  signFakeWebhook,
} from '../../src/modules/payments/adapters/fake/fake-webhook-format.js';
import type { RawWebhookRequest } from '../../src/modules/payments/ports/payment-gateway.port.js';
import {
  describeGatewayContract,
  type GatewayWebhookSample,
} from '../support/payment-gateway-contract.js';
import { integrationConfig } from './support/app.js';
import type { ScratchDatabase } from './support/database.js';
import { createMigratedDatabase } from './support/worker.js';

/** Harmonogram bez kolejki: rozliczenia zleca uprząż, webhooków nie wysyłamy. */
const noSchedule: FakeGatewaySchedule = {
  settleLater: () => Promise.resolve(),
  deliver: () => Promise.resolve(),
};

let database: ScratchDatabase | undefined;
let pool: Pool | undefined;

afterAll(async () => {
  await pool?.end();
  await database?.drop();
});

describeGatewayContract('FakeGateway', async () => {
  database = await createMigratedDatabase();
  pool = new Pool({ connectionString: database.url, max: 4 });
  const config = integrationConfig({ DATABASE_URL: database.url });
  const db = createDatabase(pool);
  const gateway = new FakeGateway(db, config, noSchedule);
  const simulator = new FakeGatewaySimulator(db, config, noSchedule);
  const secret = config.payments.fake.webhookSecret;

  const signed = (body: FakeWebhookBody, at = Math.floor(Date.now() / 1000)): RawWebhookRequest => {
    const raw = JSON.stringify(body);
    return {
      headers: {
        'content-type': 'application/json',
        [FAKE_SIGNATURE_HEADER]: signFakeWebhook(secret, raw, at),
      },
      rawBody: Buffer.from(raw),
    };
  };
  const created = new Date().toISOString();
  const amount = { value: 10_000, currency: 'PLN' } as const;
  const money = { amount: 10_000, currency: 'PLN' };
  const samples: [FakeWebhookBody, GatewayWebhookSample['expected']][] = [
    [
      { id: 'evt_1', created, type: 'payment.completed', object: { id: 'pay_1', amount } },
      { type: 'PAYMENT_SUCCEEDED', providerPaymentId: 'pay_1', amount: money },
    ],
    [
      {
        id: 'evt_2',
        created,
        type: 'payment.rejected',
        object: { id: 'pay_2', amount, failure_code: 'declined' },
      },
      { type: 'PAYMENT_FAILED', providerPaymentId: 'pay_2', reason: 'DECLINED' },
    ],
    [
      {
        id: 'evt_3',
        created,
        type: 'refund.completed',
        object: { id: 'ref_1', payment_id: 'pay_1', amount },
      },
      { type: 'REFUND_SUCCEEDED', providerRefundId: 'ref_1', amount: money },
    ],
    [
      {
        id: 'evt_4',
        created,
        type: 'refund.rejected',
        object: { id: 'ref_2', payment_id: 'pay_1', amount },
      },
      { type: 'REFUND_FAILED', providerRefundId: 'ref_2' },
    ],
    [
      {
        id: 'evt_5',
        created,
        type: 'payout.completed',
        object: { id: 'po_1', seller_id: 's_1', amount },
      },
      { type: 'PAYOUT_PAID', providerPayoutId: 'po_1', amount: money },
    ],
    [
      {
        id: 'evt_6',
        created,
        type: 'payout.rejected',
        object: { id: 'po_2', seller_id: 's_1', amount },
      },
      { type: 'PAYOUT_FAILED', providerPayoutId: 'po_2' },
    ],
    [
      {
        id: 'evt_7',
        created,
        type: 'seller.status_changed',
        object: { id: 's_1', status: 'verified' },
      },
      { type: 'SELLER_STATUS_CHANGED', providerSellerId: 's_1', status: 'VERIFIED' },
    ],
    [
      {
        id: 'evt_8',
        created,
        type: 'chargeback.opened',
        object: { id: 'cb_1', payment_id: 'pay_1', amount },
      },
      { type: 'CHARGEBACK_OPENED', providerChargebackId: 'cb_1', providerPaymentId: 'pay_1' },
    ],
    [
      {
        id: 'evt_9',
        created,
        type: 'chargeback.closed',
        object: { id: 'cb_1', payment_id: 'pay_1', amount, outcome: 'lost' },
      },
      { type: 'CHARGEBACK_CLOSED', providerChargebackId: 'cb_1', outcome: 'LOST' },
    ],
  ];

  return {
    gateway,
    payableMethod: { type: 'BLIK', code: FAKE_BLIK_CODES.SUCCEED },
    async verifiedSeller() {
      const sellerId = newId();
      const result = await gateway.registerSeller({
        sellerId,
        idempotencyKey: `seller:${sellerId}`,
        type: 'PRIVATE',
        email: 'sprzedawca@example.com',
        displayName: 'Sprzedawca',
      });
      return result.providerSellerId;
    },
    async settle(providerPaymentId) {
      await simulator.settlePayment(providerPaymentId, 'SUCCEEDED', { deliver: false });
    },
    webhookSamples: () =>
      Promise.resolve(
        samples.map(([body, expected]) => ({ name: body.type, request: signed(body), expected })),
      ),
    staleWebhook: () =>
      Promise.resolve(
        signed(samples[0]?.[0] as FakeWebhookBody, Math.floor(Date.now() / 1000) - 3_600),
      ),
  };
});

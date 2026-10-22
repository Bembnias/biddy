// Wspólny zestaw testów kontraktowych portu PaymentGateway (F-23, PROJECT.md §7.8). Musi go
// przejść każdy adapter: FakeGateway na każdym PR (test/integration/payments-contract.int.test.ts),
// prawdziwy operator na swoim sandboksie co noc (F-31). Zestaw sprawdza zachowanie widoczne dla
// domeny Biddy, a nie szczegóły API operatora; to, czego nie da się zrobić tak samo u każdego
// operatora (rozliczenie płatności, podpisane próbki webhooków), dostarcza adapterowa „uprząż”.
import type { Money } from '@biddy/shared';
import { beforeAll, describe, expect, it } from 'vitest';

import { newId } from '../../src/infra/db/index.js';
import {
  type CreatePaymentInput,
  isPaymentGatewayError,
  type NormalizedPaymentEvent,
  type NormalizedPaymentEventType,
  type PaymentGateway,
  type PaymentGatewayErrorCode,
  type RawWebhookRequest,
} from '../../src/modules/payments/ports/payment-gateway.port.js';

/** Podpisany webhook operatora z oczekiwanym zdarzeniem znormalizowanym. */
export interface GatewayWebhookSample {
  /** Typ webhooka w notacji operatora, np. `payment.completed`. */
  readonly name: string;
  readonly request: RawWebhookRequest;
  readonly expected: { readonly type: NormalizedPaymentEventType } & Record<string, unknown>;
}

export interface GatewayContractHarness {
  readonly gateway: PaymentGateway;
  /** Nowy, zweryfikowany sprzedawca u operatora; zwraca jego ID u operatora. */
  verifiedSeller(): Promise<string>;
  /** Metoda płatności, którą operator rozliczy bez udziału człowieka (np. testowy kod BLIK). */
  readonly payableMethod: CreatePaymentInput['method'];
  /** Doprowadza płatność do SUCCEEDED po stronie operatora (sandbox albo symulator). */
  settle(providerPaymentId: string): Promise<void>;
  /** Podpisane webhooki operatora każdego obsługiwanego typu z oczekiwanymi zdarzeniami. */
  webhookSamples(): Promise<readonly GatewayWebhookSample[]>;
  /** Poprawnie podpisany webhook ze znacznikiem czasu spoza tolerancji. */
  staleWebhook(): Promise<RawWebhookRequest>;
}

const PLN = (amount: number): Money => ({ amount, currency: 'PLN' });

async function gatewayError(
  operation: Promise<unknown>,
): Promise<PaymentGatewayErrorCode | 'BRAK BŁĘDU'> {
  try {
    await operation;
  } catch (error) {
    if (isPaymentGatewayError(error)) {
      return error.code;
    }
    throw error;
  }
  return 'BRAK BŁĘDU';
}

/** Zestaw testów kontraktowych dla adaptera z `setup` (uruchamiany raz na plik). */
export function describeGatewayContract(
  name: string,
  setup: () => Promise<GatewayContractHarness>,
): void {
  describe(`Kontrakt PaymentGateway: ${name}`, () => {
    let harness: GatewayContractHarness;
    let gateway: PaymentGateway;

    beforeAll(async () => {
      harness = await setup();
      gateway = harness.gateway;
    });

    function paymentInput(
      providerSellerId: string,
      total: number,
      sellerAmount: number,
      key = `contract:${newId()}`,
    ): CreatePaymentInput {
      return {
        orderId: newId(),
        idempotencyKey: key,
        total: PLN(total),
        split: {
          providerSellerId,
          sellerAmount: PLN(sellerAmount),
          platformAmount: PLN(total - sellerAmount),
        },
        method: harness.payableMethod,
        buyer: { id: newId(), email: 'kupujacy@example.com', ip: '203.0.113.10' },
        returnUrl: 'https://biddy.pl/zamowienia/k3x9qa7m',
      };
    }

    /** Płatność rozliczona u operatora. */
    async function paidPayment(total: number, sellerAmount: number) {
      const seller = await harness.verifiedSeller();
      const result = await gateway.createPayment(paymentInput(seller, total, sellerAmount));
      expect(result.status).not.toBe('FAILED');
      const providerPaymentId =
        'providerPaymentId' in result ? (result.providerPaymentId ?? '') : '';
      await harness.settle(providerPaymentId);
      return { seller, providerPaymentId };
    }

    it('wymaga wstrzymania środków co najmniej 60 dni (§7.6) i deklaruje model wstrzymania', () => {
      expect(gateway.capabilities.maxHoldDays).toBeGreaterThanOrEqual(60);
      expect(['PLATFORM_BALANCE', 'BUYER_WALLET', 'SELLER_BALANCE']).toContain(
        gateway.capabilities.holdModel,
      );
    });

    it('registerSeller: ten sam klucz zwraca to samo konto, inne dane z tym kluczem to konflikt', async () => {
      const sellerId = newId();
      const input = {
        sellerId,
        idempotencyKey: `seller:${sellerId}`,
        type: 'PRIVATE' as const,
        email: 'sprzedawca@example.com',
        displayName: 'Sprzedawca Kontraktowy',
      };
      const first = await gateway.registerSeller(input);
      const second = await gateway.registerSeller(input);
      expect(second.providerSellerId).toBe(first.providerSellerId);
      expect(await gateway.getSellerStatus(first.providerSellerId)).toBe(first.status);
      expect(await gatewayError(gateway.registerSeller({ ...input, type: 'BUSINESS' }))).toBe(
        'IDEMPOTENCY_CONFLICT',
      );
    });

    it('createPayment: ponowienie z tym samym kluczem zwraca ten sam wynik, inne dane to konflikt', async () => {
      const seller = await harness.verifiedSeller();
      const input = paymentInput(seller, 15_000, 12_000);
      const first = await gateway.createPayment(input);
      const second = await gateway.createPayment(input);
      expect(second).toEqual(first);
      expect(
        await gatewayError(
          gateway.createPayment({
            ...input,
            total: PLN(15_001),
            split: { ...input.split, platformAmount: PLN(3_001) },
          }),
        ),
      ).toBe('IDEMPOTENCY_CONFLICT');
    });

    it('createPayment: podział, który nie sumuje się do kwoty, to INVALID_REQUEST', async () => {
      const seller = await harness.verifiedSeller();
      const input = paymentInput(seller, 10_000, 8_000);
      expect(
        await gatewayError(
          gateway.createPayment({
            ...input,
            split: { ...input.split, platformAmount: PLN(1_000) },
          }),
        ),
      ).toBe('INVALID_REQUEST');
    });

    it('getPayment po rozliczeniu: SUCCEEDED z kwotą i bez zwrotów', async () => {
      const { providerPaymentId } = await paidPayment(10_000, 8_000);
      expect(await gateway.getPayment(providerPaymentId)).toMatchObject({
        providerPaymentId,
        status: 'SUCCEEDED',
        amount: PLN(10_000),
        refundedAmount: PLN(0),
      });
      expect(await gatewayError(gateway.getPayment('nie-ma-takiej-platnosci'))).toBe('NOT_FOUND');
    });

    it('częściowe zwroty sumują się najwyżej do kwoty płatności (także zwroty w toku)', async () => {
      const { providerPaymentId } = await paidPayment(10_000, 8_000);
      const refund = (amount: number, key = `refund:${newId()}`) =>
        gateway.refund({ providerPaymentId, amount: PLN(amount), idempotencyKey: key });
      expect(await gatewayError(refund(10_001))).toBe('REFUND_EXCEEDS_PAYMENT');
      const key = `refund:${newId()}`;
      const first = await refund(4_000, key);
      expect((await refund(4_000, key)).providerRefundId).toBe(first.providerRefundId);
      expect(await gatewayError(refund(5_000, key))).toBe('IDEMPOTENCY_CONFLICT');
      await refund(6_000);
      expect(await gatewayError(refund(1))).toBe('REFUND_EXCEEDS_PAYMENT');
    });

    it('wypłata ponad saldo sprzedawcy u operatora kończy się błędem, w granicach salda przechodzi', async () => {
      const { seller } = await paidPayment(10_000, 8_000);
      const payout = (amount: number) =>
        gateway.createPayout({
          providerSellerId: seller,
          amount: PLN(amount),
          idempotencyKey: `payout:${newId()}`,
        });
      expect(await gatewayError(payout(8_001))).toBe('INSUFFICIENT_BALANCE');
      expect((await payout(8_000)).providerPayoutId).not.toBe('');
      expect(await gatewayError(payout(1))).toBe('INSUFFICIENT_BALANCE');
    });

    it('releaseFunds zgodnie z modelem wstrzymania', async () => {
      const { seller, providerPaymentId } = await paidPayment(10_000, 8_000);
      const result = await gateway.releaseFunds({
        providerPaymentId,
        providerSellerId: seller,
        sellerAmount: PLN(8_000),
        idempotencyKey: `release:${newId()}`,
      });
      expect(result.status).toBe(
        gateway.capabilities.holdModel === 'SELLER_BALANCE' ? 'NOT_REQUIRED' : 'SUCCEEDED',
      );
    });

    it('parseWebhook mapuje każdy typ webhooka operatora na zdarzenie znormalizowane', async () => {
      const samples = await harness.webhookSamples();
      const types = new Set<NormalizedPaymentEventType>();
      for (const sample of samples) {
        const events: NormalizedPaymentEvent[] = await gateway.parseWebhook(sample.request);
        expect(events, sample.name).toHaveLength(1);
        expect(events[0], sample.name).toMatchObject(sample.expected);
        expect(events[0]?.eventId, sample.name).not.toBe('');
        types.add(sample.expected.type);
      }
      expect([...types].sort()).toEqual(
        [
          'CHARGEBACK_CLOSED',
          'CHARGEBACK_OPENED',
          'PAYMENT_FAILED',
          'PAYMENT_SUCCEEDED',
          'PAYOUT_FAILED',
          'PAYOUT_PAID',
          'REFUND_FAILED',
          'REFUND_SUCCEEDED',
          'SELLER_STATUS_CHANGED',
        ].sort(),
      );
    });

    it('parseWebhook odrzuca zmanipulowaną treść, podpis, brak podpisu i stary webhook', async () => {
      const [sample] = await harness.webhookSamples();
      if (sample === undefined) {
        throw new Error('Uprząż nie dała próbek webhooków');
      }
      // Jeden bit w środku treści (np. cyfra kwoty albo litera ID).
      const tamperedBody = Buffer.from(sample.request.rawBody);
      const middle = Math.floor(tamperedBody.length / 2);
      tamperedBody.writeUInt8((tamperedBody.readUInt8(middle) ^ 1) & 0xff, middle);
      const tamperedHeaders = Object.fromEntries(
        Object.entries(sample.request.headers).map(([key, value]) => [
          key,
          typeof value === 'string'
            ? `${value.slice(0, -1)}${value.endsWith('0') ? '1' : '0'}`
            : value,
        ]),
      );
      const cases: [string, RawWebhookRequest][] = [
        ['zmieniona treść', { headers: sample.request.headers, rawBody: tamperedBody }],
        ['zmieniony podpis', { headers: tamperedHeaders, rawBody: sample.request.rawBody }],
        ['bez nagłówków', { headers: {}, rawBody: sample.request.rawBody }],
        ['stary webhook', await harness.staleWebhook()],
      ];
      for (const [label, request] of cases) {
        expect(await gatewayError(gateway.parseWebhook(request)), label).toBe('INVALID_SIGNATURE');
      }
    });
  });
}

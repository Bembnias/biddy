// Wspólny zestaw testów kontraktowych portu ShippingProvider (F-24, PROJECT.md §8.1). Musi go
// przejść każdy adapter: FakeShipping na każdym PR (test/integration/shipping-contract.int.test.ts),
// Furgonetka na swoim sandboksie, gdy są dane dostępu. Zestaw sprawdza zachowanie widoczne dla
// domeny Biddy; to, czego nie da się zrobić tak samo u każdego dostawcy (przesunięcie statusu,
// podpisany webhook), dostarcza adapterowa „uprząż”.
import { beforeAll, describe, expect, it } from 'vitest';

import { newId } from '../../src/infra/db/index.js';
import type { ShipmentParty } from '../../src/modules/shipping/db/shipping.schema.js';
import {
  type CarrierConfig,
  type CreateShipmentInput,
  isShippingProviderError,
  type RawWebhookRequest,
  type ShippingProvider,
  type ShippingProviderErrorCode,
} from '../../src/modules/shipping/ports/shipping-provider.port.js';
import type { TrackingStatus } from '../../src/modules/shipping/domain/shipping-values.js';

export interface ShippingContractHarness {
  readonly provider: ShippingProvider;
  /** Usługa paczkomatowa z kodami tego dostawcy. */
  readonly locker: CarrierConfig;
  /** Punkt odbioru, który dostawca zna (np. paczkomat testowy). */
  readonly pointId: string;
  /** Przesuwa przesyłkę u dostawcy do statusu „w drodze” (sandbox albo symulator). */
  moveInTransit(providerShipmentId: string): Promise<void>;
  /** Poprawnie podpisany webhook o przesyłce. */
  webhook(providerShipmentId: string): Promise<RawWebhookRequest>;
}

async function providerError(
  operation: Promise<unknown>,
): Promise<ShippingProviderErrorCode | 'BRAK BŁĘDU'> {
  try {
    await operation;
  } catch (error) {
    if (isShippingProviderError(error)) {
      return error.code;
    }
    throw error;
  }
  return 'BRAK BŁĘDU';
}

const sender: ShipmentParty = {
  name: 'Anna Kontraktowa',
  phone: '+48500600700',
  email: 'anna@example.com',
  address: { street: 'ul. Prosta 1', postalCode: '00-001', city: 'Warszawa', countryCode: 'PL' },
};

const recipient: ShipmentParty = {
  name: 'Jan Kontraktowy',
  phone: '+48600700800',
  email: 'jan@example.com',
  address: null,
};

/** Zestaw testów kontraktowych dla adaptera z `setup` (uruchamiany raz na plik). */
export function describeShippingProviderContract(
  name: string,
  setup: () => Promise<ShippingContractHarness>,
): void {
  describe(`Kontrakt ShippingProvider: ${name}`, () => {
    let harness: ShippingContractHarness;
    let provider: ShippingProvider;

    beforeAll(async () => {
      harness = await setup();
      provider = harness.provider;
    });

    function input(overrides: Partial<CreateShipmentInput> = {}): CreateShipmentInput {
      return {
        idempotencyKey: `contract:${newId()}:1`,
        carrier: harness.locker,
        packageSize: 'M',
        parcel: { weightGrams: 2_000, dimensionsCm: null },
        declaredValue: { amount: 10_000, currency: 'PLN' },
        sender,
        recipient,
        pickupPointId: harness.pointId,
        dispatchMethod: 'DROP_OFF',
        reference: 'contract1',
        ...overrides,
      };
    }

    it('obsługuje nadanie w punkcie (DROP_OFF)', () => {
      expect(provider.capabilities.dispatchMethods).toContain('DROP_OFF');
    });

    it('findPoints: punkty usługi z ID i adresem; pointId zwraca ten punkt', async () => {
      const points = await provider.findPoints({
        carrier: harness.locker,
        phrase: 'Warszawa',
        limit: 5,
      });
      expect(points.length).toBeGreaterThan(0);
      expect(points.length).toBeLessThanOrEqual(5);
      for (const point of points) {
        expect(point.id).not.toBe('');
        expect(point.address).not.toBe('');
      }
      const one = await provider.findPoints({
        carrier: harness.locker,
        pointId: harness.pointId,
        limit: 1,
      });
      expect(one.map((point) => point.id)).toEqual([harness.pointId]);
    });

    it('createShipment: ten sam klucz zwraca tę samą przesyłkę z numerem', async () => {
      const shipment = input();
      const first = await provider.createShipment(shipment);
      const again = await provider.createShipment(shipment);
      expect(first.providerShipmentId).not.toBe('');
      expect(first.trackingNumber).not.toBe('');
      expect(again).toEqual(first);
      const other = await provider.createShipment(input());
      expect(other.providerShipmentId).not.toBe(first.providerShipmentId);
    });

    it('getLabel: PDF (albo null, gdy jeszcze niegotowa); nieznana przesyłka to NOT_FOUND', async () => {
      const created = await provider.createShipment(input());
      const label = await provider.getLabel(created.providerShipmentId);
      if (label !== null) {
        expect(label.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      }
      expect(await providerError(provider.getLabel('nie-ma-takiej-przesylki'))).toBe('NOT_FOUND');
    });

    it('getTracking: zdarzenia rosnąco w czasie ze statusami Biddy, po nadaniu „w drodze”', async () => {
      const created = await provider.createShipment(input());
      await harness.moveInTransit(created.providerShipmentId);
      const events = await provider.getTracking(created.providerShipmentId);
      const statuses: TrackingStatus[] = events.map((event) => event.status);
      expect(statuses).toContain('IN_TRANSIT');
      const times = events.map((event) => event.occurredAt.getTime());
      expect(times).toEqual([...times].sort((left, right) => left - right));
      for (const event of events) {
        expect(event.rawStatus).not.toBe('');
      }
    });

    it('cancelShipment: przesyłka przed nadaniem ma potem status CANCELLED', async () => {
      const created = await provider.createShipment(input());
      await provider.cancelShipment(created.providerShipmentId);
      const events = await provider.getTracking(created.providerShipmentId);
      expect(events.at(-1)?.status).toBe('CANCELLED');
    });

    it('parseWebhook: poprawny wskazuje przesyłkę, zmieniony bajt to INVALID_SIGNATURE', async () => {
      const created = await provider.createShipment(input());
      const webhook = await harness.webhook(created.providerShipmentId);
      await expect(provider.parseWebhook(webhook)).resolves.toEqual({
        providerShipmentIds: [created.providerShipmentId],
      });
      const tampered = Buffer.from(webhook.rawBody);
      tampered.writeUInt8(tampered.readUInt8(tampered.length - 3) ^ 1, tampered.length - 3);
      expect(await providerError(provider.parseWebhook({ ...webhook, rawBody: tampered }))).toBe(
        'INVALID_SIGNATURE',
      );
    });
  });
}

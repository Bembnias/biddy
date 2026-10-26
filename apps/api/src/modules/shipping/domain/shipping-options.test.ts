import { describe, expect, it } from 'vitest';

import {
  type CarrierLimits,
  type ParcelSpec,
  cheapestOption,
  fitsCarrier,
  girthCm,
  shippingOptions,
} from './shipping-options.js';

const locker: CarrierLimits = {
  id: 'inpost-paczkomat',
  name: 'InPost Paczkomat 24/7',
  kind: 'LOCKER',
  packageSizes: ['S', 'M', 'L'],
  dispatchMethods: ['DROP_OFF'],
  maxWeightGrams: null,
  maxLengthCm: null,
  maxGirthCm: null,
};

const courier: CarrierLimits = {
  id: 'dpd-kurier',
  name: 'DPD Kurier',
  kind: 'COURIER',
  packageSizes: ['S', 'M', 'L', 'XL'],
  dispatchMethods: ['DROP_OFF', 'COURIER_PICKUP'],
  maxWeightGrams: 31_500,
  maxLengthCm: 175,
  maxGirthCm: 300,
};

const point: CarrierLimits = {
  ...locker,
  id: 'orlen-paczka',
  name: 'Orlen Paczka',
  kind: 'PICKUP_POINT',
};

function parcel(overrides: Partial<ParcelSpec> = {}): ParcelSpec {
  return {
    packageSize: 'M',
    weightGrams: null,
    dimensionsCm: null,
    allowedCarriers: ['inpost-paczkomat', 'dpd-kurier', 'orlen-paczka'],
    ...overrides,
  };
}

const prices = new Map([
  ['inpost-paczkomat', 1_399],
  ['dpd-kurier', 1_899],
  ['orlen-paczka', 1_099],
]);

describe('girthCm', () => {
  it('najdłuższy bok + 2 × pozostałe, niezależnie od kolejności', () => {
    expect(girthCm({ length: 40, width: 100, height: 30 })).toBe(100 + 2 * (40 + 30));
  });
});

describe('fitsCarrier (§8.2)', () => {
  it('S, M i L: wystarczy gabaryt obsługiwany przez usługę (bez sprawdzania wagi)', () => {
    expect(fitsCarrier(locker, parcel({ packageSize: 'L', weightGrams: 24_000 }))).toBe(true);
    expect(fitsCarrier(locker, parcel({ packageSize: 'XL' }))).toBe(false);
    expect(fitsCarrier(locker, parcel({ packageSize: null }))).toBe(false);
  });

  it('XL: waga, najdłuższy bok i obwód w limitach usługi', () => {
    const xl = (weightGrams: number, length: number, width = 50, height = 40) =>
      parcel({ packageSize: 'XL', weightGrams, dimensionsCm: { length, width, height } });
    expect(fitsCarrier(courier, xl(31_500, 175, 30, 20))).toBe(true);
    expect(fitsCarrier(courier, xl(31_501, 80))).toBe(false);
    expect(fitsCarrier(courier, xl(10_000, 176, 10, 10))).toBe(false);
    // 120 + 2 × (50 + 40) = 300: na granicy; 301 już nie.
    expect(fitsCarrier(courier, xl(10_000, 120, 50, 40))).toBe(true);
    expect(fitsCarrier(courier, xl(10_000, 120, 50, 41))).toBe(false);
  });

  it('XL bez wagi albo wymiarów nie pasuje do usługi z limitami, a do usługi bez limitów tak', () => {
    expect(fitsCarrier(courier, parcel({ packageSize: 'XL' }))).toBe(false);
    const unlimited = { ...courier, maxWeightGrams: null, maxLengthCm: null, maxGirthCm: null };
    expect(fitsCarrier(unlimited, parcel({ packageSize: 'XL' }))).toBe(true);
  });
});

describe('shippingOptions', () => {
  it('tylko usługi zaakceptowane przez sprzedającego, pasujące i z ceną; kolejność z konfiguracji', () => {
    const options = shippingOptions(
      [locker, courier, point],
      prices,
      parcel({ allowedCarriers: ['orlen-paczka', 'dpd-kurier'] }),
    );
    expect(options.map((option) => option.carrierId)).toEqual(['dpd-kurier', 'orlen-paczka']);
    expect(options[0]).toEqual({
      carrierId: 'dpd-kurier',
      name: 'DPD Kurier',
      kind: 'COURIER',
      price: 1_899,
      dispatchMethods: ['DROP_OFF', 'COURIER_PICKUP'],
      requiresPickupPoint: false,
    });
    expect(options[1]?.requiresPickupPoint).toBe(true);
  });

  it('usługa bez ceny w cenniku znika (np. nowy przewoźnik przed ustaleniem stawek)', () => {
    const withoutLocker = new Map([...prices].filter(([id]) => id !== 'inpost-paczkomat'));
    expect(
      shippingOptions([locker, courier], withoutLocker, parcel()).map((option) => option.carrierId),
    ).toEqual(['dpd-kurier']);
  });

  it('XL: tylko kurier w limitach; najtańsza opcja to „dostawa od”', () => {
    const xl = parcel({
      packageSize: 'XL',
      weightGrams: 12_000,
      dimensionsCm: { length: 80, width: 50, height: 40 },
    });
    const options = shippingOptions([locker, courier, point], prices, xl);
    expect(options.map((option) => option.carrierId)).toEqual(['dpd-kurier']);
    expect(cheapestOption(shippingOptions([locker, courier, point], prices, parcel()))?.price).toBe(
      1_099,
    );
    expect(cheapestOption([])).toBeUndefined();
  });
});

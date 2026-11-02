// Opcje dostawy dla przedmiotu (F-24, PROJECT.md §8.2): które usługi pasują do paczki i ile
// kosztują według cennika Biddy. Czysta logika bez bazy, więc testy jednostkowe sprawdzają
// wszystkie przypadki brzegowe gabarytów.
import type { PackageSize } from '@biddy/shared';

import type { CarrierKind } from '../db/shipping.schema.js';
import type { DispatchMethod } from './shipping-values.js';

/** Paczka przedmiotu (snapshot z zamówienia albo przedmiot na stronie aukcji). */
export interface ParcelSpec {
  readonly packageSize: PackageSize | null;
  readonly weightGrams: number | null;
  readonly dimensionsCm: {
    readonly length: number;
    readonly width: number;
    readonly height: number;
  } | null;
  /** Usługi zaakceptowane przez sprzedającego. */
  readonly allowedCarriers: readonly string[];
}

/** Usługa z konfiguracji, z limitami gabarytu XL. */
export interface CarrierLimits {
  readonly id: string;
  readonly name: string;
  readonly kind: CarrierKind;
  readonly packageSizes: readonly PackageSize[];
  readonly dispatchMethods: readonly DispatchMethod[];
  readonly maxWeightGrams: number | null;
  readonly maxLengthCm: number | null;
  readonly maxGirthCm: number | null;
}

export interface ShippingOption {
  readonly carrierId: string;
  readonly name: string;
  readonly kind: CarrierKind;
  /** Cena dla kupującego w groszach. */
  readonly price: number;
  readonly dispatchMethods: readonly DispatchMethod[];
  /** Paczkomat i punkt wymagają wyboru punktu, kurier adresu. */
  readonly requiresPickupPoint: boolean;
}

/** Obwód paczki: najdłuższy bok + 2 × pozostałe (jak u kurierów). */
export function girthCm(dimensions: NonNullable<ParcelSpec['dimensionsCm']>): number {
  const sides = [dimensions.length, dimensions.width, dimensions.height].sort((a, b) => b - a);
  const [longest = 0, second = 0, third = 0] = sides;
  return longest + 2 * (second + third);
}

/**
 * Czy usługa przyjmie paczkę. S, M i L ogranicza sam gabaryt (limit 25 kg pilnuje kreator).
 * XL musi zmieścić się w limitach usługi; brak wagi albo wymiarów w przedmiocie wyklucza
 * usługę, która ma limit.
 */
export function fitsCarrier(carrier: CarrierLimits, parcel: ParcelSpec): boolean {
  const size = parcel.packageSize;
  if (size === null || !carrier.packageSizes.includes(size)) {
    return false;
  }
  if (size !== 'XL') {
    return true;
  }
  if (carrier.maxWeightGrams !== null) {
    if (parcel.weightGrams === null || parcel.weightGrams > carrier.maxWeightGrams) {
      return false;
    }
  }
  if (carrier.maxLengthCm !== null || carrier.maxGirthCm !== null) {
    const dimensions = parcel.dimensionsCm;
    if (dimensions === null) {
      return false;
    }
    const longest = Math.max(dimensions.length, dimensions.width, dimensions.height);
    if (carrier.maxLengthCm !== null && longest > carrier.maxLengthCm) {
      return false;
    }
    if (carrier.maxGirthCm !== null && girthCm(dimensions) > carrier.maxGirthCm) {
      return false;
    }
  }
  return true;
}

/**
 * Opcje dostawy w kolejności usług: zaakceptowane przez sprzedającego, pasujące do paczki
 * i z ceną w cenniku (`prices`: usługa → cena dla gabarytu paczki).
 */
export function shippingOptions(
  carriers: readonly CarrierLimits[],
  prices: ReadonlyMap<string, number>,
  parcel: ParcelSpec,
): ShippingOption[] {
  const allowed = new Set(parcel.allowedCarriers);
  return carriers.flatMap((carrier) => {
    const price = prices.get(carrier.id);
    if (!allowed.has(carrier.id) || price === undefined || !fitsCarrier(carrier, parcel)) {
      return [];
    }
    return [
      {
        carrierId: carrier.id,
        name: carrier.name,
        kind: carrier.kind,
        price,
        dispatchMethods: carrier.dispatchMethods,
        requiresPickupPoint: carrier.kind !== 'COURIER',
      },
    ];
  });
}

/** Najtańsza opcja („dostawa od”); undefined, gdy nie ma żadnej. */
export function cheapestOption(options: readonly ShippingOption[]): ShippingOption | undefined {
  return options.reduce<ShippingOption | undefined>(
    (best, option) => (best === undefined || option.price < best.price ? option : best),
    undefined,
  );
}

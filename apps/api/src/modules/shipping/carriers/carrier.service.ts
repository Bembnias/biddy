// Przewoźnicy i obsługiwane gabaryty (F-14, PROJECT.md §8.2) z konfiguracją nadania, limitami
// XL i kodami usług u dostawców (F-24). Kilka wierszy konfiguracji, czytanych przy każdym
// użyciu (bez cache w procesie, żeby zmiana w bazie działała od razu).
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { type ShippingCarrier, shippingCarriers } from '../db/shipping.schema.js';

export type Carrier = Pick<ShippingCarrier, 'id' | 'name' | 'kind' | 'packageSizes'>;

/** Pełna konfiguracja usługi (opcje dostawy, nadanie, adaptery). */
export type CarrierConfigRow = Omit<ShippingCarrier, 'position' | 'isActive'>;

const configColumns = {
  id: shippingCarriers.id,
  name: shippingCarriers.name,
  kind: shippingCarriers.kind,
  packageSizes: shippingCarriers.packageSizes,
  dispatchMethods: shippingCarriers.dispatchMethods,
  maxWeightGrams: shippingCarriers.maxWeightGrams,
  maxLengthCm: shippingCarriers.maxLengthCm,
  maxGirthCm: shippingCarriers.maxGirthCm,
  providerCodes: shippingCarriers.providerCodes,
};

@Injectable()
export class CarrierService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Aktywni przewoźnicy w kolejności wyświetlania. */
  async list(): Promise<Carrier[]> {
    return this.db
      .select({
        id: shippingCarriers.id,
        name: shippingCarriers.name,
        kind: shippingCarriers.kind,
        packageSizes: shippingCarriers.packageSizes,
      })
      .from(shippingCarriers)
      .where(eq(shippingCarriers.isActive, true))
      .orderBy(asc(shippingCarriers.position), asc(shippingCarriers.id));
  }

  /** Aktywne usługi z pełną konfiguracją, w kolejności wyświetlania. */
  async configs(): Promise<CarrierConfigRow[]> {
    return this.db
      .select(configColumns)
      .from(shippingCarriers)
      .where(eq(shippingCarriers.isActive, true))
      .orderBy(asc(shippingCarriers.position), asc(shippingCarriers.id));
  }

  /** Usługa po identyfikatorze, także nieaktywna (przesyłki sprzed wyłączenia usługi). */
  async config(id: string): Promise<CarrierConfigRow | undefined> {
    const [row] = await this.db
      .select(configColumns)
      .from(shippingCarriers)
      .where(eq(shippingCarriers.id, id));
    return row;
  }
}

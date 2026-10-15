// Przewoźnicy i obsługiwane gabaryty (F-14, PROJECT.md §8.2). Kilka wierszy konfiguracji,
// czytanych przy każdym użyciu (bez cache w procesie, żeby zmiana w bazie działała od razu).
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { type ShippingCarrier, shippingCarriers } from '../db/shipping.schema.js';

export type Carrier = Pick<ShippingCarrier, 'id' | 'name' | 'kind' | 'packageSizes'>;

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
}

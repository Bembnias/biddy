// Opcje dostawy z cenami (F-24, PROJECT.md §8.2): usługi zaakceptowane przez sprzedającego,
// pasujące do paczki i z ceną w cenniku Biddy na dany dzień. Cena dla kupującego pochodzi
// z cennika, a nie z wyceny dostawcy na żywo (koszt u dostawcy zapisuje przesyłka).
import type { CurrencyCode, PackageSize } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, lte, or } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { CarrierService } from '../carriers/carrier.service.js';
import { shippingRates } from '../db/shipping.schema.js';
import {
  type ParcelSpec,
  type ShippingOption,
  cheapestOption,
  shippingOptions,
} from '../domain/shipping-options.js';

export type { ParcelSpec, ShippingOption } from '../domain/shipping-options.js';

@Injectable()
export class ShippingQuoteService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CarrierService) private readonly carriers: CarrierService,
  ) {}

  /** Opcje dostawy dla paczki w kolejności usług; pusta lista, gdy nic nie pasuje. */
  async options(
    parcel: ParcelSpec,
    currency: CurrencyCode,
    at: Date = new Date(),
  ): Promise<ShippingOption[]> {
    if (parcel.packageSize === null || parcel.allowedCarriers.length === 0) {
      return [];
    }
    const [configs, prices] = await Promise.all([
      this.carriers.configs(),
      this.prices(parcel.packageSize, currency, at),
    ]);
    return shippingOptions(configs, prices, parcel);
  }

  /** Jedna opcja (wybór kupującego); undefined, gdy usługa nie pasuje albo nie ma ceny. */
  async option(
    parcel: ParcelSpec,
    currency: CurrencyCode,
    carrierId: string,
    at: Date = new Date(),
  ): Promise<ShippingOption | undefined> {
    const options = await this.options(parcel, currency, at);
    return options.find((option) => option.carrierId === carrierId);
  }

  /** Najtańsza opcja („dostawa od”). */
  async cheapest(
    parcel: ParcelSpec,
    currency: CurrencyCode,
    at: Date = new Date(),
  ): Promise<ShippingOption | undefined> {
    return cheapestOption(await this.options(parcel, currency, at));
  }

  /** Ceny usług dla gabarytu w cenniku obowiązującym w chwili `at`. */
  private async prices(
    packageSize: PackageSize,
    currency: CurrencyCode,
    at: Date,
  ): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ carrierId: shippingRates.carrierId, price: shippingRates.price })
      .from(shippingRates)
      .where(
        and(
          eq(shippingRates.packageSize, packageSize),
          eq(shippingRates.currency, currency),
          lte(shippingRates.validFrom, at),
          or(isNull(shippingRates.validTo), gt(shippingRates.validTo, at)),
        ),
      );
    return new Map(rows.map((row) => [row.carrierId, row.price]));
  }
}

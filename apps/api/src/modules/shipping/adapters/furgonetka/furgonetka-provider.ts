// Adapter Furgonetki (F-24, PROJECT.md §8.1): agregator, który daje wielu przewoźników przez
// jedną integrację. Przesyłkę tworzy komenda `create-package-command`, zamawia
// `order-commands` (obie z UUID z naszego klucza, więc bez duplikatów), numer i koszt czytamy
// z `GET /packages/{id}`. Biddy jest zleceniodawcą i płatnikiem, nadawcą sprzedający (§8.3).
//
// W F-24 adapter zleca tylko nadanie w punkcie (DROP_OFF); zamówienie kuriera po paczkę
// (`pickup-commands`) to otwarte pytanie w specyfikacji. Zachowania niepotwierdzone na
// sandboksie są opisane w spec F-24 („Otwarte pytania”).
import type { PackageSize } from '@biddy/shared';
import { Logger } from '@nestjs/common';

import type { ShipmentParty } from '../../db/shipping.schema.js';
import {
  type CarrierConfig,
  type CreatedShipment,
  type CreateShipmentInput,
  type PickupPoint,
  type PickupPointQuery,
  type RawWebhookRequest,
  type ShippingProvider,
  type ShippingProviderCapabilities,
  ShippingProviderError,
  type TrackingEvent,
  type WebhookHint,
} from '../../ports/shipping-provider.port.js';
import type { FurgonetkaClient } from './furgonetka-client.js';
import {
  asRecord,
  commandUuid,
  type FurgonetkaTrackingEntry,
  mapFurgonetkaTracking,
  parseFurgonetkaDate,
  verifyFurgonetkaChecksum,
} from './furgonetka-format.js';

/** Lista usług konta (umów) czytana najwyżej raz na godzinę. */
const SERVICES_TTL_MS = 60 * 60 * 1000;

/** Wymiary i waga, gdy przedmiot ich nie ma: maksimum gabarytu paczkomatowego (§8.2). */
const DEFAULT_PARCELS: Readonly<
  Record<PackageSize, { width: number; depth: number; height: number; weightKg: number }>
> = {
  S: { width: 38, depth: 64, height: 8, weightKg: 2 },
  M: { width: 38, depth: 64, height: 19, weightKg: 5 },
  L: { width: 38, depth: 64, height: 41, weightKg: 10 },
  XL: { width: 50, depth: 80, height: 50, weightKg: 20 },
};

const WEEKDAYS = [
  ['monday', 'pn'],
  ['tuesday', 'wt'],
  ['wednesday', 'śr'],
  ['thursday', 'czw'],
  ['friday', 'pt'],
  ['saturday', 'sob'],
  ['sunday', 'nd'],
] as const;

interface AccountService {
  readonly id: number;
  readonly service: string;
  readonly owner: string;
}

function string(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  if (typeof value === 'number') {
    return String(value);
  }
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function number(data: Record<string, unknown>, key: string): number | undefined {
  const value = data[key];
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined;
}

/** Telefon w zapisie krajowym (Furgonetka i przewoźnicy oczekują 9 cyfr bez +48). */
function nationalPhone(phone: string): string {
  return phone.replace(/^\+48/u, '');
}

function serviceCode(carrier: CarrierConfig): string {
  const code = carrier.providerCodes.furgonetka;
  if (code === undefined) {
    throw new ShippingProviderError(
      'UNSUPPORTED',
      `Usługa ${carrier.id} nie jest dostępna przez Furgonetkę.`,
    );
  }
  return code;
}

function partyBody(party: ShipmentParty): Record<string, unknown> {
  return {
    name: party.name,
    phone: nationalPhone(party.phone),
    ...(party.email === null ? {} : { email: party.email }),
    ...(party.address === null
      ? {}
      : {
          street: party.address.street,
          postcode: party.address.postalCode,
          city: party.address.city,
          country_code: party.address.countryCode,
        }),
  };
}

/** Godziny otwarcia jednym tekstem: kolejne dni z tymi samymi godzinami razem. */
function openingHours(value: unknown): string | null {
  const hours = asRecord(value);
  const days = WEEKDAYS.map(([key, label]) => {
    const day = asRecord(hours[key]);
    const start = string(day, 'start_hour');
    const end = string(day, 'end_hour');
    return { label, range: start === undefined || end === undefined ? null : `${start}–${end}` };
  });
  if (days.every((day) => day.range === null)) {
    return null;
  }
  if (days.every((day) => day.range === '00:00–23:59' || day.range === '00:00–24:00')) {
    return '24/7';
  }
  const groups: { from: string; to: string; range: string; last: number }[] = [];
  days.forEach((day, index) => {
    if (day.range === null) {
      return;
    }
    const previous = groups.at(-1);
    if (previous !== undefined && previous.range === day.range && previous.last === index - 1) {
      previous.to = day.label;
      previous.last = index;
    } else {
      groups.push({ from: day.label, to: day.label, range: day.range, last: index });
    }
  });
  return groups
    .map(
      (group) =>
        `${group.from === group.to ? group.from : `${group.from}–${group.to}`} ${group.range}`,
    )
    .join(', ');
}

export class FurgonetkaProvider implements ShippingProvider {
  readonly provider = 'furgonetka' as const;
  readonly capabilities: ShippingProviderCapabilities = { dispatchMethods: ['DROP_OFF'] };

  private readonly logger = new Logger('FurgonetkaProvider');
  private services: { readonly at: number; readonly list: readonly AccountService[] } | undefined;

  constructor(
    private readonly client: FurgonetkaClient,
    private readonly webhookToken: string,
  ) {}

  async findPoints(query: PickupPointQuery): Promise<PickupPoint[]> {
    const location =
      query.near !== undefined
        ? { coordinates: { latitude: query.near.lat, longitude: query.near.lng } }
        : // Bez miejsca Furgonetka odpowiada 404 (/location); punkt po ID szukamy też frazą.
          { search_phrase: query.phrase ?? query.pointId ?? 'Warszawa' };
    const body = asRecord(
      await this.client.json('POST', '/points/map', {
        version: 1,
        body: {
          location,
          filters: {
            services: [serviceCode(query.carrier)],
            ...(query.pointId === undefined ? {} : { point_id: query.pointId }),
            limit: query.limit,
          },
        },
      }),
    );
    const points = Array.isArray(body['points']) ? body['points'] : [];
    return points.flatMap((entry): PickupPoint[] => {
      const point = asRecord(entry);
      const id = string(point, 'code') ?? string(point, 'point_id');
      if (id === undefined || point['active'] === false || point['is_delivery_point'] === false) {
        return [];
      }
      const address = asRecord(point['address']);
      const coordinates = asRecord(point['coordinates']);
      const lat = number(coordinates, 'latitude');
      const lng = number(coordinates, 'longitude');
      const distanceKm = number(point, 'distance');
      return [
        {
          id,
          name: string(point, 'name') ?? id,
          address: [
            string(address, 'street'),
            [string(address, 'postcode'), string(address, 'city')].filter(Boolean).join(' '),
          ]
            .filter((part) => part !== undefined && part !== '')
            .join(', '),
          location: lat === undefined || lng === undefined ? null : { lat, lng },
          // Odległość w kilometrach (jak points_max_distance).
          distanceMeters: distanceKm === undefined ? null : Math.round(distanceKm * 1000),
          openingHours: openingHours(point['opening_hours']),
        },
      ];
    });
  }

  async createShipment(input: CreateShipmentInput): Promise<CreatedShipment> {
    if (input.dispatchMethod !== 'DROP_OFF') {
      throw new ShippingProviderError(
        'UNSUPPORTED',
        'Zamówienie kuriera po paczkę nie jest jeszcze dostępne. Wybierz nadanie w punkcie.',
      );
    }
    const serviceId = await this.serviceId(serviceCode(input.carrier));
    const defaults = DEFAULT_PARCELS[input.packageSize];
    const dimensions = input.parcel.dimensionsCm;
    const created = await this.client.command(
      'create-package-command',
      commandUuid(`${input.idempotencyKey}:create`),
      {
        service_id: serviceId,
        pickup: partyBody(input.sender),
        receiver: {
          ...partyBody(input.recipient),
          ...(input.pickupPointId === null ? {} : { point: input.pickupPointId }),
        },
        parcels: [
          {
            type: 'package',
            width: dimensions?.width ?? defaults.width,
            depth: dimensions?.length ?? defaults.depth,
            height: dimensions?.height ?? defaults.height,
            weight: (input.parcel.weightGrams ?? defaults.weightKg * 1000) / 1000,
            ...(input.declaredValue === null ? {} : { value: input.declaredValue.amount / 100 }),
            description: 'Przedmiot z Biddy',
          },
        ],
        ...(input.reference === null ? {} : { user_reference_number: input.reference }),
      },
      2,
    );
    const packageId = string(created.data, 'package_id');
    if (created.status !== 'successful' || packageId === undefined) {
      throw this.client.rejection(created.errors);
    }
    const ordered = await this.client.command(
      'order-commands',
      commandUuid(`${input.idempotencyKey}:order`),
      { packages: [{ id: packageId }] },
      1,
    );
    if (ordered.status !== 'successful') {
      throw this.client.rejection(ordered.errors);
    }
    const shipment = asRecord(
      await this.client.json('GET', `/packages/${packageId}`, { version: 2 }),
    );
    const parcels = Array.isArray(shipment['parcels']) ? shipment['parcels'] : [];
    const trackingNumber = string(asRecord(parcels[0]), 'package_no');
    if (trackingNumber === undefined) {
      throw new ShippingProviderError(
        'UNAVAILABLE',
        `Furgonetka: przesyłka ${packageId} zamówiona bez numeru listu przewozowego`,
      );
    }
    const gross = number(asRecord(shipment['pricing']), 'price_gross');
    return {
      providerShipmentId: packageId,
      trackingNumber,
      // Kod nadania bez etykiety przez Furgonetkę: otwarte pytanie (spec F-24).
      dropoffCode: null,
      cost: gross === undefined ? null : { amount: Math.round(gross * 100), currency: 'PLN' },
    };
  }

  async getLabel(providerShipmentId: string): Promise<Buffer | null> {
    const response = await this.client.send('GET', `/packages/${providerShipmentId}/label`, {
      version: 1,
      accept: 'application/pdf',
    });
    if (response.status === 204) {
      return null;
    }
    if (response.status === 404) {
      throw new ShippingProviderError(
        'NOT_FOUND',
        `Furgonetka: brak etykiety przesyłki ${providerShipmentId} (anulowana albo nieznana)`,
      );
    }
    if (response.status !== 200 || !response.contentType.includes('pdf')) {
      throw new ShippingProviderError(
        'UNAVAILABLE',
        `Furgonetka: nieoczekiwana odpowiedź etykiety (HTTP ${response.status}, ${response.contentType})`,
      );
    }
    return response.bytes;
  }

  async getTracking(providerShipmentId: string): Promise<TrackingEvent[]> {
    const body = asRecord(
      await this.client.json('GET', `/packages/${providerShipmentId}/tracking`, { version: 2 }),
    );
    const entries: FurgonetkaTrackingEntry[] = Object.values(asRecord(body['parcels'])).flatMap(
      (parcel) => {
        const tracking = asRecord(parcel)['tracking'];
        return (Array.isArray(tracking) ? tracking : []).flatMap((entry) => {
          const event = asRecord(entry);
          const state = string(event, 'state');
          const occurredAt = parseFurgonetkaDate(event['datetime']);
          return state === undefined || occurredAt === undefined
            ? []
            : [{ state, description: string(event, 'status') ?? null, occurredAt }];
        });
      },
    );
    return mapFurgonetkaTracking(entries, (state) => {
      this.logger.warn({ providerShipmentId, state }, 'Furgonetka: nieznany stan trackingu');
    });
  }

  async cancelShipment(providerShipmentId: string): Promise<void> {
    const result = await this.client.command(
      'cancel-command',
      commandUuid(`cancel:${providerShipmentId}`),
      { packages: [{ id: providerShipmentId }] },
      1,
    );
    if (result.status !== 'successful') {
      throw this.client.rejection(result.errors);
    }
  }

  parseWebhook(request: RawWebhookRequest): Promise<WebhookHint> {
    return Promise.resolve().then(() => {
      let payload: Record<string, unknown>;
      try {
        payload = asRecord(JSON.parse(request.rawBody.toString('utf8')));
      } catch (error) {
        throw new ShippingProviderError('INVALID_REQUEST', 'Webhook nie jest poprawnym JSON-em', {
          cause: error,
        });
      }
      if (!verifyFurgonetkaChecksum(payload, this.webhookToken)) {
        throw new ShippingProviderError(
          'INVALID_SIGNATURE',
          'Suma kontrolna webhooka Furgonetki nie zgadza się',
        );
      }
      const packageId = string(payload, 'package_id');
      return { providerShipmentIds: packageId === undefined ? [] : [packageId] };
    });
  }

  /** ID umowy (usługi) konta dla przewoźnika; umowa Furgonetki ma pierwszeństwo przed własną. */
  private async serviceId(code: string): Promise<number> {
    if (this.services === undefined || Date.now() - this.services.at > SERVICES_TTL_MS) {
      const body = asRecord(await this.client.json('GET', '/account/services', { version: 1 }));
      const list = (Array.isArray(body['services']) ? body['services'] : []).flatMap((entry) => {
        const service = asRecord(entry);
        const id = number(service, 'id');
        const carrier = string(service, 'service');
        return id === undefined || carrier === undefined
          ? []
          : [{ id, service: carrier, owner: string(service, 'owner') ?? '' }];
      });
      this.services = { at: Date.now(), list };
    }
    const matching = this.services.list.filter((service) => service.service === code);
    const chosen = matching.find((service) => service.owner === 'furgonetka') ?? matching[0];
    if (chosen === undefined) {
      throw new ShippingProviderError(
        'UNSUPPORTED',
        `Konto Furgonetki nie ma usługi przewoźnika ${code}.`,
      );
    }
    return chosen.id;
  }
}

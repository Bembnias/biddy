// FakeShippingProvider (F-24, PROJECT.md §8): adapter testowy portu ShippingProvider ze stanem
// w Postgresie. Tworzy przesyłkę z numerem, kodem nadania (paczkomat, punkt) i etykietą PDF,
// prowadzi tracking według scenariusza (automat albo panel) i wysyła podpisane webhooki.
// Działa tylko poza produkcją (rejestr dostaje go według DEPLOYMENT_ENV).
//
// Magiczne dane do testów ścieżek błędów:
// - telefon nadawcy +48500000000: dostawca odrzuca dane (INVALID_REQUEST, pole sender.phone);
// - telefon nadawcy +48500000001: dostawca niedostępny (UNAVAILABLE) przy każdej próbie.
import { createHash, randomInt } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';

import { APP_CONFIG, type AppConfig } from '../../../../infra/config/index.js';
import { type Database, DRIZZLE, newId } from '../../../../infra/db/index.js';
import {
  type FakeParcelRequest,
  fakeShippingParcels,
  fakeShippingTracking,
} from '../../db/fake-shipping.schema.js';
import type { ShipmentParty } from '../../db/shipping.schema.js';
import {
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
import {
  FAKE_STATUS_DESCRIPTIONS,
  FAKE_STATUS_MAP,
  parseFakeShippingWebhook,
  scenarioForPoint,
} from './fake-shipping-format.js';
import { fakeLabelPdf } from './fake-shipping-label.js';
import { fakePickupPoints } from './fake-shipping-points.js';
import { FAKE_SHIPPING_SCHEDULE, type FakeShippingSchedule } from './fake-shipping-schedule.js';

/** Telefon nadawcy, który FakeShipping odrzuca (test błędu danych). */
export const FAKE_REJECTED_PHONE = '+48500000000';
/** Telefon nadawcy, przy którym FakeShipping jest „niedostępny” (test ponowień). */
export const FAKE_UNAVAILABLE_PHONE = '+48500000001';

/** Koszt FakeShipping per gabaryt (grosze), żeby przesyłka miała `cost` jak u dostawcy. */
const FAKE_COSTS = { S: 899, M: 999, L: 1199, XL: 2499 } as const;

function digits(count: number): string {
  return Array.from({ length: count }, () => String(randomInt(10))).join('');
}

function partyLine(party: ShipmentParty): string {
  const address = party.address;
  return address === null
    ? party.name
    : `${party.name}, ${address.street}, ${address.postalCode} ${address.city}`;
}

function requestHash(input: CreateShipmentInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        input.carrier.id,
        input.packageSize,
        input.parcel,
        input.sender,
        input.recipient,
        input.pickupPointId,
        input.dispatchMethod,
      ]),
    )
    .digest('hex');
}

function notFound(id: string): ShippingProviderError {
  return new ShippingProviderError('NOT_FOUND', `FakeShipping: nie ma przesyłki ${id}`);
}

@Injectable()
export class FakeShippingProvider implements ShippingProvider {
  readonly provider = 'fake' as const;
  readonly capabilities: ShippingProviderCapabilities = {
    dispatchMethods: ['DROP_OFF', 'COURIER_PICKUP'],
  };

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(FAKE_SHIPPING_SCHEDULE) private readonly schedule: FakeShippingSchedule,
  ) {}

  findPoints(query: PickupPointQuery): Promise<PickupPoint[]> {
    return Promise.resolve(fakePickupPoints(query));
  }

  async createShipment(input: CreateShipmentInput): Promise<CreatedShipment> {
    if (input.sender.phone === FAKE_REJECTED_PHONE) {
      throw new ShippingProviderError(
        'INVALID_REQUEST',
        'Przewoźnik odrzucił numer telefonu nadawcy. Sprawdź numer i spróbuj ponownie.',
        { field: 'sender.phone' },
      );
    }
    if (input.sender.phone === FAKE_UNAVAILABLE_PHONE) {
      throw new ShippingProviderError('UNAVAILABLE', 'FakeShipping: dostawca niedostępny (test)');
    }
    const hash = requestHash(input);
    const [existing] = await this.db
      .select()
      .from(fakeShippingParcels)
      .where(eq(fakeShippingParcels.idempotencyKey, input.idempotencyKey));
    if (existing !== undefined) {
      if (existing.requestHash !== hash) {
        throw new ShippingProviderError(
          'INVALID_REQUEST',
          'FakeShipping: ten klucz idempotencji był użyty z innymi danymi',
        );
      }
      return this.created(existing);
    }
    const point = input.pickupPointId;
    const request: FakeParcelRequest = {
      carrier: input.carrier.id,
      kind: input.carrier.kind,
      reference: input.reference,
      sender: {
        name: input.sender.name,
        phone: input.sender.phone,
        address: partyLine(input.sender),
      },
      recipient: {
        name: input.recipient.name,
        phone: input.recipient.phone,
        destination: point === null ? partyLine(input.recipient) : `Punkt ${point}`,
      },
      dispatchMethod: input.dispatchMethod,
    };
    const labelless = input.carrier.kind !== 'COURIER' && input.dispatchMethod === 'DROP_OFF';
    const now = new Date();
    const parcel = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(fakeShippingParcels)
        .values({
          id: `fsp_${newId().replaceAll('-', '')}`,
          idempotencyKey: input.idempotencyKey,
          requestHash: hash,
          carrierId: input.carrier.id,
          trackingNumber: `FS${digits(12)}`,
          dropoffCode: labelless ? digits(6) : null,
          pickupPointId: point,
          scenario: scenarioForPoint(point),
          status: 'confirmed',
          request,
          currency: 'PLN',
          cost: FAKE_COSTS[input.packageSize],
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (row === undefined) {
        return undefined;
      }
      await tx.insert(fakeShippingTracking).values({
        parcelId: row.id,
        status: 'confirmed',
        description: FAKE_STATUS_DESCRIPTIONS.confirmed,
        occurredAt: now,
      });
      return row;
    });
    if (parcel === undefined) {
      // Równoległe utworzenie z tym samym kluczem: wynik pierwszego.
      return this.createShipment(input);
    }
    if (parcel.scenario !== 'MANUAL') {
      await this.schedule.advanceLater(parcel.id, 'confirmed');
    }
    return this.created(parcel);
  }

  async getLabel(providerShipmentId: string): Promise<Buffer | null> {
    const parcel = await this.parcel(providerShipmentId);
    const { request } = parcel;
    return fakeLabelPdf([
      'ETYKIETA TESTOWA - FakeShipping',
      'Zadna paczka nie zostanie wyslana.',
      '',
      `Numer: ${parcel.trackingNumber}`,
      `Usluga: ${request.carrier}`,
      ...(request.reference === null ? [] : [`Zamowienie: ${request.reference}`]),
      '',
      'Nadawca:',
      request.sender.name,
      request.sender.address,
      request.sender.phone,
      '',
      'Odbiorca:',
      request.recipient.name,
      request.recipient.destination,
      request.recipient.phone,
    ]);
  }

  async getTracking(providerShipmentId: string): Promise<TrackingEvent[]> {
    await this.parcel(providerShipmentId);
    const rows = await this.db
      .select()
      .from(fakeShippingTracking)
      .where(eq(fakeShippingTracking.parcelId, providerShipmentId))
      .orderBy(asc(fakeShippingTracking.occurredAt), asc(fakeShippingTracking.id));
    return rows.map((row) => {
      const mapped: { status: TrackingEvent['status']; returnReason?: 'NOT_COLLECTED' } =
        FAKE_STATUS_MAP[row.status];
      return {
        rawStatus: row.status,
        status: mapped.status,
        occurredAt: row.occurredAt,
        description: row.description,
        ...(mapped.returnReason === undefined ? {} : { returnReason: mapped.returnReason }),
      };
    });
  }

  async cancelShipment(providerShipmentId: string): Promise<void> {
    const parcel = await this.parcel(providerShipmentId);
    if (parcel.status === 'cancelled') {
      return;
    }
    if (parcel.status !== 'confirmed') {
      throw new ShippingProviderError(
        'INVALID_REQUEST',
        'Przesyłki nadanej u przewoźnika nie można już anulować.',
      );
    }
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(fakeShippingParcels)
        .set({ status: 'cancelled', updatedAt: now })
        .where(eq(fakeShippingParcels.id, providerShipmentId));
      await tx.insert(fakeShippingTracking).values({
        parcelId: providerShipmentId,
        status: 'cancelled',
        description: FAKE_STATUS_DESCRIPTIONS.cancelled,
        occurredAt: now,
      });
    });
  }

  parseWebhook(request: RawWebhookRequest): Promise<WebhookHint> {
    // Promise zamiast async: błąd podpisu ma być odrzuconą obietnicą, nie wyjątkiem.
    return Promise.resolve().then(() => {
      const body = parseFakeShippingWebhook(this.config.shipping.fake.webhookSecret, request);
      return { providerShipmentIds: [body.parcel_id] };
    });
  }

  private async parcel(id: string) {
    const [parcel] = await this.db
      .select()
      .from(fakeShippingParcels)
      .where(eq(fakeShippingParcels.id, id));
    if (parcel === undefined) {
      throw notFound(id);
    }
    return parcel;
  }

  private created(parcel: {
    readonly id: string;
    readonly trackingNumber: string;
    readonly dropoffCode: string | null;
    readonly cost: number;
    readonly currency: 'PLN';
  }): CreatedShipment {
    return {
      providerShipmentId: parcel.id,
      trackingNumber: parcel.trackingNumber,
      dropoffCode: parcel.dropoffCode,
      cost: { amount: parcel.cost, currency: parcel.currency },
    };
  }
}

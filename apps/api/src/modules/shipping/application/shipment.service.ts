// Przesyłki (F-24, PROJECT.md §8.3): wybór dostawy kupującego (`prepare`, woła go checkout
// F-25), „Nadaj” sprzedającego (`dispatch`), utworzenie u dostawcy w workerze z etykietą
// w prywatnym kubełku, anulowanie i odczyt. Przesyłkę u dostawcy tworzymy dopiero po „Nadaj”,
// żeby nie płacić za etykiety zamówień, które nie zostaną nadane (§8.3).
import type { CurrencyCode, Money } from '@biddy/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, ne, sql } from 'drizzle-orm';

import { APP_CONFIG, type AppConfig } from '../../../infra/config/index.js';
import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { Outbox } from '../../../infra/outbox/index.js';
import { JobQueues } from '../../../infra/queues/index.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../../../infra/storage/index.js';
import { CarrierService, type CarrierConfigRow } from '../carriers/carrier.service.js';
import {
  type ParcelData,
  type PickupPointSnapshot,
  type ShipmentEventRow,
  type ShipmentRow,
  shipmentEvents,
  shipments,
} from '../db/shipping.schema.js';
import type { ParcelSpec } from '../domain/shipping-options.js';
import type { DispatchMethod, ShipmentDirection } from '../domain/shipping-values.js';
import {
  type CreatedShipment,
  isShippingProviderError,
  type ShippingProvider,
} from '../ports/shipping-provider.port.js';
import { ShipmentCreated, ShipmentStatusChanged } from '../shipping.events.js';
import { PickupPointService } from './pickup-point.service.js';
import { ShippingProviderRegistry } from './provider-registry.js';
import { providerCall } from './provider-errors.js';
import { type PartyInput, normalizeParty } from './shipment-party.js';
import { ShippingQuoteService } from './shipping-quote.service.js';

export const SHIPPING_CREATE_JOB = 'shipping.create';
export const SHIPPING_FETCH_LABEL_JOB = 'shipping.fetch-label';

/** Ponowne pobranie etykiety, gdy dostawca jeszcze jej nie ma. */
const LABEL_RETRY_DELAY_MS = 5_000;

/** Komunikat dla sprzedającego po ostatniej nieudanej próbie (dostawca nie odpowiadał). */
export const PROVIDER_UNAVAILABLE_MESSAGE =
  'Przewoźnik chwilowo nie odpowiada. Spróbuj nadać paczkę ponownie za kilka minut.';

export interface CreateShipmentJob {
  readonly shipmentId: string;
  readonly attempt: number;
}

export interface FetchLabelJob {
  readonly shipmentId: string;
}

export interface PrepareShipmentInput {
  /** Zamówienie; null tylko dla przesyłki testowej FakeShipping. */
  readonly orderId: string | null;
  readonly direction: ShipmentDirection;
  readonly carrierId: string;
  /** Paczka ze snapshotu przedmiotu z akceptowanymi usługami. */
  readonly parcel: ParcelSpec;
  readonly currency: CurrencyCode;
  readonly pickupPointId: string | null;
  readonly recipient: PartyInput;
}

export interface DispatchInput {
  readonly sender: PartyInput;
  readonly dispatchMethod: DispatchMethod;
  /** Wartość zawartości dla przewoźnika (cena przedmiotu). */
  readonly declaredValue: Money | null;
  /** Numer zamówienia na etykiecie. */
  readonly reference: string | null;
}

/** Przesyłka z usługą i historią trackingu (widok dla obu stron i panelu). */
export interface ShipmentDetails {
  readonly shipment: ShipmentRow;
  readonly carrier: Pick<CarrierConfigRow, 'id' | 'name' | 'kind'>;
  /** Sposoby nadania dostępne dla tej przesyłki (usługa i możliwości dostawcy). */
  readonly dispatchMethods: readonly DispatchMethod[];
  readonly events: readonly ShipmentEventRow[];
}

function labelKey(shipmentId: string): string {
  return `shipping-labels/${shipmentId}.pdf`;
}

/** Klucz idempotencji u dostawcy: nowa próba po błędzie danych to nowy klucz. */
export function shipmentIdempotencyKey(shipmentId: string, attempt: number): string {
  return `shipment:${shipmentId}:${attempt}`;
}

function notDispatchable(detail?: string): DomainError {
  return new DomainError({
    code: 'ORDER_NOT_AWAITING_SHIPMENT',
    ...(detail === undefined ? {} : { detail }),
  });
}

@Injectable()
export class ShipmentService {
  private readonly logger = new Logger(ShipmentService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(CarrierService) private readonly carriers: CarrierService,
    @Inject(ShippingQuoteService) private readonly quotes: ShippingQuoteService,
    @Inject(PickupPointService) private readonly points: PickupPointService,
    @Inject(ShippingProviderRegistry) private readonly registry: ShippingProviderRegistry,
    private readonly outbox: Outbox,
    private readonly jobs: JobQueues,
  ) {}

  /**
   * Zapisuje wybór dostawy jako przesyłkę `PENDING` z ceną z cennika. Ponowny wybór przed
   * „Nadaj” zastępuje dane (jedna aktywna przesyłka na zamówienie i kierunek); po „Nadaj” 409.
   */
  async prepare(input: PrepareShipmentInput): Promise<ShipmentDetails> {
    const packageSize = input.parcel.packageSize;
    const option =
      packageSize === null
        ? undefined
        : await this.quotes.option(input.parcel, input.currency, input.carrierId);
    if (option === undefined || packageSize === null) {
      throw new DomainError({ code: 'SHIPPING_OPTION_UNAVAILABLE' });
    }
    const carrier = await this.requireCarrier(input.carrierId);
    const provider = this.registry.default();
    let pickupPoint: PickupPointSnapshot | null = null;
    if (option.requiresPickupPoint) {
      if (input.pickupPointId === null || input.pickupPointId.trim() === '') {
        throw new DomainError({ code: 'PICKUP_POINT_REQUIRED' });
      }
      const point = await this.points.point(carrier, input.pickupPointId, provider);
      if (point === undefined) {
        throw new DomainError({ code: 'PICKUP_POINT_NOT_FOUND' });
      }
      pickupPoint = { id: point.id, name: point.name, address: point.address };
    } else if (input.recipient.address === undefined || input.recipient.address === null) {
      throw new DomainError({ code: 'DELIVERY_ADDRESS_REQUIRED' });
    }
    const recipient = normalizeParty(input.recipient, {
      path: 'recipient',
      requireAddress: !option.requiresPickupPoint,
    });
    const parcel: ParcelData = {
      weightGrams: input.parcel.weightGrams,
      dimensionsCm: input.parcel.dimensionsCm,
    };
    const values = {
      provider: provider.provider,
      carrierId: carrier.id,
      packageSize,
      parcel,
      pickupPoint,
      recipient: option.requiresPickupPoint ? { ...recipient, address: null } : recipient,
      currency: input.currency,
      price: option.price,
    };
    const id = await this.db.transaction(async (tx) => {
      if (input.orderId !== null) {
        const [current] = await tx
          .select({ id: shipments.id, status: shipments.status })
          .from(shipments)
          .where(
            and(
              eq(shipments.orderId, input.orderId),
              eq(shipments.direction, input.direction),
              ne(shipments.status, 'CANCELLED'),
            ),
          )
          .for('update');
        if (current !== undefined) {
          if (current.status !== 'PENDING') {
            throw new DomainError({ code: 'SHIPMENT_ALREADY_DISPATCHED' });
          }
          await tx
            .update(shipments)
            .set({ ...values, lastError: null, updatedAt: new Date() })
            .where(eq(shipments.id, current.id));
          return current.id;
        }
      }
      const [created] = await tx
        .insert(shipments)
        .values({ ...values, orderId: input.orderId, direction: input.direction })
        .returning({ id: shipments.id });
      return created?.id ?? '';
    });
    return this.require(id);
  }

  /**
   * „Nadaj”: zapisuje nadawcę i sposób nadania, a worker tworzy przesyłkę u dostawcy. Przesyłka
   * już nadawana albo nadana zwraca bieżący stan (podwójne kliknięcie to jedna przesyłka).
   */
  async dispatch(shipmentId: string, input: DispatchInput): Promise<ShipmentDetails> {
    const details = await this.require(shipmentId);
    const { shipment } = details;
    if (shipment.status === 'CANCELLED') {
      throw notDispatchable('Ta przesyłka została anulowana.');
    }
    if (shipment.status !== 'PENDING') {
      return details;
    }
    if (!details.dispatchMethods.includes(input.dispatchMethod)) {
      throw new DomainError({ code: 'DISPATCH_METHOD_UNAVAILABLE' });
    }
    const sender = normalizeParty(input.sender, { path: 'sender', requireAddress: true });
    const now = new Date();
    const [updated] = await this.db
      .update(shipments)
      .set({
        status: 'REQUESTED',
        sender,
        dispatchMethod: input.dispatchMethod,
        declaredValue: input.declaredValue?.amount ?? null,
        reference: input.reference,
        dispatchAttempts: sql`${shipments.dispatchAttempts} + 1`,
        lastError: null,
        requestedAt: now,
        statusChangedAt: now,
        updatedAt: now,
      })
      .where(and(eq(shipments.id, shipmentId), eq(shipments.status, 'PENDING')))
      .returning({ attempts: shipments.dispatchAttempts });
    if (updated !== undefined) {
      await this.enqueueCreate(shipmentId, updated.attempts);
    }
    return this.require(shipmentId);
  }

  /** Job tworzenia (ID z numerem próby, więc ten sam „Nadaj” to jeden job). */
  async enqueueCreate(shipmentId: string, attempt: number): Promise<void> {
    await this.jobs.add(
      'shipping',
      SHIPPING_CREATE_JOB,
      { shipmentId, attempt } satisfies CreateShipmentJob,
      { jobId: `shipment-create-${shipmentId}-${attempt}` },
    );
  }

  /**
   * Tworzy przesyłkę u dostawcy (job `shipping.create`). Błąd danych od dostawcy wraca do
   * sprzedającego (`PENDING` z komunikatem); błąd przejściowy ponawia job, a po ostatniej próbie
   * też wraca do `PENDING`. Nieaktualny job (inna próba, inny status) nic nie robi.
   */
  async createAtProvider(
    job: CreateShipmentJob,
    options: { readonly finalAttempt: boolean },
  ): Promise<void> {
    const shipment = await this.find(job.shipmentId);
    if (
      shipment === undefined ||
      shipment.status !== 'REQUESTED' ||
      shipment.dispatchAttempts !== job.attempt ||
      shipment.sender === null ||
      shipment.dispatchMethod === null
    ) {
      return;
    }
    const carrier = await this.requireCarrier(shipment.carrierId);
    const provider = this.registry.get(shipment.provider);
    let created: CreatedShipment;
    try {
      created = await provider.createShipment({
        idempotencyKey: shipmentIdempotencyKey(shipment.id, job.attempt),
        carrier,
        packageSize: shipment.packageSize,
        parcel: shipment.parcel,
        declaredValue:
          shipment.declaredValue === null
            ? null
            : { amount: shipment.declaredValue, currency: shipment.currency },
        sender: shipment.sender,
        recipient: shipment.recipient,
        pickupPointId: shipment.pickupPoint?.id ?? null,
        dispatchMethod: shipment.dispatchMethod,
        reference: shipment.reference,
      });
    } catch (error) {
      // Błąd danych (np. zły telefon) wraca od razu do sprzedającego; ponowienie nic nie zmieni.
      const rejection =
        isShippingProviderError(error, 'INVALID_REQUEST') ||
        isShippingProviderError(error, 'UNSUPPORTED')
          ? error
          : undefined;
      if (rejection === undefined && !options.finalAttempt) {
        throw error;
      }
      const message = rejection?.message ?? PROVIDER_UNAVAILABLE_MESSAGE;
      this.logger.warn(
        { err: error, shipmentId: shipment.id, attempt: job.attempt },
        'Dostawca nie utworzył przesyłki: wraca do sprzedającego',
      );
      await this.db
        .update(shipments)
        .set({ status: 'PENDING', lastError: message, updatedAt: new Date() })
        .where(
          and(
            eq(shipments.id, shipment.id),
            eq(shipments.status, 'REQUESTED'),
            eq(shipments.dispatchAttempts, job.attempt),
          ),
        );
      return;
    }
    const now = new Date();
    const applied = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(shipments)
        .set({
          status: 'CREATED',
          providerShipmentId: created.providerShipmentId,
          trackingNumber: created.trackingNumber,
          dropoffCode: created.dropoffCode,
          cost: created.cost?.amount ?? null,
          statusChangedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(shipments.id, shipment.id),
            eq(shipments.status, 'REQUESTED'),
            eq(shipments.dispatchAttempts, job.attempt),
          ),
        )
        .returning({ id: shipments.id });
      if (row === undefined) {
        return false;
      }
      await this.outbox.add(
        tx,
        ShipmentCreated.create({
          aggregateId: shipment.id,
          payload: {
            orderId: shipment.orderId,
            direction: shipment.direction,
            provider: shipment.provider,
            carrierId: shipment.carrierId,
            trackingNumber: created.trackingNumber,
          },
        }),
      );
      return true;
    });
    if (!applied) {
      return;
    }
    this.logger.log(
      { shipmentId: shipment.id, provider: shipment.provider, carrierId: shipment.carrierId },
      'Przesyłka utworzona u dostawcy',
    );
    try {
      await this.storeLabel(shipment.id, provider, created.providerShipmentId);
    } catch (error) {
      this.logger.warn({ err: error, shipmentId: shipment.id }, 'Etykieta: ponowimy pobranie');
      await this.enqueueLabelFetch(shipment.id);
    }
  }

  /** Job `shipping.fetch-label`: etykieta, której dostawca nie miał przy tworzeniu. */
  async fetchLabel(shipmentId: string): Promise<void> {
    const shipment = await this.find(shipmentId);
    if (
      shipment === undefined ||
      shipment.labelKey !== null ||
      shipment.providerShipmentId === null
    ) {
      return;
    }
    const stored = await this.storeLabel(
      shipment.id,
      this.registry.get(shipment.provider),
      shipment.providerShipmentId,
    );
    if (!stored) {
      // Wyjątek = ponowienie joba z backoffem (dostawca przygotowuje etykietę).
      throw new Error(`Etykieta przesyłki ${shipment.id} jeszcze niegotowa u dostawcy`);
    }
  }

  /** Etykieta PDF z magazynu; undefined, gdy jeszcze jej nie ma. */
  async label(shipmentId: string): Promise<Buffer | undefined> {
    const shipment = await this.find(shipmentId);
    if (shipment?.labelKey === null || shipment?.labelKey === undefined) {
      return undefined;
    }
    return this.storage.get(this.config.storage.uploadsBucket, shipment.labelKey);
  }

  /**
   * Anulowanie (F-26: zamówienie nienadane w terminie): `PENDING` od razu, `CREATED` po
   * anulowaniu u dostawcy. Przesyłka już w drodze: 409.
   */
  async cancel(shipmentId: string): Promise<ShipmentDetails> {
    const { shipment } = await this.require(shipmentId);
    if (shipment.status === 'CANCELLED') {
      return this.require(shipmentId);
    }
    if (shipment.status !== 'PENDING' && shipment.status !== 'CREATED') {
      throw new DomainError({
        code: 'CONFLICT',
        detail: 'Tej przesyłki nie można już anulować.',
      });
    }
    if (shipment.status === 'CREATED' && shipment.providerShipmentId !== null) {
      const providerId = shipment.providerShipmentId;
      await providerCall(() => this.registry.get(shipment.provider).cancelShipment(providerId));
    }
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(shipments)
        .set({ status: 'CANCELLED', cancelledAt: now, statusChangedAt: now, updatedAt: now })
        .where(and(eq(shipments.id, shipment.id), eq(shipments.status, shipment.status)))
        .returning({ id: shipments.id });
      if (row !== undefined && shipment.status === 'CREATED') {
        await this.outbox.add(tx, this.statusEvent(shipment, 'CANCELLED', now, now));
      }
    });
    return this.require(shipmentId);
  }

  /** Aktywna przesyłka zamówienia w danym kierunku (bez anulowanych). */
  async forOrder(
    orderId: string,
    direction: ShipmentDirection = 'OUTBOUND',
  ): Promise<ShipmentDetails | undefined> {
    const [row] = await this.db
      .select({ id: shipments.id })
      .from(shipments)
      .where(
        and(
          eq(shipments.orderId, orderId),
          eq(shipments.direction, direction),
          ne(shipments.status, 'CANCELLED'),
        ),
      );
    return row === undefined ? undefined : this.details(row.id);
  }

  async details(shipmentId: string): Promise<ShipmentDetails | undefined> {
    const shipment = await this.find(shipmentId);
    if (shipment === undefined) {
      return undefined;
    }
    const [carrier, events] = await Promise.all([
      this.requireCarrier(shipment.carrierId),
      this.db
        .select()
        .from(shipmentEvents)
        .where(eq(shipmentEvents.shipmentId, shipmentId))
        .orderBy(asc(shipmentEvents.occurredAt), asc(shipmentEvents.recordedAt)),
    ]);
    const supported = this.registry.find(shipment.provider)?.capabilities.dispatchMethods ?? [];
    return {
      shipment,
      carrier: { id: carrier.id, name: carrier.name, kind: carrier.kind },
      dispatchMethods: carrier.dispatchMethods.filter((method) => supported.includes(method)),
      events,
    };
  }

  /** Event zmiany statusu (wspólny z synchronizacją trackingu). */
  statusEvent(
    shipment: Pick<ShipmentRow, 'id' | 'orderId' | 'direction' | 'status'>,
    status: ShipmentRow['status'],
    occurredAt: Date,
    detectedAt: Date,
    returnReason: 'NOT_COLLECTED' | 'OTHER' | null = null,
  ) {
    return ShipmentStatusChanged.create({
      aggregateId: shipment.id,
      payload: {
        orderId: shipment.orderId,
        direction: shipment.direction,
        status,
        previousStatus: shipment.status,
        occurredAt: occurredAt.toISOString(),
        detectedAt: detectedAt.toISOString(),
        returnReason,
      },
    });
  }

  private async require(shipmentId: string): Promise<ShipmentDetails> {
    const details = await this.details(shipmentId);
    if (details === undefined) {
      throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono przesyłki.' });
    }
    return details;
  }

  private async find(shipmentId: string): Promise<ShipmentRow | undefined> {
    const [row] = await this.db.select().from(shipments).where(eq(shipments.id, shipmentId));
    return row;
  }

  private async requireCarrier(carrierId: string): Promise<CarrierConfigRow> {
    const carrier = await this.carriers.config(carrierId);
    if (carrier === undefined) {
      throw new DomainError({ code: 'SHIPPING_OPTION_UNAVAILABLE' });
    }
    return carrier;
  }

  /** Pobiera etykietę od dostawcy do prywatnego kubełka; false, gdy jeszcze jej nie ma. */
  private async storeLabel(
    shipmentId: string,
    provider: ShippingProvider,
    providerShipmentId: string,
  ): Promise<boolean> {
    const pdf = await provider.getLabel(providerShipmentId);
    if (pdf === null) {
      await this.enqueueLabelFetch(shipmentId);
      return false;
    }
    const key = labelKey(shipmentId);
    await this.storage.put(this.config.storage.uploadsBucket, key, pdf, {
      contentType: 'application/pdf',
      cacheControl: 'private, no-store',
    });
    await this.db
      .update(shipments)
      .set({ labelKey: key, updatedAt: new Date() })
      .where(eq(shipments.id, shipmentId));
    return true;
  }

  private async enqueueLabelFetch(shipmentId: string): Promise<void> {
    await this.jobs.add(
      'shipping',
      SHIPPING_FETCH_LABEL_JOB,
      { shipmentId } satisfies FetchLabelJob,
      {
        jobId: `shipment-label-${shipmentId}`,
        runAt: new Date(Date.now() + LABEL_RETRY_DELAY_MS),
      },
    );
  }
}

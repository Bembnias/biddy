// Port dostawcy przesyłek (F-24, PROJECT.md §8.1): domena Biddy rozmawia z agregatorem albo
// przewoźnikiem wyłącznie przez ten interfejs. MVP to Furgonetka, v1 doda InPost ShipX, a dev
// i staging działają na FakeShipping. Typy i formaty dostawcy wolno importować tylko
// w adapters/<dostawca>/.
//
// Utworzenie przesyłki dostaje nasz klucz idempotencji: ponowienie z tym samym kluczem zwraca
// tę samą przesyłkę. Webhook dostawcy jest tylko wskazówką „coś się zmieniło”: stan zawsze
// pobieramy przez getTracking, więc fałszywy albo zgubiony webhook nie zmienia stanu błędnie.
import type { Money, PackageSize } from '@biddy/shared';

import type { ShippingProviderName } from '../../../infra/config/index.js';
import type { CarrierKind, ParcelData, ShipmentParty } from '../db/shipping.schema.js';
import type { DispatchMethod, ReturnReason, TrackingStatus } from '../domain/shipping-values.js';

export type { ShippingProviderName } from '../../../infra/config/index.js';

export interface ShippingProvider {
  readonly provider: ShippingProviderName;
  readonly capabilities: ShippingProviderCapabilities;

  /** Punkty odbioru usługi blisko miejsca albo frazy; z `pointId` sprawdza jeden punkt. */
  findPoints(query: PickupPointQuery): Promise<PickupPoint[]>;
  /** Tworzy i zamawia przesyłkę u przewoźnika (idempotentnie po `idempotencyKey`). */
  createShipment(input: CreateShipmentInput): Promise<CreatedShipment>;
  /** Etykieta PDF; null, gdy dostawca jeszcze jej nie przygotował. */
  getLabel(providerShipmentId: string): Promise<Buffer | null>;
  /** Pełna historia trackingu w kolejności chronologicznej. */
  getTracking(providerShipmentId: string): Promise<TrackingEvent[]>;
  cancelShipment(providerShipmentId: string): Promise<void>;
  /** Weryfikuje webhook i zwraca przesyłki, których dotyczy (INVALID_SIGNATURE). */
  parseWebhook(request: RawWebhookRequest): Promise<WebhookHint>;
}

export interface ShippingProviderCapabilities {
  /** Sposoby nadania, które adapter umie zlecić (np. zamówienie kuriera po paczkę). */
  readonly dispatchMethods: readonly DispatchMethod[];
}

/** Usługa przewoźnika z konfiguracji Biddy (`shipping_carriers`). */
export interface CarrierConfig {
  readonly id: string;
  readonly kind: CarrierKind;
  /** Kod usługi u dostawców, np. `{ furgonetka: 'inpost' }`. */
  readonly providerCodes: Partial<Record<ShippingProviderName, string>>;
}

export interface PickupPointQuery {
  readonly carrier: CarrierConfig;
  readonly near?: { readonly lat: number; readonly lng: number };
  readonly phrase?: string;
  readonly pointId?: string;
  readonly limit: number;
}

export interface PickupPoint {
  readonly id: string;
  readonly name: string;
  /** Adres jednym tekstem, np. „ul. Prosta 1, 00-001 Warszawa”. */
  readonly address: string;
  readonly location: { readonly lat: number; readonly lng: number } | null;
  readonly distanceMeters: number | null;
  /** Godziny otwarcia jednym tekstem (paczkomat: „24/7”); null, gdy dostawca nie podał. */
  readonly openingHours: string | null;
}

export interface CreateShipmentInput {
  /** Nasz klucz, np. `shipment:{id}:{próba}`; ten sam klucz = ta sama przesyłka. */
  readonly idempotencyKey: string;
  readonly carrier: CarrierConfig;
  readonly packageSize: PackageSize;
  readonly parcel: ParcelData;
  /** Wartość zawartości (cena przedmiotu); przewoźnik wycenia na tej podstawie ochronę. */
  readonly declaredValue: Money | null;
  /** Nadawca z adresem (dane na etykiecie). */
  readonly sender: ShipmentParty;
  /** Odbiorca: adres dla kuriera albo punkt odbioru. */
  readonly recipient: ShipmentParty;
  readonly pickupPointId: string | null;
  readonly dispatchMethod: DispatchMethod;
  /** Numer zamówienia na etykiecie (null dla przesyłki testowej). */
  readonly reference: string | null;
}

export interface CreatedShipment {
  readonly providerShipmentId: string;
  readonly trackingNumber: string;
  /** Kod nadania bez etykiety (paczkomat, punkt); null, gdy trzeba wydrukować etykietę. */
  readonly dropoffCode: string | null;
  /** Koszt u dostawcy (null, gdy go nie podał). */
  readonly cost: Money | null;
}

export interface TrackingEvent {
  /** Status w notacji dostawcy (zapisywany w historii). */
  readonly rawStatus: string;
  readonly status: TrackingStatus;
  readonly occurredAt: Date;
  /** Opis przewoźnika do pokazania (nie do logiki). */
  readonly description: string | null;
  /** Powód zwrotu, gdy dostawca go podaje (przy RETURNING). */
  readonly returnReason?: ReturnReason;
}

/** Surowe żądanie webhooka: nagłówki i bajty body (podpis liczy się z bajtów). */
export interface RawWebhookRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly rawBody: Buffer;
}

export interface WebhookHint {
  readonly providerShipmentIds: readonly string[];
}

export type ShippingProviderErrorCode =
  /** Dane odrzucone przez dostawcę (np. zły telefon); `field` i komunikat dla sprzedającego. */
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'INVALID_SIGNATURE'
  /** Operacja niedostępna dla tej usługi albo dostawcy. */
  | 'UNSUPPORTED'
  /** Dostawca chwilowo niedostępny albo błąd po jego stronie: ponowienie ma sens. */
  | 'UNAVAILABLE';

export class ShippingProviderError extends Error {
  readonly code: ShippingProviderErrorCode;
  /** Pole danych, którego dotyczy błąd (np. `sender.phone`). */
  readonly field: string | undefined;

  constructor(
    code: ShippingProviderErrorCode,
    message: string,
    options?: { readonly cause?: unknown; readonly field?: string },
  ) {
    super(message, options);
    this.name = 'ShippingProviderError';
    this.code = code;
    this.field = options?.field;
  }
}

export function isShippingProviderError(
  error: unknown,
  code?: ShippingProviderErrorCode,
): error is ShippingProviderError {
  return error instanceof ShippingProviderError && (code === undefined || error.code === code);
}

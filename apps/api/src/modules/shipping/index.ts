/**
 * Publiczne API modułu `shipping` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: adapter przewoźników, wyceny, etykiety, tracking, reklamacje.
 * - CarrierService: przewoźnicy i gabaryty (F-14) z konfiguracją nadania (F-24).
 * - ShippingQuoteService: opcje dostawy z cenami z cennika Biddy (strona aukcji, checkout).
 * - PickupPointService: punkty odbioru u dostawcy.
 * - ShipmentService: wybór dostawy (`prepare`, F-25), „Nadaj” (`dispatch`), anulowanie,
 *   odczyt i etykieta; TrackingSync: tracking (webhooki i polling).
 * - CarrierClaimService: reklamacje u przewoźników (§8.4).
 * - Eventy: ShipmentCreated, ShipmentStatusChanged, CarrierClaimResolved.
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export { CarrierClaimService, type OpenClaimInput } from './application/carrier-claim.service.js';
export { postalAddressSchema, shipmentPartySchema } from './application/shipment-party.js';
export { MAX_PICKUP_POINTS, PickupPointService } from './application/pickup-point.service.js';
export {
  type DispatchInput,
  type PrepareShipmentInput,
  type ShipmentDetails,
  ShipmentService,
} from './application/shipment.service.js';
export {
  type ParcelSpec,
  type ShippingOption,
  ShippingQuoteService,
} from './application/shipping-quote.service.js';
export { TrackingSync } from './application/tracking-sync.js';
export { type Carrier, CarrierService } from './carriers/carrier.service.js';
export { CARRIER_KINDS, type CarrierKind } from './db/shipping.schema.js';
export {
  DISPATCH_METHODS,
  type DispatchMethod,
  SHIPMENT_STATUSES,
  type ShipmentDirection,
  type ShipmentStatus,
} from './domain/shipping-values.js';
export {
  DispatchShipmentBody,
  PickupPointDto,
  ShipmentDto,
  type ShipmentViewer,
  ShippingOptionDto,
  shipmentDto,
  shippingOptionDto,
} from './http/shipment-dto.js';
export { CarrierClaimResolved, ShipmentCreated, ShipmentStatusChanged } from './shipping.events.js';
export { ShippingModule } from './shipping.module.js';

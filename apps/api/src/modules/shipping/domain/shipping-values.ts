// Wartości domeny dostaw (F-24, PROJECT.md §8.3, §13.3): statusy przesyłki, kierunek, sposób
// nadania i reklamacje. Plik bez zależności od NestJS: czytają go tabele (drizzle-kit) i DTO.

/**
 * Statusy wewnętrzne przesyłki. `PENDING` i `REQUESTED` są przed utworzeniem u dostawcy
 * (wybór kupującego, potem „Nadaj”), reszta to statusy trackingu z §8.3.
 */
export const SHIPMENT_STATUSES = [
  'PENDING',
  'REQUESTED',
  'CREATED',
  'DROPPED_OFF',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'READY_FOR_PICKUP',
  'DELIVERED',
  'EXCEPTION',
  'RETURNING',
  'RETURNED',
  'CANCELLED',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** Statusy, które zgłasza dostawca w trackingu (bez stanów sprzed utworzenia przesyłki). */
export type TrackingStatus = Exclude<ShipmentStatus, 'PENDING' | 'REQUESTED'>;

/** Statusy końcowe: tracking ich już nie zmienia. */
export const FINAL_SHIPMENT_STATUSES: ReadonlySet<ShipmentStatus> = new Set([
  'DELIVERED',
  'RETURNED',
  'CANCELLED',
]);

/** Przesyłki u dostawcy, których tracking jeszcze się zmienia (polling zapasowy, §8.3). */
export const ACTIVE_SHIPMENT_STATUSES = [
  'CREATED',
  'DROPPED_OFF',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'READY_FOR_PICKUP',
  'EXCEPTION',
  'RETURNING',
] as const satisfies readonly TrackingStatus[];

/** Statusy, w których paczka czekała na kupującego: zwrot po nich to paczka nieodebrana. */
export const AWAITING_RECIPIENT_STATUSES: ReadonlySet<ShipmentStatus> = new Set([
  'OUT_FOR_DELIVERY',
  'READY_FOR_PICKUP',
]);

/** Przesyłka do kupującego albo zwrot do sprzedającego (spory, F-28). */
export const SHIPMENT_DIRECTIONS = ['OUTBOUND', 'RETURN'] as const;
export type ShipmentDirection = (typeof SHIPMENT_DIRECTIONS)[number];

/** Sposób nadania: w paczkomacie lub punkcie albo odbiór przez kuriera od nadawcy (§8.3). */
export const DISPATCH_METHODS = ['DROP_OFF', 'COURIER_PICKUP'] as const;
export type DispatchMethod = (typeof DISPATCH_METHODS)[number];

/**
 * Powód zwrotu do nadawcy: `NOT_COLLECTED`, gdy paczka czekała na kupującego (minął termin
 * odbioru albo nie udało się doręczyć, §7.4), inaczej `OTHER` (np. problem w sortowni).
 */
export const RETURN_REASONS = ['NOT_COLLECTED', 'OTHER'] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

/** Reklamacje u przewoźnika (§8.4). */
export const CARRIER_CLAIM_TYPES = ['LOST', 'DAMAGED'] as const;
export type CarrierClaimType = (typeof CARRIER_CLAIM_TYPES)[number];

export const CARRIER_CLAIM_STATUSES = ['OPEN', 'SUBMITTED', 'ACCEPTED', 'REJECTED'] as const;
export type CarrierClaimStatus = (typeof CARRIER_CLAIM_STATUSES)[number];

/** Lista do ograniczeń CHECK: `'A', 'B'`. */
export function sqlList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

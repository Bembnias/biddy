// Reguły cyklu życia zamówienia bez bazy danych (F-26, PROJECT.md §6.8, §7.4, §7.9): terminy,
// przejścia sterowane statusem przesyłki, zgłoszenie zaginięcia i kolejny kandydat do drugiej
// szansy.
import type { ShipmentStatus } from '../../shipping/index.js';
import type { OrderStatus, RunnerUp } from '../db/orders.schema.js';

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

/** Okno na sprawdzenie przedmiotu po odbiorze (§7.4). */
export const INSPECTION_WINDOW_MS = 36 * HOUR_MS;

/** Brak paczki można zgłosić najwcześniej tyle po nadaniu (§7.4). */
export const NOT_RECEIVED_AFTER_MS = 14 * DAY_MS;

/** Rekompensata za zaginioną paczkę najpóźniej tyle po zgłoszeniu (§7.9). */
export const COMPENSATION_DUE_MS = 30 * DAY_MS;

/** Ważność oferty drugiej szansy (§6.8). */
export const SECOND_CHANCE_VALIDITY_MS = 24 * HOUR_MS;

/** Ofertę drugiej szansy można wysłać najpóźniej tyle po anulowaniu zamówienia (decyzja nr 119). */
export const SECOND_CHANCE_SEND_WINDOW_MS = 14 * DAY_MS;

/** Przypomnienie o nadaniu tyle przed terminem nadania. */
export const SHIP_REMINDER_BEFORE_MS = DAY_MS;

/** Przypomnienia o płatności tyle po utworzeniu zamówienia (§6.8). */
export const PAYMENT_REMINDERS_AFTER_MS = [HOUR_MS, 12 * HOUR_MS, 20 * HOUR_MS] as const;

/** Statusy, w których paczka jest już u przewoźnika (nadanie, §7.4). */
export const CARRIER_STATUSES: ReadonlySet<ShipmentStatus> = new Set([
  'DROPPED_OFF',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'READY_FOR_PICKUP',
  'EXCEPTION',
  'DELIVERED',
  'RETURNING',
  'RETURNED',
]);

/** Statusy końcowe przesyłki: po nich nie da się zgłosić zaginięcia. */
const FINISHED_SHIPMENT_STATUSES: ReadonlySet<ShipmentStatus> = new Set(['DELIVERED', 'RETURNED']);

/** Krok zamówienia wywołany zmianą statusu przesyłki do kupującego. */
export type ShipmentStep = 'SHIP' | 'DELIVER' | 'NOT_PICKED_UP' | 'REFUND_RETURNED';

/**
 * Kroki dla zamówienia w danym stanie po zmianie statusu przesyłki. Pierwszy status u przewoźnika
 * nadaje zamówienie, a gdy jest od razu dalszy (np. DELIVERED), dochodzi kolejny krok.
 */
export function shipmentSteps(
  orderStatus: OrderStatus,
  change: {
    readonly status: ShipmentStatus;
    readonly returnReason: 'NOT_COLLECTED' | 'OTHER' | null;
  },
): ShipmentStep[] {
  if (orderStatus === 'PAID') {
    return CARRIER_STATUSES.has(change.status) ? ['SHIP', ...shipmentSteps('SHIPPED', change)] : [];
  }
  if (orderStatus === 'SHIPPED') {
    if (change.status === 'DELIVERED') {
      return ['DELIVER'];
    }
    return change.status === 'RETURNING' && change.returnReason === 'NOT_COLLECTED'
      ? ['NOT_PICKED_UP']
      : [];
  }
  return orderStatus === 'NOT_PICKED_UP' && change.status === 'RETURNED' ? ['REFUND_RETURNED'] : [];
}

/** Koniec okna 36 h: od chwili, w której dowiedzieliśmy się o odbiorze (na korzyść kupującego). */
export function inspectionEndsAt(detectedAt: Date): Date {
  return new Date(detectedAt.getTime() + INSPECTION_WINDOW_MS);
}

export type NotReceivedBlocker =
  'ORDER_NOT_SHIPPED_YET' | 'NOT_RECEIVED_TOO_EARLY' | 'SHIPMENT_FINISHED';

/** Czy kupujący może zgłosić brak paczki (undefined: może). */
export function notReceivedBlocker(
  order: { readonly status: OrderStatus; readonly shippedAt: Date | null },
  shipmentStatus: ShipmentStatus | undefined,
  now: Date,
): NotReceivedBlocker | undefined {
  if (order.status === 'AWAITING_PAYMENT' || order.status === 'PAID') {
    return 'ORDER_NOT_SHIPPED_YET';
  }
  if (order.status !== 'SHIPPED' || order.shippedAt === null) {
    return 'SHIPMENT_FINISHED';
  }
  if (shipmentStatus !== undefined && FINISHED_SHIPMENT_STATUSES.has(shipmentStatus)) {
    return 'SHIPMENT_FINISHED';
  }
  return now.getTime() < notReceivedFrom(order.shippedAt).getTime()
    ? 'NOT_RECEIVED_TOO_EARLY'
    : undefined;
}

/** Od kiedy można zgłosić brak paczki. */
export function notReceivedFrom(shippedAt: Date): Date {
  return new Date(shippedAt.getTime() + NOT_RECEIVED_AFTER_MS);
}

/** Kolejny kandydat do drugiej szansy: pierwszy z listy, który nie dostał oferty ani nie kupował. */
export function nextRunnerUp(
  runnerUps: readonly RunnerUp[],
  excluded: ReadonlySet<string>,
): RunnerUp | undefined {
  return runnerUps.find((runnerUp) => runnerUp.maxAmount > 0 && !excluded.has(runnerUp.bidderId));
}

export type SecondChanceBlocker =
  'NOT_CANCELLED_UNPAID' | 'NOT_LATEST_ORDER' | 'OFFER_PENDING' | 'WINDOW_PASSED' | 'NO_CANDIDATES';

/** Czy sprzedający może wysłać ofertę drugiej szansy (undefined: może). */
export function secondChanceBlocker(input: {
  readonly status: OrderStatus;
  readonly cancelledAt: Date | null;
  readonly latest: boolean;
  readonly pendingOffer: boolean;
  readonly candidate: RunnerUp | undefined;
  readonly now: Date;
}): SecondChanceBlocker | undefined {
  if (input.status !== 'CANCELLED_UNPAID' || input.cancelledAt === null) {
    return 'NOT_CANCELLED_UNPAID';
  }
  if (!input.latest) {
    return 'NOT_LATEST_ORDER';
  }
  if (input.pendingOffer) {
    return 'OFFER_PENDING';
  }
  if (input.now.getTime() >= secondChanceSendBy(input.cancelledAt).getTime()) {
    return 'WINDOW_PASSED';
  }
  return input.candidate === undefined ? 'NO_CANDIDATES' : undefined;
}

/** Termin wysłania oferty drugiej szansy. */
export function secondChanceSendBy(cancelledAt: Date): Date {
  return new Date(cancelledAt.getTime() + SECOND_CHANCE_SEND_WINDOW_MS);
}

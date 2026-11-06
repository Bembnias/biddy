// Reguły sporu bez bazy danych (F-28, PROJECT.md §7.4–7.5, §7.9): terminy, krok sporu po zmianie
// statusu przesyłki zwrotnej, koszty po stronie sprzedającego i uzasadnienia rozstrzygnięć, które
// składa system (porozumienie stron i terminy).
import {
  businessDayDeadline,
  DISPUTE_DECISION_HOURS,
  DISPUTE_RESPONSE_HOURS,
  DISPUTE_RETURN_INSPECTION_HOURS,
  DISPUTE_RETURN_SHIP_BUSINESS_DAYS,
  type DisputeOutcome,
  type DisputeReason,
  type DisputeStatus,
  formatMoney,
  type Money,
} from '@biddy/shared';

import type { ShipmentStatus } from '../../shipping/index.js';

const HOUR_MS = 60 * 60 * 1_000;

/** Termin odpowiedzi sprzedającego na zgłoszenie albo kupującego na propozycję (48 h). */
export function responseDueAt(from: Date): Date {
  return new Date(from.getTime() + DISPUTE_RESPONSE_HOURS * HOUR_MS);
}

/** SLA decyzji zespołu Biddy (72 h od eskalacji). */
export function decisionDueAt(escalatedAt: Date): Date {
  return new Date(escalatedAt.getTime() + DISPUTE_DECISION_HOURS * HOUR_MS);
}

/** Termin nadania zwrotu: koniec 5. dnia roboczego z kalendarzem świąt (§7.4). */
export function returnShipBy(from: Date): Date {
  return businessDayDeadline(from, DISPUTE_RETURN_SHIP_BUSINESS_DAYS);
}

/** Koniec weryfikacji zwrotu: 36 h od chwili, w której dowiedzieliśmy się o odbiorze. */
export function returnInspectionEndsAt(detectedAt: Date): Date {
  return new Date(detectedAt.getTime() + DISPUTE_RETURN_INSPECTION_HOURS * HOUR_MS);
}

/** Statusy, w których przesyłka zwrotna jest już u przewoźnika (nadanie). */
const CARRIER_STATUSES: ReadonlySet<ShipmentStatus> = new Set([
  'DROPPED_OFF',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'READY_FOR_PICKUP',
  'EXCEPTION',
  'DELIVERED',
  'RETURNING',
  'RETURNED',
]);

export function isAtCarrier(status: ShipmentStatus): boolean {
  return CARRIER_STATUSES.has(status);
}

/** Krok sporu wywołany zmianą statusu przesyłki zwrotnej. */
export type ReturnStep = 'SHIPPED' | 'DELIVERED' | 'FAILED';

/**
 * Kroki sporu po zmianie statusu przesyłki zwrotnej. Pierwszy status u przewoźnika to nadanie,
 * a gdy jest od razu końcowy (DELIVERED), dochodzi odbiór. Zwrot, który wraca do kupującego
 * (RETURNING), trafia do supportu.
 */
export function returnSteps(disputeStatus: DisputeStatus, status: ShipmentStatus): ReturnStep[] {
  if (disputeStatus === 'AWAITING_RETURN') {
    return isAtCarrier(status) ? ['SHIPPED', ...returnSteps('RETURN_IN_TRANSIT', status)] : [];
  }
  if (disputeStatus === 'RETURN_IN_TRANSIT') {
    if (status === 'DELIVERED') {
      return ['DELIVERED'];
    }
    return status === 'RETURNING' || status === 'RETURNED' ? ['FAILED'] : [];
  }
  return [];
}

/** Reklamacja u przewoźnika przy jego winie: brak paczki mimo doręczenia to zaginięcie. */
export function carrierClaimType(reason: DisputeReason): 'LOST' | 'DAMAGED' {
  return reason === 'NOT_RECEIVED' ? 'LOST' : 'DAMAGED';
}

/** Uzasadnienia rozstrzygnięć, które składa system (porozumienie stron i terminy). */
export const SYSTEM_STATEMENTS = {
  sellerAccepted: 'Sprzedający zgodził się zwrócić pieniądze.',
  sellerAcceptedWithReturn:
    'Sprzedający zgodził się zwrócić pieniądze po odesłaniu przedmiotu. Zwrot sprawdził albo minęło 36 h od jego odbioru.',
  partialAccepted: (amount: Money) =>
    `Kupujący przyjął propozycję sprzedającego: zwrot ${formatMoney(amount)}, przedmiot zostaje u kupującego.`,
  returnNotShipped:
    'Kupujący nie nadał zwrotu w ciągu 5 dni roboczych, więc spór kończy się na korzyść sprzedającego.',
} as const;

/** Zdanie o wyniku do historii sporu i powiadomień. */
export function outcomeSummary(outcome: DisputeOutcome, refund: Money | null): string {
  switch (outcome) {
    case 'SELLER_FAVOR':
      return 'Spór rozstrzygnięty na korzyść sprzedającego.';
    case 'FULL_REFUND':
      return 'Kupujący dostaje pełny zwrot.';
    case 'PARTIAL_REFUND':
      return `Kupujący dostaje zwrot ${refund === null ? '' : formatMoney(refund)}.`;
  }
}

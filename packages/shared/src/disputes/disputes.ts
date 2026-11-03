// Spory (F-28, PROJECT.md §7.5): powody, stany, rozstrzygnięcia, terminy i limity. Wspólne dla
// API (zapis, walidacja, joby) i klientów (formularz zgłoszenia, etykiety, osie czasu).

/** Powód zgłoszenia. `NOT_RECEIVED`: tracking pokazuje doręczenie, a paczka nie dotarła (§7.5). */
export const DISPUTE_REASONS = [
  'NOT_AS_DESCRIBED',
  'DAMAGED',
  'INCOMPLETE',
  'COUNTERFEIT',
  'NOT_RECEIVED',
  'OTHER',
] as const;
export type DisputeReason = (typeof DISPUTE_REASONS)[number];

/** Powody, przy których zgłoszenie wymaga co najmniej jednego zdjęcia. */
const PHOTO_REQUIRED: ReadonlySet<DisputeReason> = new Set([
  'NOT_AS_DESCRIBED',
  'DAMAGED',
  'INCOMPLETE',
  'COUNTERFEIT',
]);

export function disputeReasonRequiresPhoto(reason: DisputeReason): boolean {
  return PHOTO_REQUIRED.has(reason);
}

/** Stan sporu z diagramu §7.5. */
export const DISPUTE_STATUSES = [
  'AWAITING_SELLER',
  'PARTIAL_OFFERED',
  'ESCALATED',
  'AWAITING_RETURN',
  'RETURN_IN_TRANSIT',
  'RETURN_DELIVERED',
  'RESOLVED',
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/** Rozstrzygnięcie: na korzyść sprzedającego, pełny zwrot albo zwrot części ceny. */
export const DISPUTE_OUTCOMES = ['SELLER_FAVOR', 'FULL_REFUND', 'PARTIAL_REFUND'] as const;
export type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[number];

/** Kto zawinił przy pełnym zwrocie: od tego zależą koszty dostawy i rekompensata (§7.9). */
export const DISPUTE_FAULTS = ['SELLER', 'CARRIER'] as const;
export type DisputeFault = (typeof DISPUTE_FAULTS)[number];

/** Kto rozstrzygnął: porozumienie stron, zespół Biddy albo system (termin). */
export const DISPUTE_DECIDERS = ['PARTIES', 'STAFF', 'SYSTEM'] as const;
export type DisputeDecider = (typeof DISPUTE_DECIDERS)[number];

/** Autor wpisu w historii sporu. */
export const DISPUTE_ACTORS = ['BUYER', 'SELLER', 'STAFF', 'SYSTEM'] as const;
export type DisputeActor = (typeof DISPUTE_ACTORS)[number];

/** Rodzaj wpisu w historii sporu (oś czasu dla stron i personelu). */
export const DISPUTE_EVENT_TYPES = [
  'OPENED',
  'SELLER_ACCEPTED',
  'PARTIAL_OFFERED',
  'PARTIAL_ACCEPTED',
  'PARTIAL_REJECTED',
  'SELLER_REJECTED',
  'ESCALATED',
  'COMMENT',
  'DECISION',
  'RETURN_SHIPPED',
  'RETURN_DELIVERED',
  'RETURN_ACCEPTED',
  'RETURN_CONTESTED',
  'RESOLVED',
] as const;
export type DisputeEventType = (typeof DISPUTE_EVENT_TYPES)[number];

/** Przyczyna eskalacji do zespołu Biddy. */
export const DISPUTE_ESCALATION_CAUSES = [
  'SELLER_REJECTED',
  'SELLER_SILENT',
  'OFFER_REJECTED',
  'BUYER_SILENT',
  'RETURN_CONTESTED',
  'RETURN_FAILED',
] as const;
export type DisputeEscalationCause = (typeof DISPUTE_ESCALATION_CAUSES)[number];

/** Odpowiedź sprzedającego na zgłoszenie. */
export const DISPUTE_SELLER_ACTIONS = ['ACCEPT', 'OFFER_PARTIAL', 'REJECT'] as const;
export type DisputeSellerAction = (typeof DISPUTE_SELLER_ACTIONS)[number];

/** Czas na odpowiedź sprzedającego na zgłoszenie i kupującego na propozycję (§7.4). */
export const DISPUTE_RESPONSE_HOURS = 48;

/** SLA decyzji zespołu Biddy od eskalacji (§7.4); bez automatu. */
export const DISPUTE_DECISION_HOURS = 72;

/** Termin nadania zwrotu przez kupującego w dniach roboczych (§7.4). */
export const DISPUTE_RETURN_SHIP_BUSINESS_DAYS = 5;

/** Czas sprzedającego na sprawdzenie zwrotu od jego odbioru (§7.4). */
export const DISPUTE_RETURN_INSPECTION_HOURS = 36;

/** Najwięcej zdjęć w jednym wpisie (zgłoszenie, odpowiedź, wyjaśnienie). */
export const MAX_DISPUTE_PHOTOS = 10;

/** Limity tekstów: opis zgłoszenia, wyjaśnienie odrzucenia, uzasadnienie decyzji. */
export const DISPUTE_TEXT_LIMITS = {
  description: { min: 20, max: 2_000 },
  explanation: { min: 10, max: 2_000 },
  note: { min: 1, max: 2_000 },
  statement: { min: 20, max: 2_000 },
} as const;

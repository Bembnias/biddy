/**
 * Publiczne API modułu `disputes` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: spory, dowody, decyzje, zwroty (F-28).
 * - DisputeService: zgłoszenie, odpowiedzi stron, wyjaśnienia, zwrot z odesłaniem i decyzja
 *   personelu; odczyt sporu zamówienia.
 * - DisputeDeadlines: joby terminów (eskalacja, brak nadania zwrotu, zwrot pieniędzy po 36 h)
 *   i tracking przesyłki zwrotnej.
 * - Eventy: DisputeOpened, DisputePartialOffered, DisputeEscalated, DisputeReturnRequested,
 *   DisputeReturnDelivered, DisputeResolved.
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export { DisputesModule } from './disputes.module.js';
export {
  type DecisionInput,
  DisputeService,
  type OpenDisputeInput,
  type SellerResponseInput,
} from './application/dispute.service.js';
export { type DisputeDeadlineReport, DisputeDeadlines } from './application/dispute-deadlines.js';
export {
  canDisputeTransition,
  DISPUTE_TRANSITIONS,
  IllegalDisputeTransitionError,
} from './domain/dispute-state-machine.js';
export {
  DisputeEscalated,
  DisputeOpened,
  DisputePartialOffered,
  DisputeResolved,
  DisputeReturnDelivered,
  DisputeReturnRequested,
} from './disputes.events.js';

// Reguły ocen (F-30, decyzje nr 142–143): które zamówienie można ocenić, okno 14 dni od
// zakończenia, ujawnienie pierwszej oceny najpóźniej po 7 dniach i termin strony, który kończy się
// z ujawnieniem oceny drugiej strony (bez odwetu). Czyste funkcje: bez bazy i zegara.
import { REVIEW_REVEAL_DAYS, REVIEW_WINDOW_DAYS } from '@biddy/shared';

const DAY_MS = 24 * 60 * 60 * 1000;
export const REVIEW_WINDOW_MS = REVIEW_WINDOW_DAYS * DAY_MS;
export const REVIEW_REVEAL_MS = REVIEW_REVEAL_DAYS * DAY_MS;

/** Pola zamówienia potrzebne regułom ocen. */
export interface ReviewableOrder {
  readonly status: string;
  readonly completedAt: Date | null;
  readonly refundedAt: Date | null;
  readonly disputedAt: Date | null;
}

/** Ocena widziana przez reguły: kiedy powstała i od kiedy jest publiczna. */
export interface ReviewTiming {
  readonly createdAt: Date;
  readonly visibleAt: Date;
}

/** Dlaczego nie można ocenić (`reason` w 409 REVIEW_UNAVAILABLE). */
export type ReviewBlocker = 'NOT_FINISHED' | 'WINDOW_CLOSED' | 'ALREADY_REVIEWED';

export const REVIEW_BLOCKER_TEXT: Readonly<Record<ReviewBlocker, string>> = {
  NOT_FINISHED:
    'Ocenić można zamówienie zakończone sprzedażą albo sporem. To zamówienie jeszcze trwa albo zakończyło się bez transakcji.',
  WINDOW_CLOSED: 'Czas na ocenę tego zamówienia minął.',
  ALREADY_REVIEWED: 'To zamówienie ma już Twoją ocenę. Oceny nie można zmienić.',
};

/**
 * Początek okna na ocenę: `completed_at` przy COMPLETED (także po sporze na korzyść sprzedającego)
 * i `refunded_at` przy zwrocie po sporze. Inne zamówienia (w toku, zwrot bez sporu): null.
 */
export function reviewWindowStart(order: ReviewableOrder): Date | null {
  if (order.status === 'COMPLETED') {
    return order.completedAt;
  }
  if (
    (order.status === 'REFUNDED' || order.status === 'PARTIALLY_REFUNDED') &&
    order.disputedAt !== null
  ) {
    return order.refundedAt;
  }
  return null;
}

/** Koniec okna na ocenę (14 dni od zakończenia) albo null, gdy zamówienia nie można ocenić. */
export function reviewWindowEnd(order: ReviewableOrder): Date | null {
  const start = reviewWindowStart(order);
  return start === null ? null : new Date(start.getTime() + REVIEW_WINDOW_MS);
}

/**
 * Ujawnienie pierwszej oceny zamówienia: 7 dni po wystawieniu, ale nie później niż koniec okna
 * (wtedy druga strona i tak nie może już ocenić). Druga ocena odsłania obie od razu.
 */
export function firstReviewVisibleAt(createdAt: Date, windowEnd: Date): Date {
  const reveal = createdAt.getTime() + REVIEW_REVEAL_MS;
  return new Date(Math.max(createdAt.getTime(), Math.min(reveal, windowEnd.getTime())));
}

/**
 * Termin oceny strony: koniec okna, a gdy druga strona już oceniła, chwila ujawnienia jej oceny
 * (po przeczytaniu oceny drugiej strony nie można już ocenić).
 */
export function rateUntil(windowEnd: Date, theirs: ReviewTiming | undefined): Date {
  return theirs === undefined || theirs.visibleAt > windowEnd ? windowEnd : theirs.visibleAt;
}

/** Powód, dla którego strona nie może ocenić zamówienia, albo null. */
export function reviewBlocker(
  order: ReviewableOrder,
  mine: ReviewTiming | undefined,
  theirs: ReviewTiming | undefined,
  now: Date,
): ReviewBlocker | null {
  const windowEnd = reviewWindowEnd(order);
  if (windowEnd === null) {
    return 'NOT_FINISHED';
  }
  if (mine !== undefined) {
    return 'ALREADY_REVIEWED';
  }
  return now < rateUntil(windowEnd, theirs) ? null : 'WINDOW_CLOSED';
}

/** Czy ocena jest już publiczna. */
export function isVisible(review: ReviewTiming, now: Date): boolean {
  return review.visibleAt <= now;
}

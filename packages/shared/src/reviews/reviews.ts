// Oceny (F-30, PROJECT.md §5): skala, okno, ujawnienie i walidacja komentarza. Wspólne dla API
// (reguły, walidacja) i klientów (formularz, licznik, podpowiedź przed wysłaniem).
import { type ContactFlag, detectContactData } from '../messaging/messaging.js';

/** Oceny 1–5 (całkowite). */
export const REVIEW_RATINGS = [1, 2, 3, 4, 5] as const;
export type ReviewRating = (typeof REVIEW_RATINGS)[number];

/** Rola autora oceny w zamówieniu: kupujący ocenia sprzedającego i odwrotnie. */
export const REVIEW_ROLES = ['BUYER', 'SELLER'] as const;
export type ReviewRole = (typeof REVIEW_ROLES)[number];

/** Komentarz: opcjonalny, najwyżej tyle znaków po przycięciu. */
export const REVIEW_LIMITS = { commentMax: 1000 } as const;

/** Okno na ocenę od zakończenia zamówienia i najpóźniejsze ujawnienie pierwszej oceny (decyzja nr 142). */
export const REVIEW_WINDOW_DAYS = 14;
export const REVIEW_REVEAL_DAYS = 7;

/** Powód, dla którego komentarz nie przejdzie walidacji. */
export type ReviewCommentIssue = 'TOO_LONG' | 'CONTACT_DATA';

/** Komentarz po przycięciu; pusty to brak komentarza (null). */
export function normalizeReviewComment(comment: string | null | undefined): string | null {
  const trimmed = comment?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/**
 * Problem z komentarzem albo undefined. Komentarz jest publiczny, więc dane kontaktowe (telefon,
 * e-mail, numer konta) blokują zapis, a nie tylko ostrzegają jak w wiadomościach.
 */
export function reviewCommentIssue(
  comment: string | null | undefined,
): ReviewCommentIssue | undefined {
  const normalized = normalizeReviewComment(comment);
  if (normalized === null) {
    return undefined;
  }
  if ([...normalized].length > REVIEW_LIMITS.commentMax) {
    return 'TOO_LONG';
  }
  return reviewContactFlags(normalized).length > 0 ? 'CONTACT_DATA' : undefined;
}

/** Dane kontaktowe w komentarzu (podpowiedź w formularzu). */
export function reviewContactFlags(comment: string): ContactFlag[] {
  return detectContactData(comment);
}

/** Komunikaty walidacji komentarza (API i formularz). */
export const REVIEW_COMMENT_MESSAGES: Readonly<Record<ReviewCommentIssue, string>> = {
  TOO_LONG: `Komentarz może mieć najwyżej ${String(REVIEW_LIMITS.commentMax)} znaków.`,
  CONTACT_DATA: 'Komentarz jest publiczny: usuń numer telefonu, adres e-mail albo numer konta.',
};

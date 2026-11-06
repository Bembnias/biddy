// Oceny w web (F-30): format średniej i adres ocen na profilu.
import { publicProfileUrl } from '@/lib/routes';

/** Średnia z jednym miejscem po przecinku (np. 4,75 → „4,8”). */
export const AVERAGE_FORMAT = { minimumFractionDigits: 1, maximumFractionDigits: 1 } as const;

/** Kotwica sekcji ocen na profilu publicznym. */
export const REVIEWS_ANCHOR = 'oceny';

/** Oceny użytkownika na jego profilu publicznym. */
export function profileReviewsUrl(userId: string): string {
  return `${publicProfileUrl(userId)}#${REVIEWS_ANCHOR}`;
}

/** Liczba pełnych gwiazdek dla średniej (zaokrąglenie do całości). */
export function filledStars(average: number): number {
  return Math.min(5, Math.max(0, Math.round(average)));
}

import { describe, expect, it } from 'vitest';

import {
  normalizeReviewComment,
  REVIEW_LIMITS,
  REVIEW_RATINGS,
  reviewCommentIssue,
  reviewContactFlags,
} from './reviews.js';

describe('oceny (F-30)', () => {
  it('skala 1–5', () => {
    expect(REVIEW_RATINGS).toEqual([1, 2, 3, 4, 5]);
  });

  it('przycina komentarz, a pusty zamienia na brak', () => {
    expect(normalizeReviewComment('  Super kontakt  ')).toBe('Super kontakt');
    expect(normalizeReviewComment(' \n\t ')).toBeNull();
    expect(normalizeReviewComment(undefined)).toBeNull();
    expect(normalizeReviewComment(null)).toBeNull();
  });

  it('komentarz jest opcjonalny', () => {
    expect(reviewCommentIssue(undefined)).toBeUndefined();
    expect(reviewCommentIssue('   ')).toBeUndefined();
    expect(reviewCommentIssue('Przedmiot zgodny z opisem, szybka wysyłka.')).toBeUndefined();
  });

  it('limit długości liczy znaki po przycięciu', () => {
    const max = 'a'.repeat(REVIEW_LIMITS.commentMax);
    expect(reviewCommentIssue(`  ${max}  `)).toBeUndefined();
    expect(reviewCommentIssue(`${max}a`)).toBe('TOO_LONG');
    // Emoji to jeden znak, choć w UTF-16 zajmuje dwie jednostki.
    expect(reviewCommentIssue('🙂'.repeat(REVIEW_LIMITS.commentMax))).toBeUndefined();
  });

  it('odrzuca dane kontaktowe w komentarzu publicznym', () => {
    expect(reviewCommentIssue('Pisz na 600 700 800')).toBe('CONTACT_DATA');
    expect(reviewCommentIssue('jan.kowalski@example.com')).toBe('CONTACT_DATA');
    expect(reviewCommentIssue('Wpłać na PL61 1090 1014 0000 0712 1981 2874')).toBe('CONTACT_DATA');
    expect(reviewContactFlags('Zadzwoń: +48 600 700 800')).toEqual(['PHONE']);
  });

  it('ceny i daty w komentarzu przechodzą', () => {
    expect(reviewCommentIssue('Kupione za 120 zł, doszło 3.11.2026.')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';

import {
  firstReviewVisibleAt,
  isVisible,
  rateUntil,
  REVIEW_REVEAL_MS,
  REVIEW_WINDOW_MS,
  type ReviewableOrder,
  reviewBlocker,
  reviewWindowEnd,
  reviewWindowStart,
} from './review-rules.js';

const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(Date.UTC(2026, 10, 1) + days * DAY);

const completed: ReviewableOrder = {
  status: 'COMPLETED',
  completedAt: at(0),
  refundedAt: null,
  disputedAt: null,
};

describe('okno oceny (F-30)', () => {
  it('liczy się od zakończenia albo zwrotu po sporze', () => {
    expect(reviewWindowStart(completed)).toEqual(at(0));
    expect(
      reviewWindowStart({
        status: 'REFUNDED',
        completedAt: null,
        refundedAt: at(2),
        disputedAt: at(1),
      }),
    ).toEqual(at(2));
    expect(
      reviewWindowStart({
        status: 'PARTIALLY_REFUNDED',
        completedAt: null,
        refundedAt: at(3),
        disputedAt: at(1),
      }),
    ).toEqual(at(3));
    expect(reviewWindowEnd(completed)).toEqual(new Date(at(0).getTime() + REVIEW_WINDOW_MS));
  });

  it('zwrot bez sporu i zamówienie w toku nie dają oceny', () => {
    expect(
      reviewWindowStart({
        status: 'REFUNDED',
        completedAt: null,
        refundedAt: at(2),
        disputedAt: null,
      }),
    ).toBeNull();
    for (const status of ['PAID', 'SHIPPED', 'DELIVERED', 'DISPUTED', 'LOST', 'CANCELLED_UNPAID']) {
      expect(reviewWindowStart({ ...completed, status })).toBeNull();
    }
  });
});

describe('ujawnienie i termin', () => {
  it('pierwsza ocena odsłania się po 7 dniach albo z końcem okna', () => {
    const windowEnd = at(14);
    expect(firstReviewVisibleAt(at(1), windowEnd)).toEqual(
      new Date(at(1).getTime() + REVIEW_REVEAL_MS),
    );
    expect(firstReviewVisibleAt(at(10), windowEnd)).toEqual(windowEnd);
  });

  it('termin strony kończy się z ujawnieniem oceny drugiej strony', () => {
    const windowEnd = at(14);
    expect(rateUntil(windowEnd, undefined)).toEqual(windowEnd);
    expect(rateUntil(windowEnd, { createdAt: at(2), visibleAt: at(9) })).toEqual(at(9));
    expect(rateUntil(windowEnd, { createdAt: at(10), visibleAt: at(14) })).toEqual(windowEnd);
  });

  it('isVisible porównuje z chwilą odczytu', () => {
    expect(isVisible({ createdAt: at(0), visibleAt: at(7) }, at(6))).toBe(false);
    expect(isVisible({ createdAt: at(0), visibleAt: at(7) }, at(7))).toBe(true);
  });
});

describe('reviewBlocker', () => {
  it('pozwala ocenić w oknie', () => {
    expect(reviewBlocker(completed, undefined, undefined, at(13))).toBeNull();
  });

  it('po 14 dniach okno jest zamknięte', () => {
    expect(reviewBlocker(completed, undefined, undefined, at(14))).toBe('WINDOW_CLOSED');
  });

  it('jedna ocena na stronę', () => {
    expect(reviewBlocker(completed, { createdAt: at(1), visibleAt: at(8) }, undefined, at(2))).toBe(
      'ALREADY_REVIEWED',
    );
  });

  it('po ujawnieniu oceny drugiej strony nie można już ocenić', () => {
    const theirs = { createdAt: at(1), visibleAt: at(8) };
    expect(reviewBlocker(completed, undefined, theirs, at(7))).toBeNull();
    expect(reviewBlocker(completed, undefined, theirs, at(8))).toBe('WINDOW_CLOSED');
  });

  it('zamówienie w toku', () => {
    expect(reviewBlocker({ ...completed, status: 'DELIVERED' }, undefined, undefined, at(1))).toBe(
      'NOT_FINISHED',
    );
  });
});

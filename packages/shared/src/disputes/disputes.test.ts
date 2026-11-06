import { describe, expect, it } from 'vitest';

import { DISPUTE_REASONS, DISPUTE_TEXT_LIMITS, disputeReasonRequiresPhoto } from './index.js';

describe('spory', () => {
  it('wymaga zdjęcia przy problemach z samym przedmiotem', () => {
    expect(DISPUTE_REASONS.filter((reason) => disputeReasonRequiresPhoto(reason))).toEqual([
      'NOT_AS_DESCRIBED',
      'DAMAGED',
      'INCOMPLETE',
      'COUNTERFEIT',
    ]);
  });

  it('ma limity tekstów z minimum mniejszym od maksimum', () => {
    for (const { min, max } of Object.values(DISPUTE_TEXT_LIMITS)) {
      expect(min).toBeGreaterThan(0);
      expect(max).toBeGreaterThan(min);
    }
  });
});

import { describe, expect, it } from 'vitest';

import { AVERAGE_FORMAT, filledStars, profileReviewsUrl } from './reviews';

describe('oceny w web (F-30)', () => {
  it('średnia z jednym miejscem po przecinku', () => {
    const format = new Intl.NumberFormat('pl-PL', AVERAGE_FORMAT);
    expect(format.format(4.75)).toBe('4,8');
    expect(format.format(5)).toBe('5,0');
  });

  it('gwiazdki dla średniej', () => {
    expect(filledStars(4.5)).toBe(5);
    expect(filledStars(4.49)).toBe(4);
    expect(filledStars(1)).toBe(1);
  });

  it('link do ocen na profilu', () => {
    expect(profileReviewsUrl('0190f0aa-0000-7000-8000-000000000001')).toBe(
      '/u/0190f0aa-0000-7000-8000-000000000001#oceny',
    );
  });
});

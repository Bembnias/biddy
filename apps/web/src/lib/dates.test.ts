import { describe, expect, it } from 'vitest';

import { monthAndYear } from './dates';

describe('monthAndYear', () => {
  it.each([
    ['2026-10-01T10:00:00Z', 'października 2026'],
    ['2026-01-15T10:00:00Z', 'stycznia 2026'],
    // Północ w Warszawie to jeszcze 31 grudnia w UTC.
    ['2026-12-31T23:30:00Z', 'stycznia 2027'],
  ])('%s → %s', (iso, expected) => {
    expect(monthAndYear(new Date(iso))).toBe(expected);
  });
});

import { describe, expect, it } from 'vitest';

import { isHotAuction, isLiveAuction, timerTone } from '../index.js';

const NOW = Date.parse('2026-10-26T12:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const auction = (left: number, overrides: { status?: string; bidCount?: number } = {}) => ({
  status: overrides.status ?? 'ACTIVE',
  bidCount: overrides.bidCount ?? 0,
  endsAt: new Date(NOW + left).toISOString(),
});

describe('timerTone (F-63)', () => {
  it.each([
    [3 * 24 * HOUR, 'calm'],
    [24 * HOUR, 'calm'],
    [24 * HOUR - 1, 'soon'],
    [HOUR, 'soon'],
    [HOUR - 1, 'urgent'],
    [0, 'urgent'],
  ])('do końca %i ms → %s', (left, tone) => {
    expect(timerTone(left)).toBe(tone);
  });
});

describe('isLiveAuction (F-63)', () => {
  it('aktywna aukcja w ostatniej godzinie', () => {
    expect(isLiveAuction(auction(59 * MINUTE), NOW)).toBe(true);
    expect(isLiveAuction(auction(HOUR), NOW)).toBe(false);
  });

  it('nie: po czasie, po zakończeniu, bez końca', () => {
    expect(isLiveAuction(auction(-1), NOW)).toBe(false);
    expect(isLiveAuction(auction(10 * MINUTE, { status: 'ENDED_SOLD' }), NOW)).toBe(false);
    expect(isLiveAuction({ status: 'ACTIVE', bidCount: 0, endsAt: null }, NOW)).toBe(false);
  });
});

describe('isHotAuction (F-63)', () => {
  it('co najmniej 5 ofert i mniej niż doba do końca', () => {
    expect(isHotAuction(auction(23 * HOUR, { bidCount: 5 }), NOW)).toBe(true);
    expect(isHotAuction(auction(23 * HOUR, { bidCount: 4 }), NOW)).toBe(false);
    expect(isHotAuction(auction(24 * HOUR, { bidCount: 9 }), NOW)).toBe(false);
  });

  it('nie po zakończeniu', () => {
    expect(isHotAuction(auction(HOUR, { bidCount: 9, status: 'ENDED_SOLD' }), NOW)).toBe(false);
    expect(isHotAuction(auction(-1, { bidCount: 9 }), NOW)).toBe(false);
  });
});

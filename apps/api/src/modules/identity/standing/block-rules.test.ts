import { type AccountPolicy, DEFAULT_ACCOUNT_POLICY } from '@biddy/shared';
import { describe, expect, it } from 'vitest';

import {
  type BlockFact,
  blockDecision,
  countableStrikes,
  counterfeitBlocks,
  isBlockActive,
  type StrikeFact,
  strongestActiveBlock,
} from './block-rules.js';

const NOW = new Date('2026-11-02T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);
const POLICY: AccountPolicy = DEFAULT_ACCOUNT_POLICY;

function strike(id: string, ageDays: number, overrides: Partial<StrikeFact> = {}): StrikeFact {
  return { id, role: 'BUYER', createdAt: daysAgo(ageDays), revokedAt: null, ...overrides };
}

function block(id: string, overrides: Partial<BlockFact> = {}): BlockFact {
  return {
    id,
    kind: 'BIDDING',
    cause: 'STRIKES',
    strikeIds: [],
    startsAt: daysAgo(10),
    endsAt: new Date(daysAgo(10).getTime() + 30 * DAY),
    liftedAt: null,
    ...overrides,
  };
}

describe('blockDecision (§4.1: 3 strike’i w 90 dni)', () => {
  it('2 strike’i nie dają blokady', () => {
    expect(
      blockDecision('BUYER', [strike('a', 5), strike('b', 1)], [], POLICY, NOW),
    ).toBeUndefined();
  });

  it('trzeci strike blokuje licytowanie na 30 dni', () => {
    const decision = blockDecision(
      'BUYER',
      [strike('a', 50), strike('b', 5), strike('c', 0)],
      [],
      POLICY,
      NOW,
    );
    expect(decision).toEqual({
      kind: 'BIDDING',
      cause: 'STRIKES',
      strikeIds: ['a', 'b', 'c'],
      startsAt: NOW,
      endsAt: new Date(NOW.getTime() + 30 * DAY),
      escalated: false,
    });
  });

  it('strike starszy niż 90 dni się nie liczy', () => {
    expect(
      blockDecision('BUYER', [strike('a', 91), strike('b', 5), strike('c', 0)], [], POLICY, NOW),
    ).toBeUndefined();
  });

  it('cofnięty strike się nie liczy', () => {
    expect(
      blockDecision(
        'BUYER',
        [strike('a', 10, { revokedAt: daysAgo(1) }), strike('b', 5), strike('c', 0)],
        [],
        POLICY,
        NOW,
      ),
    ).toBeUndefined();
  });

  it('strike’i drugiej roli się nie liczą', () => {
    expect(
      blockDecision(
        'BUYER',
        [strike('a', 10, { role: 'SELLER' }), strike('b', 5), strike('c', 0)],
        [],
        POLICY,
        NOW,
      ),
    ).toBeUndefined();
  });

  it('strike’i zużyte przez poprzednią blokadę się nie liczą', () => {
    const expired = block('old', {
      strikeIds: ['a', 'b', 'c'],
      startsAt: daysAgo(40),
      endsAt: daysAgo(10),
    });
    const strikes = [strike('a', 45), strike('b', 44), strike('c', 40), strike('d', 0)];
    expect(blockDecision('BUYER', strikes, [expired], POLICY, NOW)).toBeUndefined();
  });

  it('przy aktywnej blokadzie nie powstaje druga', () => {
    const active = block('now', { strikeIds: ['x'] });
    const strikes = [strike('a', 3), strike('b', 2), strike('c', 0)];
    expect(blockDecision('BUYER', strikes, [active], POLICY, NOW)).toBeUndefined();
  });

  it('druga blokada w ciągu 12 miesięcy jest bezterminowa', () => {
    const earlier = block('old', {
      strikeIds: ['o1', 'o2', 'o3'],
      startsAt: daysAgo(200),
      endsAt: daysAgo(170),
    });
    const decision = blockDecision(
      'BUYER',
      [strike('a', 3), strike('b', 2), strike('c', 0)],
      [earlier],
      POLICY,
      NOW,
    );
    expect(decision).toMatchObject({ endsAt: null, escalated: true });
  });

  it('blokada sprzed ponad roku nie eskaluje', () => {
    const earlier = block('old', {
      strikeIds: ['o1'],
      startsAt: daysAgo(366),
      endsAt: daysAgo(336),
    });
    const decision = blockDecision(
      'BUYER',
      [strike('a', 3), strike('b', 2), strike('c', 0)],
      [earlier],
      POLICY,
      NOW,
    );
    expect(decision).toMatchObject({ escalated: false });
  });

  it('zdjęta blokada nie eskaluje', () => {
    const lifted = block('old', {
      strikeIds: ['o1'],
      startsAt: daysAgo(60),
      endsAt: daysAgo(30),
      liftedAt: daysAgo(50),
    });
    const decision = blockDecision(
      'BUYER',
      [strike('a', 3), strike('b', 2), strike('c', 0)],
      [lifted],
      POLICY,
      NOW,
    );
    expect(decision).toMatchObject({ escalated: false });
  });

  it('strike’i sprzedającego blokują wystawianie', () => {
    const strikes = ['a', 'b', 'c'].map((id) => strike(id, 1, { role: 'SELLER' }));
    expect(blockDecision('SELLER', strikes, [], POLICY, NOW)?.kind).toBe('LISTING');
  });
});

describe('countableStrikes', () => {
  it('od najstarszego, bez zużytych, cofniętych i spoza okna', () => {
    const consumed = block('b1', { strikeIds: ['a'], liftedAt: null });
    const counted = countableStrikes(
      'BUYER',
      [strike('c', 1), strike('a', 10), strike('b', 5), strike('old', 95)],
      [consumed],
      POLICY,
      NOW,
    );
    expect(counted.map((item) => item.id)).toEqual(['b', 'c']);
  });
});

describe('counterfeitBlocks', () => {
  it('bezterminowa blokada wystawiania i wypłat', () => {
    expect(counterfeitBlocks('s1', [], NOW)).toEqual([
      expect.objectContaining({ kind: 'LISTING', cause: 'COUNTERFEIT', endsAt: null }),
      expect.objectContaining({ kind: 'PAYOUTS', cause: 'COUNTERFEIT', endsAt: null }),
    ]);
  });

  it('pomija rodzaj, który ma już bezterminową blokadę; terminowa nie wystarcza', () => {
    const indefinite = block('l', { kind: 'LISTING', endsAt: null });
    const timed = block('p', { kind: 'PAYOUTS' });
    expect(counterfeitBlocks('s1', [indefinite, timed], NOW).map((item) => item.kind)).toEqual([
      'PAYOUTS',
    ]);
  });
});

describe('isBlockActive i strongestActiveBlock', () => {
  it('wygasła i zdjęta nie działają', () => {
    expect(isBlockActive(block('a', { endsAt: daysAgo(1) }), NOW)).toBe(false);
    expect(isBlockActive(block('a', { liftedAt: daysAgo(1) }), NOW)).toBe(false);
    expect(isBlockActive(block('a', { endsAt: null }), NOW)).toBe(true);
  });

  it('bezterminowa wygrywa z terminową, dłuższa z krótszą', () => {
    const short = block('short');
    const long = block('long', { endsAt: new Date(NOW.getTime() + 90 * DAY) });
    const forever = block('forever', { endsAt: null });
    expect(strongestActiveBlock([short, long], 'BIDDING', NOW)?.id).toBe('long');
    expect(strongestActiveBlock([short, forever, long], 'BIDDING', NOW)?.id).toBe('forever');
    expect(strongestActiveBlock([short], 'LISTING', NOW)).toBeUndefined();
  });
});

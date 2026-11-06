import { describe, expect, it } from 'vitest';

import {
  carrierClaimType,
  decisionDueAt,
  outcomeSummary,
  responseDueAt,
  returnInspectionEndsAt,
  returnShipBy,
  returnSteps,
} from './dispute-rules.js';

const HOUR_MS = 60 * 60 * 1_000;

describe('terminy sporu (§7.4)', () => {
  const now = new Date('2026-11-03T10:00:00.000Z');

  it('odpowiedź strony 48 h, decyzja Biddy 72 h, sprawdzenie zwrotu 36 h', () => {
    expect(responseDueAt(now).getTime() - now.getTime()).toBe(48 * HOUR_MS);
    expect(decisionDueAt(now).getTime() - now.getTime()).toBe(72 * HOUR_MS);
    expect(returnInspectionEndsAt(now).getTime() - now.getTime()).toBe(36 * HOUR_MS);
  });

  it('nadanie zwrotu: północ po 5. dniu roboczym z kalendarzem świąt', () => {
    // Wtorek 3.11 → 4, 5, 6, 9, 10 listopada; 11 listopada (święto) nie wchodzi.
    expect(returnShipBy(now).toISOString()).toBe('2026-11-10T23:00:00.000Z');
    // Od 9.11: 10, 12, 13, 16, 17 listopada (11 listopada pominięty).
    expect(returnShipBy(new Date('2026-11-09T09:00:00.000Z')).toISOString()).toBe(
      '2026-11-17T23:00:00.000Z',
    );
  });
});

describe('tracking zwrotu', () => {
  it('pierwszy status u przewoźnika to nadanie, a odebranie od razu dokłada odbiór', () => {
    expect(returnSteps('AWAITING_RETURN', 'CREATED')).toEqual([]);
    expect(returnSteps('AWAITING_RETURN', 'DROPPED_OFF')).toEqual(['SHIPPED']);
    expect(returnSteps('AWAITING_RETURN', 'DELIVERED')).toEqual(['SHIPPED', 'DELIVERED']);
    expect(returnSteps('RETURN_IN_TRANSIT', 'IN_TRANSIT')).toEqual([]);
    expect(returnSteps('RETURN_IN_TRANSIT', 'DELIVERED')).toEqual(['DELIVERED']);
  });

  it('zwrot wracający do kupującego trafia do supportu, a stany po odbiorze nic nie zmieniają', () => {
    expect(returnSteps('RETURN_IN_TRANSIT', 'RETURNING')).toEqual(['FAILED']);
    expect(returnSteps('AWAITING_RETURN', 'RETURNING')).toEqual(['SHIPPED', 'FAILED']);
    expect(returnSteps('RETURN_DELIVERED', 'DELIVERED')).toEqual([]);
    expect(returnSteps('ESCALATED', 'DELIVERED')).toEqual([]);
  });
});

describe('rozstrzygnięcie', () => {
  it('wina przewoźnika: brak paczki to zaginięcie, reszta to uszkodzenie', () => {
    expect(carrierClaimType('NOT_RECEIVED')).toBe('LOST');
    expect(carrierClaimType('DAMAGED')).toBe('DAMAGED');
    expect(carrierClaimType('OTHER')).toBe('DAMAGED');
  });

  it('zdanie o wyniku z kwotą zwrotu częściowego', () => {
    expect(outcomeSummary('PARTIAL_REFUND', { amount: 2_550, currency: 'PLN' })).toMatch(
      /^Kupujący dostaje zwrot 25,50\s+zł\.$/u,
    );
    expect(outcomeSummary('SELLER_FAVOR', null)).toBe(
      'Spór rozstrzygnięty na korzyść sprzedającego.',
    );
  });
});

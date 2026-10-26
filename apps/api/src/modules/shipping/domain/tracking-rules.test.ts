import { describe, expect, it } from 'vitest';

import type { TrackingEvent } from '../ports/shipping-provider.port.js';
import type { ShipmentStatus, TrackingStatus } from './shipping-values.js';
import { type TrackingState, statusChanges } from './tracking-rules.js';

const T0 = Date.parse('2026-10-22T08:00:00.000Z');
const at = (minutes: number) => new Date(T0 + minutes * 60_000);

function event(status: TrackingStatus, minutes: number, raw = status.toLowerCase()): TrackingEvent {
  return { rawStatus: raw, status, occurredAt: at(minutes), description: null };
}

function state(status: ShipmentStatus, minutes = 0, reached: ShipmentStatus[] = []): TrackingState {
  return { status, statusChangedAt: at(minutes), reached: new Set([status, ...reached]) };
}

describe('statusChanges (§8.3)', () => {
  it('kilka nowych statusów naraz: osobna zmiana dla każdego, w kolejności chronologicznej', () => {
    const changes = statusChanges(state('CREATED'), [
      event('DELIVERED', 40),
      event('DROPPED_OFF', 10),
      event('READY_FOR_PICKUP', 30),
      event('IN_TRANSIT', 20),
    ]);
    expect(changes.map((change) => [change.previousStatus, change.status])).toEqual([
      ['CREATED', 'DROPPED_OFF'],
      ['DROPPED_OFF', 'IN_TRANSIT'],
      ['IN_TRANSIT', 'READY_FOR_PICKUP'],
      ['READY_FOR_PICKUP', 'DELIVERED'],
    ]);
    expect(changes.at(-1)?.occurredAt).toEqual(at(40));
  });

  it('zdarzenie starsze niż bieżący status i powtórzony status niczego nie zmieniają', () => {
    expect(statusChanges(state('IN_TRANSIT', 20), [event('DROPPED_OFF', 10)])).toEqual([]);
    expect(statusChanges(state('IN_TRANSIT', 20), [event('IN_TRANSIT', 25, 'transit-2')])).toEqual(
      [],
    );
  });

  it('statusy końcowe zostają (późne zdarzenie po doręczeniu, anulowaniu, zwrocie)', () => {
    for (const final of ['DELIVERED', 'RETURNED', 'CANCELLED'] as const) {
      expect(statusChanges(state(final, 10), [event('IN_TRANSIT', 20)])).toEqual([]);
    }
  });

  it('EXCEPTION nie jest końcowy: paczka rusza dalej', () => {
    expect(
      statusChanges(state('EXCEPTION', 10), [event('IN_TRANSIT', 20)]).map((c) => c.status),
    ).toEqual(['IN_TRANSIT']);
  });

  it('zwrot paczki, która czekała w punkcie albo u kuriera: NOT_COLLECTED (§7.4)', () => {
    const fromPoint = statusChanges(state('READY_FOR_PICKUP', 30), [
      event('RETURNING', 50),
      event('RETURNED', 70),
    ]);
    expect(fromPoint.map((change) => [change.status, change.returnReason])).toEqual([
      ['RETURNING', 'NOT_COLLECTED'],
      ['RETURNED', null],
    ]);
    const viaHistory = statusChanges(state('EXCEPTION', 40, ['OUT_FOR_DELIVERY']), [
      event('RETURNING', 50),
    ]);
    expect(viaHistory[0]?.returnReason).toBe('NOT_COLLECTED');
  });

  it('zwrot w drodze (paczka nie dotarła do kupującego): OTHER, chyba że dostawca poda powód', () => {
    expect(statusChanges(state('IN_TRANSIT', 20), [event('RETURNING', 30)])[0]?.returnReason).toBe(
      'OTHER',
    );
    expect(
      statusChanges(state('IN_TRANSIT', 20), [
        { ...event('RETURNING', 30), returnReason: 'NOT_COLLECTED' },
      ])[0]?.returnReason,
    ).toBe('NOT_COLLECTED');
  });

  it('w jednej porcji: punkt odbioru, a potem zwrot daje NOT_COLLECTED', () => {
    const changes = statusChanges(state('IN_TRANSIT', 20), [
      event('READY_FOR_PICKUP', 30),
      event('RETURNING', 60),
    ]);
    expect(changes[1]?.returnReason).toBe('NOT_COLLECTED');
  });
});

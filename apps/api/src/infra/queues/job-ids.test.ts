import { describe, expect, it } from 'vitest';

import { InvalidJobIdError, deadlineJobId, eventJobId } from './job-ids.js';

const AUCTION_ID = '0199d0a0-1234-7000-8000-00000000abcd';

describe('deadlineJobId (PROJECT.md §15.2)', () => {
  it('ID zawiera rodzaj, encję i termin w milisekundach epoki', () => {
    const endsAt = new Date('2026-12-24T19:00:00.000Z');
    expect(deadlineJobId('close', AUCTION_ID, endsAt)).toBe(
      `close-${AUCTION_ID}-${endsAt.getTime()}`,
    );
    expect(deadlineJobId('order.payment-deadline', 'abc', 1_000)).toBe(
      'order.payment-deadline-abc-1000',
    );
  });

  it('nowy termin to nowe ID, ten sam termin to to samo ID (deduplikacja w BullMQ)', () => {
    const endsAt = new Date('2026-12-24T19:00:00.000Z');
    const extended = new Date(endsAt.getTime() + 120_000);
    expect(deadlineJobId('close', AUCTION_ID, extended)).not.toBe(
      deadlineJobId('close', AUCTION_ID, endsAt),
    );
    expect(deadlineJobId('close', AUCTION_ID, new Date(endsAt))).toBe(
      deadlineJobId('close', AUCTION_ID, endsAt),
    );
  });

  it.each([
    ['rodzaj z wielką literą', 'Close', AUCTION_ID, 0],
    ['pusty rodzaj', '', AUCTION_ID, 0],
    ['dwukropek w ID encji (BullMQ go odrzuca)', 'close', 'a:b', 0],
    ['puste ID encji', 'close', '', 0],
    ['termin ujemny', 'close', AUCTION_ID, -1],
    ['termin ułamkowy', 'close', AUCTION_ID, 1.5],
    ['niepoprawna data', 'close', AUCTION_ID, new Date('x')],
  ])('odrzuca: %s', (_label, kind, entityId, deadline) => {
    expect(() => deadlineJobId(kind, entityId, deadline)).toThrow(InvalidJobIdError);
  });
});

describe('eventJobId', () => {
  it('ID joba konsumenta: {konsument}-{eventId}', () => {
    expect(eventJobId('notifications.outbid-email', AUCTION_ID)).toBe(
      `notifications.outbid-email-${AUCTION_ID}`,
    );
  });

  it('odrzuca dwukropek', () => {
    expect(() => eventJobId('a:b', AUCTION_ID)).toThrow(InvalidJobIdError);
  });
});

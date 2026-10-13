import { UnrecoverableError } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineDomainEvent, type DomainEvent } from './domain-event.js';
import { eventSubscriptions, parseDeliveredEvent } from './event-consumers.js';
import { InvalidConsumerError, OnDomainEvent } from './on-domain-event.js';
import { relayBackoff, toDomainEvent } from './outbox-relay.js';

const AuctionEnded = defineDomainEvent({
  type: 'AuctionEnded',
  version: 2,
  aggregateType: 'auction',
  payload: z.object({ winnerId: z.uuid().nullable() }),
});
const BidPlaced = defineDomainEvent({
  type: 'BidPlaced',
  version: 1,
  aggregateType: 'auction',
  payload: z.object({ amount: z.int() }),
});

function consumer(event: typeof AuctionEnded | typeof BidPlaced, name: string) {
  return {
    metadata: { event, consumer: name },
    source: `Test.${name}`,
    invoke: () => Promise.resolve(undefined),
  };
}

const delivered: DomainEvent = {
  id: '0199d0a0-0000-7000-8000-000000000001',
  type: 'AuctionEnded',
  version: 2,
  aggregateType: 'auction',
  aggregateId: 'auction-1',
  occurredAt: '2026-12-24T19:00:00.000Z',
  payload: { winnerId: null },
  metadata: { requestId: 'req-1' },
};

describe('eventSubscriptions', () => {
  it('mapuje typ eventu na nazwy jego konsumentów', () => {
    const subscriptions = eventSubscriptions([
      consumer(AuctionEnded, 'notifications.auction-ended'),
      consumer(AuctionEnded, 'search.reindex-auction'),
      consumer(BidPlaced, 'notifications.outbid-email'),
    ]);
    expect(Object.fromEntries(subscriptions)).toEqual({
      AuctionEnded: ['notifications.auction-ended', 'search.reindex-auction'],
      BidPlaced: ['notifications.outbid-email'],
    });
  });
});

describe('parseDeliveredEvent', () => {
  const metadata = { event: AuctionEnded, consumer: 'notifications.auction-ended' };

  it('zwraca event z payloadem po walidacji schematem', () => {
    expect(parseDeliveredEvent(metadata, delivered)).toEqual(delivered);
  });

  it('inna wersja eventu → UnrecoverableError (ponawianie nic nie zmieni, job idzie do DLQ)', () => {
    expect(() => parseDeliveredEvent(metadata, { ...delivered, version: 1 })).toThrow(
      UnrecoverableError,
    );
    expect(() => parseDeliveredEvent(metadata, { ...delivered, version: 1 })).toThrow(
      'Konsument notifications.auction-ended obsługuje AuctionEnded v2, a dostał AuctionEnded v1',
    );
  });

  it('payload niezgodny ze schematem → UnrecoverableError', () => {
    expect(() =>
      parseDeliveredEvent(metadata, { ...delivered, payload: { winnerId: 'nie-uuid' } }),
    ).toThrow(UnrecoverableError);
  });
});

describe('@OnDomainEvent', () => {
  it.each(['outbid-email', 'Notifications.outbid', 'notifications.outbid.email', 'a.b_c'])(
    'odrzuca nazwę konsumenta „%s” (oczekiwano <moduł>.<nazwa>)',
    (name) => {
      expect(() => OnDomainEvent(AuctionEnded, { consumer: name })).toThrow(InvalidConsumerError);
    },
  );
});

describe('relay outboxa', () => {
  it('toDomainEvent: wiersz outboxa jako koperta eventu (czas w ISO 8601)', () => {
    expect(
      toDomainEvent({
        id: delivered.id,
        type: 'AuctionEnded',
        version: 2,
        aggregateType: 'auction',
        aggregateId: 'auction-1',
        payload: { winnerId: null },
        metadata: { requestId: 'req-1' },
        occurredAt: new Date('2026-12-24T19:00:00.000Z'),
        publishedAt: null,
      }),
    ).toEqual(delivered);
  });

  it('relayBackoff: podwaja odstęp po każdym błędzie z rzędu, do limitu', () => {
    expect([1, 2, 3, 10].map((failures) => relayBackoff(failures, 250, 30_000))).toEqual([
      500, 1_000, 2_000, 30_000,
    ]);
  });
});

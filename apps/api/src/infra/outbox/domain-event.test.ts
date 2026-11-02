import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { InvalidDomainEventError, defineDomainEvent } from './domain-event.js';

const money = z.object({ amount: z.int().nonnegative(), currency: z.literal('PLN') });

const AuctionEnded = defineDomainEvent({
  type: 'AuctionEnded',
  version: 1,
  aggregateType: 'auction',
  payload: z.object({
    winnerId: z.uuid().nullable(),
    finalPrice: money,
    endedAt: z.iso.datetime(),
    reason: z.enum(['SOLD', 'NO_BIDS']).default('SOLD'),
  }),
});

describe('defineDomainEvent', () => {
  it('create: waliduje payload, uzupełnia wartości domyślne i usuwa nieznane pola', () => {
    const event = AuctionEnded.create({
      aggregateId: 'auction-1',
      payload: {
        winnerId: null,
        finalPrice: { amount: 12_345, currency: 'PLN' },
        endedAt: '2026-12-24T19:00:00.000Z',
        // @ts-expect-error pole spoza schematu
        extra: 'x',
      },
    });

    expect(event).toEqual({
      type: 'AuctionEnded',
      version: 1,
      aggregateType: 'auction',
      aggregateId: 'auction-1',
      payload: {
        winnerId: null,
        finalPrice: { amount: 12_345, currency: 'PLN' },
        endedAt: '2026-12-24T19:00:00.000Z',
        reason: 'SOLD',
      },
    });
  });

  it('create: zły payload kończy się błędem walidacji przed zapisem', () => {
    expect(() =>
      AuctionEnded.create({
        aggregateId: 'auction-1',
        payload: {
          winnerId: null,
          finalPrice: { amount: -1, currency: 'PLN' },
          endedAt: '24.12.2026',
        },
      }),
    ).toThrow(z.ZodError);
  });

  it.each(['auctionEnded', 'Ended', 'Auction_Ended', 'AUCTION_ENDED', 'auction.ended'])(
    'odrzuca typ „%s” (oczekiwano PascalCase z co najmniej dwóch słów)',
    (type) => {
      expect(() =>
        defineDomainEvent({ type, version: 1, aggregateType: 'auction', payload: z.object({}) }),
      ).toThrow(InvalidDomainEventError);
    },
  );

  it.each([0, -1, 1.5])('odrzuca wersję %s', (version) => {
    expect(() =>
      defineDomainEvent({
        type: 'BidPlaced',
        version,
        aggregateType: 'auction',
        payload: z.object({}),
      }),
    ).toThrow(InvalidDomainEventError);
  });

  it.each(['Auction', 'order_item', ''])('odrzuca rodzaj agregatu „%s”', (aggregateType) => {
    expect(() =>
      defineDomainEvent({ type: 'BidPlaced', version: 1, aggregateType, payload: z.object({}) }),
    ).toThrow(InvalidDomainEventError);
  });

  it.each([
    ['Date', z.object({ at: z.date() })],
    ['BigInt', z.object({ amount: z.bigint() })],
    ['transformacja', z.object({ title: z.string().transform((value) => value.length) })],
  ])('odrzuca payload z typem spoza JSON: %s', (_label, payload) => {
    expect(() =>
      defineDomainEvent({ type: 'BidPlaced', version: 1, aggregateType: 'auction', payload }),
    ).toThrow(/payload musi mieć typy JSON/);
  });
});

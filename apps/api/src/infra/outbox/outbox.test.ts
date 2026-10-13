import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { Transaction } from '../db/index.js';
import { defineDomainEvent } from './domain-event.js';
import { Outbox, metadataFromLogBindings } from './outbox.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const BidPlaced = defineDomainEvent({
  type: 'BidPlaced',
  version: 2,
  aggregateType: 'auction',
  payload: z.object({ amount: z.int() }),
});

function fakeTransaction() {
  const values = vi.fn((rows: unknown[]) => Promise.resolve(rows));
  const insert = vi.fn(() => ({ values }));
  return { tx: { insert } as unknown as Transaction, insert, values };
}

function outboxWithBindings(bindings: Record<string, unknown> | undefined): Outbox {
  const logger = bindings === undefined ? undefined : { bindings: () => bindings };
  return new Outbox({ logger } as unknown as PinoLogger);
}

describe('metadataFromLogBindings', () => {
  it('żądanie HTTP: reqId z loggera Fastify jako requestId', () => {
    expect(metadataFromLogBindings({ reqId: 'req-1', context: 'X' })).toEqual({
      requestId: 'req-1',
    });
  });

  it('job konsumenta: requestId z eventu źródłowego i jego ID jako causationId', () => {
    expect(metadataFromLogBindings({ requestId: 'req-1', eventId: 'evt-1', queue: 'x' })).toEqual({
      requestId: 'req-1',
      causationId: 'evt-1',
    });
  });

  it('poza kontekstem: puste metadane', () => {
    expect(metadataFromLogBindings({ service: 'biddy-api' })).toEqual({});
  });
});

describe('Outbox.add', () => {
  it('zapisuje eventy w podanej transakcji, z ID UUIDv7 i metadanymi z kontekstu logów', async () => {
    const { tx, insert, values } = fakeTransaction();
    const ids = await outboxWithBindings({ reqId: 'req-9' }).add(
      tx,
      BidPlaced.create({ aggregateId: 'auction-1', payload: { amount: 100 } }),
      BidPlaced.create({ aggregateId: 'auction-1', payload: { amount: 200 } }),
    );

    expect(insert).toHaveBeenCalledTimes(1);
    expect(ids).toHaveLength(2);
    expect(ids.every((id) => UUID_V7.test(id))).toBe(true);
    expect(values).toHaveBeenCalledWith([
      {
        id: ids[0],
        type: 'BidPlaced',
        version: 2,
        aggregateType: 'auction',
        aggregateId: 'auction-1',
        payload: { amount: 100 },
        metadata: { requestId: 'req-9' },
      },
      expect.objectContaining({ id: ids[1], payload: { amount: 200 } }),
    ]);
  });

  it('bez eventów niczego nie zapisuje', async () => {
    const { tx, insert } = fakeTransaction();
    expect(await outboxWithBindings({}).add(tx)).toEqual([]);
    expect(insert).not.toHaveBeenCalled();
  });

  it('przed startem loggera (brak loggera głównego) zapisuje puste metadane', async () => {
    const { tx, values } = fakeTransaction();
    await outboxWithBindings(undefined).add(
      tx,
      BidPlaced.create({ aggregateId: 'a', payload: { amount: 1 } }),
    );
    expect(values).toHaveBeenCalledWith([expect.objectContaining({ metadata: {} })]);
  });
});

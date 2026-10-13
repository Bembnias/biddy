// Bull Board: podgląd kolejek BullMQ w przeglądarce (F-04), tylko lokalnie. Osobny proces
// (src/bull-board.ts, `pnpm dev:board`), a nie trasa w API: panel pozwala ponawiać i usuwać
// joby, nie ma uwierzytelniania i potrzebuje luźniejszego CSP niż API. Plik nie jest
// eksportowany z index.ts, żeby API i worker nie ładowały zależności Bull Board.
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import { Queue } from 'bullmq';
import { fastify } from 'fastify';

import type { BullBoardConfig } from '../config/index.js';
import { DEAD_LETTER_QUEUE, QUEUE_DEFINITIONS, QUEUE_NAMES } from './queue-catalog.js';
import { closeQueueRedis, createQueueRedis } from './redis.js';

export interface BullBoardServer {
  /** Adres panelu, np. http://127.0.0.1:3002. */
  readonly url: string;
  close(): Promise<void>;
}

/** Uruchamia serwer Bull Board z kolejkami katalogu i dead-letter queue. */
export async function startBullBoard(config: BullBoardConfig): Promise<BullBoardServer> {
  const redis = createQueueRedis(config.redisUrl, 'producer');
  const queues = [
    ...QUEUE_NAMES.map((name) => ({ name, description: QUEUE_DEFINITIONS[name].description })),
    {
      name: DEAD_LETTER_QUEUE,
      description:
        'Joby, które wyczerpały próby (kopie; oryginały są w zbiorze „failed” swojej kolejki)',
    },
  ].map(({ name, description }) => ({
    queue: new Queue(name, { connection: redis, prefix: config.prefix }),
    description,
  }));
  for (const { queue } of queues) {
    queue.on('error', () => undefined);
  }

  const serverAdapter = new FastifyAdapter();
  createBullBoard({
    queues: queues.map(
      ({ queue, description }) => new BullMQAdapter(queue, { description, allowRetries: true }),
    ),
    serverAdapter,
    options: { uiConfig: { boardTitle: `Biddy · kolejki (${config.prefix})` } },
  });
  serverAdapter.setBasePath('/');

  const server = fastify({ logger: false });
  await server.register(serverAdapter.registerPlugin(), { prefix: '/' });
  try {
    await server.listen({ host: config.host, port: config.port });
  } catch (error) {
    await Promise.all(queues.map(({ queue }) => queue.close()));
    await closeQueueRedis(redis);
    throw error;
  }

  return {
    url: `http://${config.host}:${config.port}`,
    close: async () => {
      await server.close();
      await Promise.all(queues.map(({ queue }) => queue.close()));
      await closeQueueRedis(redis);
    },
  };
}

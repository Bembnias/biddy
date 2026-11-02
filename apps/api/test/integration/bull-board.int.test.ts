// Bull Board (tylko development): panel startuje na 127.0.0.1, pokazuje kolejki z katalogu
// i dead-letter queue, a jego API widzi joby z Redisa kolejek.
import { once } from 'node:events';
import { createServer } from 'node:net';

import { describe, expect, it } from 'vitest';

import { loadBullBoardConfig } from '../../src/infra/config/index.js';
import { startBullBoard } from '../../src/infra/queues/bull-board.js';
import { QUEUE_NAMES } from '../../src/infra/queues/index.js';
import { redisUrl, uniqueQueuePrefix } from './support/worker.js';

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  server.close();
  await once(server, 'close');
  if (address === null || typeof address === 'string') {
    throw new Error('Nie udało się zarezerwować wolnego portu');
  }
  return address.port;
}

describe('Bull Board', () => {
  it('pokazuje kolejki z katalogu i dead-letter queue', async () => {
    const config = loadBullBoardConfig({
      NODE_ENV: 'test',
      REDIS_QUEUE_URL: redisUrl(),
      QUEUE_PREFIX: uniqueQueuePrefix(),
      BULL_BOARD_PORT: String(await freePort()),
    });
    const board = await startBullBoard(config);
    try {
      expect(board.url).toBe(`http://127.0.0.1:${config.port}`);

      const page = await fetch(`${board.url}/`);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toContain('text/html');

      const response = await fetch(`${board.url}/api/queues`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { queues: { name: string }[] };
      expect(body.queues.map((queue) => queue.name).sort()).toEqual(
        [...QUEUE_NAMES, 'dead-letter'].sort(),
      );
    } finally {
      await board.close();
    }
  });
});

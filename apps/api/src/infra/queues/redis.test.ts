import { describe, expect, it } from 'vitest';

import { EvictionPolicyError, assertNoEviction, infoField, reconnectDelay } from './redis.js';

const INFO_MEMORY = [
  '# Memory',
  'used_memory:1046528',
  'maxmemory:0',
  'maxmemory_policy:noeviction',
  '',
].join('\r\n');

function redisWithInfo(info: string) {
  return { info: () => Promise.resolve(info) };
}

describe('infoField', () => {
  it('czyta pole z odpowiedzi INFO (linie CRLF)', () => {
    expect(infoField(INFO_MEMORY, 'maxmemory_policy')).toBe('noeviction');
    expect(infoField(INFO_MEMORY, 'maxmemory')).toBe('0');
  });

  it('brak pola → undefined', () => {
    expect(infoField(INFO_MEMORY, 'nie_ma')).toBeUndefined();
  });
});

describe('assertNoEviction', () => {
  it('noeviction przechodzi', async () => {
    await expect(assertNoEviction(redisWithInfo(INFO_MEMORY))).resolves.toBeUndefined();
  });

  it.each(['allkeys-lru', 'volatile-lru', 'allkeys-random'])(
    '%s → EvictionPolicyError z nazwą polityki i wskazówką',
    async (policy) => {
      const info = INFO_MEMORY.replace('noeviction', policy);
      const error = await assertNoEviction(redisWithInfo(info)).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(EvictionPolicyError);
      expect((error as EvictionPolicyError).policy).toBe(policy);
      expect((error as Error).message).toContain(`maxmemory-policy ${policy}`);
      expect((error as Error).message).toContain('noeviction');
      expect((error as Error).message).toContain('REDIS_QUEUE_URL');
    },
  );

  it('polityka, której nie da się odczytać, też blokuje start', async () => {
    await expect(assertNoEviction(redisWithInfo('# Memory\r\n'))).rejects.toThrow(
      /nie udało się odczytać/,
    );
  });
});

describe('reconnectDelay', () => {
  it('rośnie o 200 ms do 5 s', () => {
    expect([1, 2, 10, 25, 100].map(reconnectDelay)).toEqual([200, 400, 2_000, 5_000, 5_000]);
  });
});

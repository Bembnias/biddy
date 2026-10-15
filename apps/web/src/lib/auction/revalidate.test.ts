import { describe, expect, it, vi } from 'vitest';

import { handleRevalidate, isAuctionCacheTag, parseRevalidateBody } from './revalidate';

const SECRET = 'revalidate-secret-0123456789-0123456789';
const AUTH = `Bearer ${SECRET}`;

describe('handleRevalidate', () => {
  it('rewaliduje tagi aukcji (bez duplikatów) z poprawnym sekretem', () => {
    const revalidate = vi.fn();
    const result = handleRevalidate(
      { authorization: AUTH, body: { tags: ['auction:k3x9qa7m', 'auction:k3x9qa7m'] } },
      SECRET,
      revalidate,
    );
    expect(result).toEqual({ status: 200, body: { revalidated: 1 } });
    expect(revalidate).toHaveBeenCalledExactlyOnceWith('auction:k3x9qa7m');
  });

  it('503 bez sekretu, 401 ze złym sekretem, 400 z błędnymi tagami', () => {
    const revalidate = vi.fn();
    const body = { tags: ['auction:k3x9qa7m'] };
    expect(handleRevalidate({ authorization: AUTH, body }, undefined, revalidate).status).toBe(503);
    for (const authorization of [null, 'Bearer zły', SECRET, `Basic ${SECRET}`]) {
      expect(handleRevalidate({ authorization, body }, SECRET, revalidate).status).toBe(401);
    }
    for (const invalid of [
      null,
      {},
      { tags: [] },
      { tags: ['profile:1'] },
      { tags: 'auction:k3x9qa7m' },
      { tags: Array.from({ length: 21 }, () => 'auction:k3x9qa7m') },
    ]) {
      expect(
        handleRevalidate({ authorization: AUTH, body: invalid }, SECRET, revalidate).status,
      ).toBe(400);
    }
    expect(revalidate).not.toHaveBeenCalled();
  });
});

describe('tagi', () => {
  it('tylko auction:{publicId}', () => {
    expect(isAuctionCacheTag('auction:k3x9qa7m')).toBe(true);
    expect(isAuctionCacheTag('auction:K3X9QA7M')).toBe(false);
    expect(isAuctionCacheTag('auction:k3x9qa7m/x')).toBe(false);
    expect(isAuctionCacheTag(1)).toBe(false);
    expect(parseRevalidateBody({ tags: ['auction:k3x9qa7m', 'auction:abcdefgh'] })).toEqual([
      'auction:k3x9qa7m',
      'auction:abcdefgh',
    ]);
  });
});

import { configureApiClient, resetApiClient } from '@biddy/api-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clockOffset, measureClockOffset } from './server-clock';

afterEach(() => {
  resetApiClient();
});

describe('clockOffset (PROJECT.md §15.4)', () => {
  it('czas serwera minus środek żądania: zegar urządzenia spóźnia się o 2 s → +2000', () => {
    const serverTime = '2026-12-24T19:00:02.000Z';
    const sentAt = Date.parse('2026-12-24T18:59:59.900Z');
    const receivedAt = Date.parse('2026-12-24T19:00:00.100Z');
    expect(clockOffset(serverTime, sentAt, receivedAt)).toBe(2_000);
  });

  it('zegar urządzenia spieszy się: przesunięcie ujemne', () => {
    expect(
      clockOffset(
        '2026-12-24T19:00:00.000Z',
        Date.parse('2026-12-24T19:00:05.000Z'),
        Date.parse('2026-12-24T19:00:05.000Z'),
      ),
    ).toBe(-5_000);
  });
});

describe('measureClockOffset', () => {
  it('mierzy przez wygenerowany klient GET /v1/time pod adresem API', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ serverTime: '2026-12-24T19:00:01.000Z' })),
    );
    configureApiClient({ baseUrl: 'https://api.biddy.test', fetch: fetchMock });
    const times = [Date.parse('2026-12-24T19:00:00.000Z'), Date.parse('2026-12-24T19:00:00.200Z')];

    const offset = await measureClockOffset(undefined, () => times.shift() ?? 0);

    expect(offset).toBe(900);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.biddy.test/v1/time');
  });
});

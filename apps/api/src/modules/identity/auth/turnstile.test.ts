import { describe, expect, it, vi } from 'vitest';

import { TURNSTILE_TEST_SECRET_KEY } from '../../../infra/config/index.js';
import { CloudflareTurnstile } from './turnstile.js';

describe('CloudflareTurnstile', () => {
  it('klucze testowe Cloudflare bez sieci: 1x… przechodzi, 2x… odrzuca', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    expect(
      await new CloudflareTurnstile(TURNSTILE_TEST_SECRET_KEY, fetchMock).verify(
        'token',
        undefined,
      ),
    ).toBe(true);
    expect(
      await new CloudflareTurnstile('2x0000000000000000000000000000000AA', fetchMock).verify(
        'token',
        undefined,
      ),
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pusty token zawsze odrzuca', async () => {
    const verifier = new CloudflareTurnstile(TURNSTILE_TEST_SECRET_KEY);
    for (const token of [undefined, null, '', '  ']) {
      expect(await verifier.verify(token, undefined)).toBe(false);
    }
  });

  it('prawdziwy klucz: siteverify z sekretem, tokenem i IP klienta', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ success: true })));
    const verifier = new CloudflareTurnstile('0x-prawdziwy-sekret', fetchMock);

    expect(await verifier.verify('token-z-widzetu', '203.0.113.7')).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({
      secret: '0x-prawdziwy-sekret',
      response: 'token-z-widzetu',
      remoteip: '203.0.113.7',
    });
  });

  it('odpowiedź success: false odrzuca token', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] })),
    );
    expect(await new CloudflareTurnstile('0x-sekret', fetchMock).verify('t', undefined)).toBe(
      false,
    );
  });
});

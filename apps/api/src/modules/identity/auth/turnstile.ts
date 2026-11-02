// Cloudflare Turnstile (PROJECT.md §16.1): token z widżetu w przeglądarce sprawdzamy po stronie
// serwera. Klucze testowe Cloudflare rozstrzygamy lokalnie, bez sieci (lokalnie i w testach).
import { TURNSTILE_TEST_SECRET_KEY } from '../../../infra/config/index.js';

/** Nagłówek, w którym klient wysyła token Turnstile. */
export const TURNSTILE_TOKEN_HEADER = 'x-turnstile-token';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Klucze testowe Cloudflare i ich wynik (https://developers.cloudflare.com/turnstile/troubleshooting/testing/):
 * zawsze przechodzi, zawsze odrzuca, token już użyty.
 */
const TEST_SECRET_RESULTS: Readonly<Record<string, boolean>> = {
  [TURNSTILE_TEST_SECRET_KEY]: true,
  '2x0000000000000000000000000000000AA': false,
  '3x0000000000000000000000000000000AA': false,
};

export interface TurnstileVerifier {
  /** Czy token jest ważny (pusty token = nie). */
  verify(token: string | null | undefined, remoteIp: string | undefined): Promise<boolean>;
}

export class CloudflareTurnstile implements TurnstileVerifier {
  constructor(
    private readonly secretKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async verify(token: string | null | undefined, remoteIp: string | undefined): Promise<boolean> {
    if (token === null || token === undefined || token.trim() === '') {
      return false;
    }
    const testResult = TEST_SECRET_RESULTS[this.secretKey];
    if (testResult !== undefined) {
      return testResult;
    }
    const body = new URLSearchParams({ secret: this.secretKey, response: token });
    if (remoteIp !== undefined) {
      body.set('remoteip', remoteIp);
    }
    const response = await this.fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error(`Turnstile siteverify: HTTP ${response.status}`);
    }
    const result = (await response.json()) as { success?: unknown };
    return result.success === true;
  }
}

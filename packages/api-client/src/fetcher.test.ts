import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  NETWORK_ERROR_STATUS,
  apiFetch,
  configureApiClient,
  isApiError,
  resetApiClient,
} from './fetcher.js';
import { urlOf } from './test/fetch.js';

const PROBLEM = {
  type: 'https://biddy.pl/problems/conflict',
  title: 'Konflikt',
  status: 409,
  detail: 'Aukcja została już zakończona.',
  instance: '/v1/auctions/a1/bids',
  code: 'AUCTION_ENDED',
  requestId: 'req-409',
  currentPrice: 1500,
};

function respond(body: unknown, init: ResponseInit & { contentType?: string } = {}) {
  const { contentType = 'application/json; charset=utf-8', ...rest } = init;
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        ...rest,
        headers: { 'content-type': contentType, ...rest.headers },
      }),
    ),
  );
}

function lastRequest(fetchMock: ReturnType<typeof respond>): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1);
  return { url: urlOf(call?.[0]), init: call?.[1] ?? {} };
}

afterEach(() => {
  resetApiClient();
});

describe('apiFetch: żądanie', () => {
  it('adres = baseUrl + ścieżka z kontraktu; domyślnie ciasteczka sesji i Accept JSON', async () => {
    const fetchMock = respond({ ok: true });
    configureApiClient({ baseUrl: 'https://api.biddy.pl', fetch: fetchMock });

    await apiFetch('/v1/time', { method: 'GET' });

    const { url, init } = lastRequest(fetchMock);
    expect(url).toBe('https://api.biddy.pl/v1/time');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('accept')).toBe('application/json');
    expect(new Headers(init.headers).has('authorization')).toBe(false);
  });

  it('mobile: token z getAccessToken jako Authorization: Bearer', async () => {
    const fetchMock = respond({});
    configureApiClient({ fetch: fetchMock, getAccessToken: () => Promise.resolve('tok-123') });

    await apiFetch('/v1/me');

    expect(new Headers(lastRequest(fetchMock).init.headers).get('authorization')).toBe(
      'Bearer tok-123',
    );
  });

  it('nagłówki z konfiguracji (np. cookie w Server Components) i z wywołania; wywołanie wygrywa', async () => {
    const fetchMock = respond({});
    configureApiClient({
      fetch: fetchMock,
      headers: () => ({ cookie: 'session=abc', 'x-request-id': 'z-konfiguracji' }),
      getAccessToken: () => 'nieuzywany',
    });

    await apiFetch('/v1/me', {
      headers: { 'x-request-id': 'z-wywolania', authorization: 'Bearer wlasny' },
    });

    const headers = new Headers(lastRequest(fetchMock).init.headers);
    expect(headers.get('cookie')).toBe('session=abc');
    expect(headers.get('x-request-id')).toBe('z-wywolania');
    expect(headers.get('authorization')).toBe('Bearer wlasny');
  });
});

describe('apiFetch: odpowiedź', () => {
  it('2xx JSON: zwraca treść', async () => {
    configureApiClient({ fetch: respond({ serverTime: '2026-12-24T19:00:00.000Z' }) });
    await expect(apiFetch('/v1/time')).resolves.toEqual({
      serverTime: '2026-12-24T19:00:00.000Z',
    });
  });

  it('PDF (etykieta przesyłki): Blob z bajtami bez zmian', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0x00]);
    configureApiClient({
      baseUrl: 'https://api.biddy.pl',
      fetch: vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response(bytes, { headers: { 'content-type': 'application/pdf' } })),
      ),
    });
    const blob = await apiFetch<Blob>('/v1/orders/k3x9qa7m/label');
    expect(blob).toBeInstanceOf(Blob);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  });

  it('204: undefined', async () => {
    configureApiClient({ fetch: respond('', { status: 204 }) });
    await expect(apiFetch('/v1/me/watchlist/a1', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('błąd z Problem Details: ApiError z kodem, treścią i requestId', async () => {
    configureApiClient({
      fetch: respond(PROBLEM, { status: 409, contentType: 'application/problem+json' }),
    });

    const error = await apiFetch('/v1/auctions/a1/bids', { method: 'POST' }).catch(
      (caught: unknown) => caught,
    );

    expect(isApiError(error)).toBe(true);
    expect(error).toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'AUCTION_ENDED',
      message: 'Aukcja została już zakończona.',
      requestId: 'req-409',
      problem: PROBLEM,
    });
  });

  it('błąd bez Problem Details (np. strona proxy): ApiError bez problem, requestId z nagłówka', async () => {
    configureApiClient({
      fetch: respond('<html>Bad Gateway</html>', {
        status: 502,
        contentType: 'text/html',
        headers: { 'x-request-id': 'req-502' },
      }),
    });

    const error = (await apiFetch('/v1/time').catch((caught: unknown) => caught)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.problem).toBeUndefined();
    expect(error.code).toBeUndefined();
    expect(error.requestId).toBe('req-502');
    expect(error.message).toContain('502');
  });

  it('brak połączenia: ApiError ze statusem 0 i przyczyną', async () => {
    const cause = new TypeError('fetch failed');
    configureApiClient({ fetch: vi.fn<typeof fetch>(() => Promise.reject(cause)) });

    const error = (await apiFetch('/v1/time').catch((caught: unknown) => caught)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(NETWORK_ERROR_STATUS);
    expect(error.cause).toBe(cause);
  });

  it('przerwanie przez wywołującego (AbortSignal): oryginalny błąd, nie ApiError', async () => {
    const controller = new AbortController();
    const abort = new DOMException('Przerwano', 'AbortError');
    configureApiClient({ fetch: vi.fn<typeof fetch>(() => Promise.reject(abort)) });
    controller.abort();

    await expect(apiFetch('/v1/time', { signal: controller.signal })).rejects.toBe(abort);
  });
});

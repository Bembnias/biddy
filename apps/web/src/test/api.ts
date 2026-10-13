import { configureApiClient } from '@biddy/api-client';
import { vi } from 'vitest';

/**
 * Atrapa API dla klienta (F-05): odpowiedzi według ścieżki, reszta 404 Problem Details. Wartość
 * to ciało JSON albo funkcja zwracająca `Response` (nowy obiekt przy każdym wywołaniu, bo treść
 * odpowiedzi da się odczytać tylko raz).
 */
export function mockApi(responses: Readonly<Record<string, unknown>>) {
  const fetchMock = vi.fn<typeof fetch>((input) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const entry = responses[url.pathname];
    const body: unknown = typeof entry === 'function' ? (entry as () => unknown)() : entry;
    if (body instanceof Response) {
      return Promise.resolve(body);
    }
    if (body !== undefined) {
      return Promise.resolve(Response.json(body));
    }
    return Promise.resolve(
      Response.json(
        {
          type: 'https://biddy.pl/problems/not-found',
          title: 'Nie znaleziono',
          status: 404,
          detail: 'Nie znaleziono.',
          instance: url.pathname,
          code: 'NOT_FOUND',
          requestId: 'test',
        },
        { status: 404, headers: { 'content-type': 'application/problem+json' } },
      ),
    );
  });
  configureApiClient({ baseUrl: 'http://api.test', fetch: fetchMock });
  return fetchMock;
}

/** Żądania do `path` zarejestrowane przez atrapę {@link mockApi}: ciało JSON i nagłówki. */
export function apiCalls(fetchMock: ReturnType<typeof mockApi>, path: string) {
  return fetchMock.mock.calls
    .filter(([input]) => {
      const href =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return new URL(href).pathname === path;
    })
    .map(([, init]) => ({
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      headers: new Headers(init?.headers),
    }));
}

// Kryterium F-05 „web wywołuje przykładowy endpoint przez wygenerowany hook z pełnym
// typowaniem” w miniaturze aplikacji web: komponent React z QueryClientProvider używa
// wygenerowanego hooka useGetServerTime (apps/web powstanie w F-06 i zrobi to samo).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  type ApiError,
  type ProblemDetails,
  type ServerTimeDto,
  configureApiClient,
  getServerTime,
  resetApiClient,
  useGetServerTime,
} from './index.js';
import { urlOf } from './test/fetch.js';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function ServerClock() {
  const { data, error, isPending } = useGetServerTime();
  if (isPending) {
    return <p>Ładowanie…</p>;
  }
  if (error) {
    return <p role="alert">Błąd {error.code ?? error.status}</p>;
  }
  return <time dateTime={data.serverTime}>Czas serwera: {data.serverTime}</time>;
}

function mockFetch(response: Response) {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response));
  configureApiClient({ baseUrl: 'http://localhost:3001', fetch: fetchMock });
  return fetchMock;
}

afterEach(() => {
  resetApiClient();
});

describe('wygenerowany hook useGetServerTime', () => {
  it('komponent pobiera czas serwera z GET /v1/time i go wyświetla', async () => {
    const fetchMock = mockFetch(Response.json({ serverTime: '2026-12-24T19:00:00.123Z' }));

    render(<ServerClock />, { wrapper });

    expect(await screen.findByText('Czas serwera: 2026-12-24T19:00:00.123Z')).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlOf(fetchMock.mock.calls[0]?.[0])).toBe('http://localhost:3001/v1/time');
    // TanStack Query przekazuje AbortSignal (anulowanie przy odmontowaniu komponentu).
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('błąd API trafia do komponentu jako ApiError z kodem domenowym', async () => {
    mockFetch(
      Response.json(
        {
          type: 'https://biddy.pl/problems/service-unavailable',
          title: 'Usługa niedostępna',
          status: 503,
          detail: 'Spróbuj ponownie za chwilę.',
          instance: '/v1/time',
          code: 'SERVICE_UNAVAILABLE',
          requestId: 'req-1',
        },
        { status: 503, headers: { 'content-type': 'application/problem+json' } },
      ),
    );

    render(<ServerClock />, { wrapper });

    expect((await screen.findByRole('alert')).textContent).toBe('Błąd SERVICE_UNAVAILABLE');
  });

  it('typy: dane to ServerTimeDto, błąd to ApiError<ProblemDetails>', async () => {
    mockFetch(Response.json({ serverTime: '2026-12-24T19:00:00.123Z' }));

    const { result } = renderHook(() => useGetServerTime(), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expectTypeOf(result.current.data).toEqualTypeOf<ServerTimeDto | undefined>();
    expectTypeOf(result.current.error).toEqualTypeOf<ApiError<ProblemDetails> | null>();
    expectTypeOf(getServerTime).returns.resolves.toEqualTypeOf<ServerTimeDto>();
    expectTypeOf<ServerTimeDto>().toEqualTypeOf<{ serverTime: string }>();
    expect(result.current.data?.serverTime).toBe('2026-12-24T19:00:00.123Z');
  });
});

// Wygenerowany klient na prawdziwym API (apps/api jako proces, jak `pnpm dev`) ze strony pod
// originem aplikacji web: ścieżki i kształt odpowiedzi z kontraktu zgadzają się z serwerem,
// błędy przychodzą jako ApiError z Problem Details, a CORS z ciasteczkami przepuszcza web.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  ApiError,
  apiFetch,
  configureApiClient,
  getServerTime,
  resetApiClient,
  useGetServerTime,
} from '../src/index.js';
import { type ApiProcess, WEB_ORIGIN, startApi } from './support/api-process.js';

let api: ApiProcess;

beforeAll(async () => {
  api = await startApi();
});

afterAll(async () => {
  await api.stop();
});

afterEach(() => {
  resetApiClient();
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function ServerClock() {
  const { data, error } = useGetServerTime();
  if (error) {
    return <p role="alert">{error.message}</p>;
  }
  return data === undefined ? <p>Ładowanie…</p> : <p>Czas serwera: {data.serverTime}</p>;
}

describe('klient na prawdziwym API (strona pod originem web)', () => {
  it('strona jest pod originem aplikacji web', () => {
    expect(window.location.origin).toBe(WEB_ORIGIN);
  });

  it('getServerTime: czas serwera bliski czasowi lokalnemu', async () => {
    configureApiClient({ baseUrl: api.baseUrl });
    const before = Date.now();

    const { serverTime } = await getServerTime();

    const time = Date.parse(serverTime);
    expect(serverTime).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(time).toBeGreaterThanOrEqual(before - 1_000);
    expect(time).toBeLessThanOrEqual(Date.now() + 1_000);
  });

  it('komponent z hookiem useGetServerTime wyświetla czas z API', async () => {
    configureApiClient({ baseUrl: api.baseUrl });

    render(<ServerClock />, { wrapper });

    expect((await screen.findByText(/^Czas serwera: \d{4}-/)).textContent).toMatch(/Z$/);
  });

  it('nieznana trasa: ApiError 404 z Problem Details i requestId', async () => {
    configureApiClient({ baseUrl: api.baseUrl });

    const error = (await apiFetch('/v1/nie-ma-takiej-trasy').catch(
      (caught: unknown) => caught,
    )) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.problem).toMatchObject({ instance: '/v1/nie-ma-takiej-trasy' });
    expect(error.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

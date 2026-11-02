// Strona spoza CORS_ORIGINS: przeglądarka (happy-dom) nie oddaje odpowiedzi API skryptowi
// strony, więc klient zgłasza brak połączenia (status 0), a nie dane.
import type { Window } from 'happy-dom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ApiError,
  NETWORK_ERROR_STATUS,
  configureApiClient,
  getServerTime,
  resetApiClient,
} from '../src/index.js';
import { type ApiProcess, WEB_ORIGIN, startApi } from './support/api-process.js';

const FOREIGN_ORIGIN = 'http://obca-strona.example';
const happyDOM = (window as unknown as Window).happyDOM;

let api: ApiProcess;

beforeAll(async () => {
  api = await startApi();
  happyDOM.setURL(`${FOREIGN_ORIGIN}/`);
});

afterAll(async () => {
  happyDOM.setURL(`${WEB_ORIGIN}/`);
  resetApiClient();
  await api.stop();
});

describe('CORS', () => {
  it('obcy origin nie odczyta odpowiedzi API (ApiError ze statusem 0)', async () => {
    expect(window.location.origin).toBe(FOREIGN_ORIGIN);
    configureApiClient({ baseUrl: api.baseUrl });

    const error = (await getServerTime().catch((caught: unknown) => caught)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(NETWORK_ERROR_STATUS);
  });
});

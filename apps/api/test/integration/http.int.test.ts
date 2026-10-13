// Aplikacja na prawdziwym Postgresie (Testcontainers): sondy, Problem Details (RFC 9457) z kodami
// domenowymi, walidacja DTO z nestjs-zod, x-request-id i dokument OpenAPI.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  integrationConfig,
  problemOf,
  startTestApp,
  type TestApp,
  UUID_V7,
} from './support/app.js';
import {
  type CreatedListing,
  LISTING_DTO_SCHEMA,
  ListingsTestModule,
} from './support/listings-test.module.js';

const LISTINGS_URL = '/v1/integration-test/listings';

let api: TestApp;

beforeAll(async () => {
  api = await startTestApp(integrationConfig(), [ListingsTestModule]);
});

afterAll(async () => {
  await api.close();
});

describe('sondy', () => {
  it('GET /health → 200 z wersją wydania', async () => {
    const response = await api.http.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', release: 'integration-test' });
  });

  it('GET /ready → 200, gdy baza odpowiada', async () => {
    const response = await api.http.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({ status: 'ok', checks: { database: 'ok' } });
  });
});

describe('Problem Details', () => {
  it('nieznana trasa → 404 application/problem+json z kodem NOT_FOUND', async () => {
    const response = await api.http.inject({ method: 'GET', url: '/v1/nie-ma-takiej-trasy?x=1' });

    expect(response.statusCode).toBe(404);
    expect(problemOf(response)).toMatchObject({
      type: 'https://biddy.pl/problems/not-found',
      status: 404,
      code: 'NOT_FOUND',
      instance: '/v1/nie-ma-takiej-trasy',
      requestId: response.headers['x-request-id'],
    });
  });

  it('niepoprawna treść → 400 VALIDATION_FAILED z listą errors[]', async () => {
    const response = await api.http.inject({
      method: 'POST',
      url: LISTINGS_URL,
      payload: {
        title: 'ab',
        startingPrice: { amount: -100, currency: 'EUR' },
        categoryPath: 'Moda/Obuwie',
      },
    });

    expect(response.statusCode).toBe(400);
    const problem = problemOf(response);
    expect(problem).toMatchObject({
      type: 'https://biddy.pl/problems/validation-failed',
      status: 400,
      code: 'VALIDATION_FAILED',
      instance: LISTINGS_URL,
    });
    expect(problem.errors?.map(({ path, code }) => ({ path, code }))).toEqual([
      { path: 'title', code: 'too_small' },
      { path: 'startingPrice.amount', code: 'too_small' },
      { path: 'startingPrice.currency', code: 'invalid_value' },
      { path: 'categoryPath', code: 'invalid_format' },
    ]);
    for (const error of problem.errors ?? []) {
      expect(error.message).not.toBe('');
    }
  });

  it('brak wymaganych pól → VALIDATION_FAILED z błędem każdego pola', async () => {
    const response = await api.http.inject({ method: 'POST', url: LISTINGS_URL, payload: {} });

    expect(response.statusCode).toBe(400);
    const problem = problemOf(response);
    expect(problem.code).toBe('VALIDATION_FAILED');
    expect(problem.errors?.map(({ path }) => path)).toEqual([
      'title',
      'startingPrice',
      'categoryPath',
    ]);
  });

  it('zły JSON → 400 application/problem+json z kodem BAD_REQUEST', async () => {
    const response = await api.http.inject({
      method: 'POST',
      url: LISTINGS_URL,
      headers: { 'content-type': 'application/json' },
      payload: '{"title": "Rower",',
    });

    expect(response.statusCode).toBe(400);
    expect(problemOf(response)).toMatchObject({
      status: 400,
      code: 'BAD_REQUEST',
      instance: LISTINGS_URL,
    });
  });

  it('poprawna treść przechodzi do kontrolera, który odpytuje bazę przez Drizzle', async () => {
    const response = await api.http.inject({
      method: 'POST',
      url: LISTINGS_URL,
      payload: {
        title: 'Nike Air Max 90',
        startingPrice: { amount: 15_000, currency: 'PLN' },
        categoryPath: 'moda.obuwie.sneakersy',
      },
    });

    expect(response.statusCode).toBe(201);
    const listing = response.json<CreatedListing>();
    expect(listing).toEqual({
      id: expect.stringMatching(UUID_V7) as string,
      title: 'Nike Air Max 90',
      categoryDepth: 3,
    });
  });
});

describe('x-request-id', () => {
  it('poprawny identyfikator od klienta wraca w nagłówku, w Problem Details i w logach', async () => {
    const response = await api.http.inject({
      method: 'GET',
      url: '/v1/nie-ma',
      headers: { 'x-request-id': 'integration-req-1' },
    });

    expect(response.headers['x-request-id']).toBe('integration-req-1');
    expect(problemOf(response).requestId).toBe('integration-req-1');
    expect(api.logLines()).toContainEqual(
      expect.objectContaining({ reqId: 'integration-req-1', msg: 'Żądanie obsłużone' }),
    );
  });

  it('bez nagłówka API generuje UUIDv7, inny dla każdego żądania', async () => {
    const first = await api.http.inject({ method: 'GET', url: '/health' });
    const second = await api.http.inject({ method: 'GET', url: '/health' });

    expect(first.headers['x-request-id']).toMatch(UUID_V7);
    expect(second.headers['x-request-id']).toMatch(UUID_V7);
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });

  it('niebezpieczny identyfikator od klienta jest zastępowany UUIDv7', async () => {
    const response = await api.http.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'zły id\nwstrzyknięta linia' },
    });

    expect(response.headers['x-request-id']).toMatch(UUID_V7);
  });
});

describe('OpenAPI', () => {
  interface OpenApiDocument {
    openapi: string;
    info: { title: string; version: string };
    paths: Record<string, Record<string, unknown>>;
    components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
  }

  it('/docs/json to dokument OpenAPI 3.x ze schematem DTO testowego kontrolera', async () => {
    const response = await api.http.inject({ method: 'GET', url: '/docs/json' });

    expect(response.statusCode).toBe(200);
    const document = response.json<OpenApiDocument>();
    expect(document.openapi).toMatch(/^3\.\d+\.\d+$/);
    expect(document.info).toMatchObject({ title: 'Biddy API', version: 'integration-test' });
    expect(document.paths).toHaveProperty([LISTINGS_URL, 'post']);
    expect(JSON.stringify(document.paths[LISTINGS_URL])).toContain(
      `#/components/schemas/${LISTING_DTO_SCHEMA}`,
    );
    expect(Object.keys(document.components.schemas[LISTING_DTO_SCHEMA]?.properties ?? {})).toEqual([
      'title',
      'startingPrice',
      'categoryPath',
    ]);
    expect(document.components.schemas).toHaveProperty('ProblemDetails');
  });

  it('/docs serwuje Swagger UI', async () => {
    const response = await api.http.inject({ method: 'GET', url: '/docs' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
  });
});

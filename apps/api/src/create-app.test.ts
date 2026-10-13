// Test aplikacji w procesie: createApp + fastify.inject(), bez Dockera. Baza jest celowo
// nieosiągalna (port 1), więc /ready zwraca 503; wariant „zdrowy” podmienia DatabaseHealth.check.
import { Writable } from 'node:stream';

import { isProblemDetails, type ProblemDetails } from '@biddy/shared';
import {
  Body,
  Controller,
  Get,
  Injectable,
  Logger,
  type MiddlewareConsumer,
  Module,
  type NestMiddleware,
  type NestModule,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type * as SentryNest from '@sentry/nestjs';
import type { FastifyInstance, FastifyRequest, InjectOptions } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createApp } from './create-app.js';
import { type AppConfig, loadConfig } from './infra/config/index.js';
import { DatabaseHealth } from './infra/db/index.js';
import { DomainError } from './infra/http/index.js';

const sentry = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock('@sentry/nestjs', async (importOriginal) => ({
  ...(await importOriginal<typeof SentryNest>()),
  captureException: sentry.captureException,
}));

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROBLEM_JSON = 'application/problem+json; charset=utf-8';

class CreateItemDto extends createZodDto(
  z.object({
    title: z.string().min(3),
    price: z.object({ amount: z.number().int().positive() }),
  }),
) {}

class SearchQueryDto extends createZodDto(z.object({ page: z.coerce.number().int().min(1) })) {}

@Controller('test')
class TestController {
  private readonly logger = new Logger(TestController.name);

  @Post('items')
  create(@Body() body: CreateItemDto): CreateItemDto {
    this.logger.log('Tworzenie przedmiotu');
    return body;
  }

  @Get('search')
  search(@Query() query: SearchQueryDto): SearchQueryDto {
    return query;
  }

  @Get('conflict')
  conflict(): never {
    throw new DomainError({
      code: 'CONFLICT',
      detail: 'Aukcja została już zakończona.',
      extensions: { currentPrice: 1500 },
    });
  }

  @Get('boom')
  boom(): never {
    throw new Error('sekretny szczegół: postgres://user:haslo@db');
  }

  @Get('guarded')
  guarded(): { ok: true } {
    return { ok: true };
  }

  @Get('middleware-crash')
  middlewareCrash(): { ok: true } {
    return { ok: true };
  }

  @Get('ip')
  ip(@Req() request: FastifyRequest): { ip: string } {
    return { ip: request.ip };
  }
}

/** Middleware NestJS (pod Fastify działa przez @fastify/middie) odrzucający żądanie. */
@Injectable()
class RejectingMiddleware implements NestMiddleware {
  use(): void {
    throw new UnauthorizedException();
  }
}

@Injectable()
class CrashingMiddleware implements NestMiddleware {
  use(): void {
    throw new Error('awaria middleware: postgres://user:haslo@db');
  }
}

@Module({ controllers: [TestController] })
class TestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RejectingMiddleware).forRoutes('test/guarded');
    consumer.apply(CrashingMiddleware).forRoutes('test/middleware-crash');
  }
}

function testConfig(env: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://biddy:biddy@127.0.0.1:1/biddy',
    CORS_ORIGINS: 'http://localhost:3000,https://biddy.pl',
    LOG_LEVEL: 'debug',
    APP_RELEASE: 'test-release',
    // Jak domyślnie na produkcji: proxy (load balancer) w sieci prywatnej.
    TRUST_PROXY: 'uniquelocal',
    ...env,
  });
}

const logChunks: string[] = [];
const logDestination = new Writable({
  write(chunk: Buffer, _encoding, callback) {
    logChunks.push(chunk.toString());
    callback();
  },
});

function logLines(): Record<string, unknown>[] {
  return logChunks
    .join('')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

let app: NestFastifyApplication;
let fastify: FastifyInstance;

async function request(options: InjectOptions) {
  return fastify.inject(options);
}

function problemOf(response: { headers: Record<string, unknown>; json: () => unknown }) {
  expect(response.headers['content-type']).toBe(PROBLEM_JSON);
  const body = response.json();
  expect(isProblemDetails(body)).toBe(true);
  return body as ProblemDetails;
}

beforeAll(async () => {
  app = await createApp(testConfig(), { extraModules: [TestModule], logDestination });
  fastify = app.getHttpAdapter().getInstance();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  sentry.captureException.mockClear();
});

describe('sondy', () => {
  it('GET /health → 200 z wersją, bez prefiksu /v1 i bez cache', async () => {
    const response = await request({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({ status: 'ok', release: 'test-release' });
  });

  it('sondy nie są dostępne pod /v1', async () => {
    expect((await request({ method: 'GET', url: '/v1/health' })).statusCode).toBe(404);
    expect((await request({ method: 'GET', url: '/v1/ready' })).statusCode).toBe(404);
  });

  it('GET /ready przy niedostępnej bazie → 503 Problem Details SERVICE_UNAVAILABLE', async () => {
    const response = await request({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    const problem = problemOf(response);
    expect(problem).toMatchObject({
      type: 'https://biddy.pl/problems/service-unavailable',
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      instance: '/ready',
      checks: { database: 'error' },
    });
    // Świadoma niedostępność nie jest zgłaszana do Sentry.
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('GET /ready przy działającej bazie → 200', async () => {
    vi.spyOn(app.get(DatabaseHealth), 'check').mockResolvedValueOnce(undefined);

    const response = await request({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', checks: { database: 'ok' } });
  });
});

describe('Problem Details dla błędów spoza kontrolerów (Fastify)', () => {
  it.each(['/v1/nie-ma-takiej-trasy', '/nie-ma-takiej-trasy'])(
    'nieznana trasa %s → 404 NOT_FOUND',
    async (url) => {
      const response = await request({ method: 'GET', url: `${url}?token=abc` });

      expect(response.statusCode).toBe(404);
      expect(problemOf(response)).toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
        title: 'Nie znaleziono',
        instance: url,
      });
    },
  );

  it('zły JSON → 400 BAD_REQUEST', async () => {
    const response = await request({
      method: 'POST',
      url: '/v1/test/items',
      headers: { 'content-type': 'application/json' },
      payload: '{"title": "abc",',
    });

    expect(response.statusCode).toBe(400);
    expect(problemOf(response)).toMatchObject({
      code: 'BAD_REQUEST',
      detail: 'Treść żądania nie jest poprawnym JSON-em.',
      instance: '/v1/test/items',
    });
  });

  it('pusta treść przy Content-Type JSON → 400 BAD_REQUEST', async () => {
    const response = await request({
      method: 'POST',
      url: '/v1/test/items',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });

    expect(response.statusCode).toBe(400);
    expect(problemOf(response).code).toBe('BAD_REQUEST');
  });

  it.each(['text/plain', 'application/xml'])(
    'nieobsługiwany Content-Type %s → 415 UNSUPPORTED_MEDIA_TYPE',
    async (contentType) => {
      const response = await request({
        method: 'POST',
        url: '/v1/test/items',
        headers: { 'content-type': contentType },
        payload: 'title=abc',
      });

      expect(response.statusCode).toBe(415);
      expect(problemOf(response).code).toBe('UNSUPPORTED_MEDIA_TYPE');
    },
  );

  it('za duża treść (> 1 MiB) → 413 PAYLOAD_TOO_LARGE', async () => {
    const response = await request({
      method: 'POST',
      url: '/v1/test/items',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ title: 'x'.repeat(1024 * 1024), price: { amount: 1 } }),
    });

    expect(response.statusCode).toBe(413);
    expect(problemOf(response).code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('Problem Details dla błędów sprzed routingu (zły adres URL)', () => {
  it.each(['/v1/%zz', '/v1/items/%E0%A4%A?x=1', '/health%E0%A4%A'])(
    'GET %s → 400 BAD_REQUEST z x-request-id, nagłówkami bezpieczeństwa i logiem',
    async (url) => {
      const requestId = `bad-url-${logLines().length}`;
      const response = await request({
        method: 'GET',
        url,
        headers: { 'x-request-id': requestId },
      });

      expect(response.statusCode).toBe(400);
      expect(response.headers['x-request-id']).toBe(requestId);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-security-policy']).toBe(
        "default-src 'none';base-uri 'none';form-action 'none';frame-ancestors 'none'",
      );
      const problem = problemOf(response);
      expect(problem).toMatchObject({
        code: 'BAD_REQUEST',
        status: 400,
        requestId,
        detail: expect.stringContaining('nieprawidłowe kodowanie znaków') as string,
      });
      // Bez wewnętrznego kodu Fastify (FST_ERR_BAD_URL) w odpowiedzi.
      expect(response.body).not.toContain('FST_');
      expect(logLines()).toContainEqual(
        expect.objectContaining({
          reqId: requestId,
          msg: 'Żądanie obsłużone',
          res: { statusCode: 400 },
        }),
      );
    },
  );
});

describe('middleware NestJS', () => {
  it('HttpException z middleware → Problem Details (a nie zawieszone żądanie)', async () => {
    const response = await request({
      method: 'GET',
      url: '/v1/test/guarded?token=abc',
      headers: { 'x-request-id': 'mw-401', origin: 'https://biddy.pl' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers['x-request-id']).toBe('mw-401');
    // CORS i helmet działają przed middleware, więc przeglądarka może odczytać ten błąd.
    expect(response.headers['access-control-allow-origin']).toBe('https://biddy.pl');
    expect(response.headers['access-control-expose-headers']).toBe('x-request-id');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(problemOf(response)).toMatchObject({
      code: 'UNAUTHORIZED',
      requestId: 'mw-401',
      instance: '/v1/test/guarded',
    });
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('nieznany błąd z middleware → 500 INTERNAL_ERROR, log i Sentry; aplikacja działa dalej', async () => {
    const response = await request({
      method: 'GET',
      url: '/v1/test/middleware-crash',
      headers: { 'x-request-id': 'mw-500' },
    });

    expect(response.statusCode).toBe(500);
    expect(problemOf(response)).toMatchObject({ code: 'INTERNAL_ERROR', requestId: 'mw-500' });
    expect(response.body).not.toContain('haslo');
    expect(sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { request_id: 'mw-500' },
    });
    expect(logLines()).toContainEqual(
      expect.objectContaining({
        reqId: 'mw-500',
        level: 'error',
        msg: expect.any(String) as string,
      }),
    );
    expect((await request({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});

describe('typy treści (tylko JSON)', () => {
  it('formularz (application/x-www-form-urlencoded) → 415, jak inne „proste żądania” CORS', async () => {
    const response = await request({
      method: 'POST',
      url: '/v1/test/items',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'title=Rower&price[amount]=1',
    });

    expect(response.statusCode).toBe(415);
    expect(problemOf(response).code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('multipart/form-data → 415', async () => {
    const response = await request({
      method: 'POST',
      url: '/v1/test/items',
      headers: { 'content-type': 'multipart/form-data; boundary=x' },
      payload: '--x\r\nContent-Disposition: form-data; name="title"\r\n\r\nRower\r\n--x--\r\n',
    });

    expect(response.statusCode).toBe(415);
  });
});

describe('adres klienta za proxy (TRUST_PROXY)', () => {
  it('bierze adres dopisany przez zaufane proxy; wpis podany przez klienta jest ignorowany', async () => {
    const response = await request({
      method: 'GET',
      url: '/v1/test/ip',
      // Load balancer (10.0.0.2) dopisał prawdziwy adres klienta; 6.6.6.6 podał sam klient.
      remoteAddress: '10.0.0.2',
      headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7', 'x-request-id': 'xff-1' },
    });

    expect(response.json()).toEqual({ ip: '203.0.113.7' });
    expect(logLines()).toContainEqual(
      expect.objectContaining({
        reqId: 'xff-1',
        req: expect.objectContaining({ remoteAddress: '203.0.113.7' }) as unknown,
      }),
    );
  });

  it('klient łączący się bezpośrednio (adres publiczny) nie może podać adresu w X-Forwarded-For', async () => {
    const response = await request({
      method: 'GET',
      url: '/v1/test/ip',
      remoteAddress: '198.51.100.9',
      headers: { 'x-forwarded-for': '6.6.6.6' },
    });

    expect(response.json()).toEqual({ ip: '198.51.100.9' });
  });
});

describe('walidacja i błędy z kontrolerów', () => {
  it('błąd walidacji treści → 400 VALIDATION_FAILED z błędami pól po polsku', async () => {
    const response = await request({
      method: 'POST',
      url: '/v1/test/items',
      payload: { title: 'ab', price: { amount: -5 } },
    });

    expect(response.statusCode).toBe(400);
    const problem = problemOf(response);
    expect(problem).toMatchObject({
      type: 'https://biddy.pl/problems/validation-failed',
      title: 'Nieprawidłowe dane',
      status: 400,
      code: 'VALIDATION_FAILED',
      instance: '/v1/test/items',
    });
    expect(problem.errors?.map(({ path, code }) => ({ path, code }))).toEqual([
      { path: 'title', code: 'too_small' },
      { path: 'price.amount', code: 'too_small' },
    ]);
    // Zod z polską lokalizacją (create-app.ts).
    expect(problem.errors?.[0]?.message).toMatch(/Za mała wartość/);
  });

  it('błąd walidacji parametrów zapytania → 400 VALIDATION_FAILED', async () => {
    const response = await request({ method: 'GET', url: '/v1/test/search?page=0' });

    expect(response.statusCode).toBe(400);
    expect(problemOf(response).errors).toEqual([
      expect.objectContaining({ path: 'page', code: 'too_small' }),
    ]);
  });

  it('poprawne dane przechodzą do kontrolera', async () => {
    const response = await request({
      method: 'POST',
      url: '/v1/test/items',
      payload: { title: 'Rower', price: { amount: 1500 }, extra: 'usuwane' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ title: 'Rower', price: { amount: 1500 } });
  });

  it('DomainError → status i kod z błędu, rozszerzenia w odpowiedzi', async () => {
    const response = await request({ method: 'GET', url: '/v1/test/conflict' });

    expect(response.statusCode).toBe(409);
    expect(problemOf(response)).toMatchObject({
      code: 'CONFLICT',
      detail: 'Aukcja została już zakończona.',
      currentPrice: 1500,
    });
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('nieznany błąd → 500 INTERNAL_ERROR bez szczegółów, log z reqId i zgłoszenie do Sentry', async () => {
    const response = await request({
      method: 'GET',
      url: '/v1/test/boom',
      headers: { 'x-request-id': 'boom-1' },
    });

    expect(response.statusCode).toBe(500);
    const problem = problemOf(response);
    expect(problem).toMatchObject({
      code: 'INTERNAL_ERROR',
      requestId: 'boom-1',
      detail: 'Wystąpił nieoczekiwany błąd serwera. Spróbuj ponownie za chwilę.',
    });
    expect(response.body).not.toContain('sekretny');
    expect(response.body).not.toContain('haslo');
    expect(problem).not.toHaveProperty('debug');

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { request_id: 'boom-1' },
    });
    const errorLog = logLines().find(
      (line) =>
        line['reqId'] === 'boom-1' && line['level'] === 'error' && line['err'] !== undefined,
    );
    expect(errorLog?.['err']).toMatchObject({
      message: expect.stringContaining('sekretny') as string,
    });
  });
});

describe('x-request-id', () => {
  it('poprawny identyfikator klienta wraca w nagłówku i w Problem Details', async () => {
    const response = await request({
      method: 'GET',
      url: '/v1/nie-ma',
      headers: { 'x-request-id': 'client-req-1' },
    });

    expect(response.headers['x-request-id']).toBe('client-req-1');
    expect(problemOf(response).requestId).toBe('client-req-1');
  });

  it('niepoprawny identyfikator zastępuje UUIDv7', async () => {
    const response = await request({
      method: 'GET',
      url: '/v1/nie-ma',
      headers: { 'x-request-id': 'zły identyfikator; DROP' },
    });

    const id = response.headers['x-request-id'];
    expect(id).toMatch(UUID_V7);
    expect(problemOf(response).requestId).toBe(id);
  });

  it('bez nagłówka generuje UUIDv7 także dla udanych odpowiedzi', async () => {
    const response = await request({ method: 'GET', url: '/health' });
    expect(response.headers['x-request-id']).toMatch(UUID_V7);
  });

  it('każda linia logu żądania ma jego reqId (log z kontrolera i log zakończenia)', async () => {
    await request({
      method: 'POST',
      url: '/v1/test/items',
      headers: { 'x-request-id': 'log-req-1' },
      payload: { title: 'Rower', price: { amount: 1 } },
    });

    const lines = logLines().filter((line) => line['reqId'] === 'log-req-1');
    expect(lines).toEqual([
      expect.objectContaining({ context: 'TestController', msg: 'Tworzenie przedmiotu' }),
      expect.objectContaining({
        level: 'info',
        msg: 'Żądanie obsłużone',
        req: expect.objectContaining({ method: 'POST', url: '/v1/test/items' }) as unknown,
        res: { statusCode: 201 },
      }),
    ]);
    expect(JSON.stringify(logLines())).not.toMatch(/"(?!reqId)[^"]*":"log-req-1"/);
  });

  it('parametry zapytania (np. tokeny) nie trafiają do logu żądania', async () => {
    await request({
      method: 'GET',
      url: '/v1/test/search?page=1&token=SEKRETNY_TOKEN_Q',
      headers: { 'x-request-id': 'log-query-1' },
    });

    const lines = logLines().filter((line) => line['reqId'] === 'log-query-1');
    expect(lines).toContainEqual(
      expect.objectContaining({
        req: expect.objectContaining({ url: '/v1/test/search' }) as unknown,
      }),
    );
    expect(JSON.stringify(logLines())).not.toContain('SEKRETNY_TOKEN_Q');
  });
});

describe('logi', () => {
  it('logi startowe NestJS idą przez pino (bufferLogs)', () => {
    expect(logLines()).toContainEqual(
      expect.objectContaining({
        context: 'NestApplication',
        msg: 'Nest application successfully started',
      }),
    );
  });

  it('sondy /health i /ready nie są logowane automatycznie', async () => {
    await request({ method: 'GET', url: '/health', headers: { 'x-request-id': 'probe-1' } });
    vi.spyOn(app.get(DatabaseHealth), 'check').mockResolvedValueOnce(undefined);
    await request({ method: 'GET', url: '/ready', headers: { 'x-request-id': 'probe-2' } });

    const probeLines = logLines().filter(
      (line) => line['reqId'] === 'probe-1' || line['reqId'] === 'probe-2',
    );
    expect(probeLines).toEqual([]);
  });

  it('nieudana sonda /ready loguje przyczynę (z reqId), ale bez linii zakończenia', async () => {
    await request({ method: 'GET', url: '/ready', headers: { 'x-request-id': 'probe-3' } });

    const lines = logLines().filter((line) => line['reqId'] === 'probe-3');
    expect(lines).toEqual([
      expect.objectContaining({
        level: 'warn',
        context: 'HealthController',
        err: expect.objectContaining({ message: expect.any(String) as string }) as unknown,
      }),
    ]);
  });
});

describe('CORS', () => {
  it('preflight z dozwolonego originu: origin, ciasteczka i wszystkie metody REST', async () => {
    const response = await request({
      method: 'OPTIONS',
      url: '/v1/test/items',
      headers: {
        origin: 'https://biddy.pl',
        'access-control-request-method': 'DELETE',
        'access-control-request-headers': 'content-type',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('https://biddy.pl');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(String(response.headers['access-control-allow-methods']).split(/,\s*/)).toEqual(
      expect.arrayContaining(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    );
  });

  it('zwykłe żądanie z dozwolonego originu udostępnia nagłówek x-request-id', async () => {
    const response = await request({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:3000' },
    });

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(response.headers['access-control-expose-headers']).toBe('x-request-id');
  });

  it('OPTIONS bez Origin (to nie preflight) → 204 bez nagłówków CORS, z x-request-id', async () => {
    const response = await request({ method: 'OPTIONS', url: '/v1/cokolwiek' });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(response.headers['x-request-id']).toMatch(UUID_V7);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('obcy origin nie dostaje nagłówków CORS', async () => {
    const response = await request({
      method: 'OPTIONS',
      url: '/v1/test/items',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('nagłówki bezpieczeństwa (helmet)', () => {
  it.each(['/health', '/v1/nie-ma', '/v1/test/boom'])(
    '%s ma ścisłe CSP i nagłówki helmet',
    async (url) => {
      const response = await request({ method: 'GET', url });

      expect(response.headers['content-security-policy']).toBe(
        "default-src 'none';base-uri 'none';form-action 'none';frame-ancestors 'none'",
      );
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(response.headers['strict-transport-security']).toContain('max-age=');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
    },
  );
});

describe('OpenAPI (/docs)', () => {
  it('Swagger UI: HTML z łagodniejszym CSP tylko dla /docs', async () => {
    const response = await request({ method: 'GET', url: '/docs' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.body).toContain('swagger-ui-bundle.js');
    const csp = String(response.headers['content-security-policy']);
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("default-src 'none'");
  });

  it('wszystkie zasoby Swagger UI (CSS, JS, ikony, init) ładują się (200)', async () => {
    const html = (await request({ method: 'GET', url: '/docs' })).body;
    const references = [...html.matchAll(/(?:href|src)=["']([^"']+)["']/g)].map(
      ([, reference]) => new URL(reference ?? '', 'http://localhost/docs').pathname,
    );

    expect(references).toEqual(
      expect.arrayContaining([
        '/docs/swagger-ui.css',
        '/docs/swagger-ui-bundle.js',
        '/docs/swagger-ui-standalone-preset.js',
        '/docs/swagger-ui-init.js',
      ]),
    );
    for (const path of references) {
      const asset = await request({ method: 'GET', url: path });
      expect(asset.statusCode, path).toBe(200);
      expect(String(asset.headers['content-security-policy']), path).toContain("script-src 'self'");
    }
  });

  it('dokument JSON pod /docs/json: tytuł, wersja, trasy /v1 bez sond, schemat ProblemDetails', async () => {
    const response = await request({ method: 'GET', url: '/docs/json' });

    expect(response.statusCode).toBe(200);
    const document = response.json<{
      info: { title: string; version: string };
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    }>();
    expect(document.info).toMatchObject({ title: 'Biddy API', version: 'test-release' });
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining(['/v1/test/items', '/v1/test/search']),
    );
    expect(Object.keys(document.paths)).not.toContain('/health');
    expect(Object.keys(document.paths)).not.toContain('/ready');
    expect(document.components.schemas).toHaveProperty('ProblemDetails');
    expect(document.components.schemas).toHaveProperty('CreateItemDto');
  });
});

describe('OpenAPI wyłączone', () => {
  it('bez OpenAPI /docs i /docs/json zwracają 404 Problem Details', async () => {
    const disabled = await createApp(testConfig({ OPENAPI_ENABLED: 'false' }), {
      logDestination: new Writable({ write: (_chunk, _encoding, callback) => callback() }),
    });
    try {
      const instance = disabled.getHttpAdapter().getInstance();
      for (const url of ['/docs', '/docs/json']) {
        const response = await instance.inject({ method: 'GET', url });
        expect(response.statusCode, url).toBe(404);
        expect(response.headers['content-type'], url).toBe(PROBLEM_JSON);
      }
    } finally {
      await disabled.close();
    }
  });
});

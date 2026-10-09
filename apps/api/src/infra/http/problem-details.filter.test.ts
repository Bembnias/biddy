import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

import { isProblemDetails, type ProblemDetails } from '@biddy/shared';
import {
  type ArgumentsHost,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ZodValidationException } from 'nestjs-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { DomainError } from './domain-error.js';
import { ProblemDetailsFilter } from './problem-details.filter.js';
import { rememberReply } from './problem-response.js';

const sentry = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock('@sentry/nestjs', () => sentry);

interface FakeReply {
  sent: boolean;
  statusCode: number;
  headers: Record<string, string>;
  payload: unknown;
  status(code: number): FakeReply;
  header(name: string, value: string): FakeReply;
  send(payload: unknown): FakeReply;
}

function fakeReply(): FakeReply {
  const reply: FakeReply = {
    sent: false,
    statusCode: 200,
    headers: {},
    payload: undefined,
    status(code) {
      reply.statusCode = code;
      return reply;
    },
    header(name, value) {
      reply.headers[name.toLowerCase()] = value;
      return reply;
    },
    send(payload) {
      reply.payload = payload;
      reply.sent = true;
      return reply;
    },
  };
  return reply;
}

function setup(options: { url?: string; type?: string } = {}) {
  const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const url = options.url ?? '/v1/things/7?token=secret';
  const request = { id: 'req-42', url, originalUrl: url, log };
  const reply = fakeReply();
  const host = {
    getType: () => options.type ?? 'http',
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
  } as unknown as ArgumentsHost;
  return { log, reply, host };
}

function fastifyError(code: string, statusCode: number): Error {
  return Object.assign(new Error('Fastify error'), { name: 'FastifyError', code, statusCode });
}

describe('ProblemDetailsFilter', () => {
  const filter = new ProblemDetailsFilter({ exposeInternals: false });

  beforeEach(() => {
    sentry.captureException.mockClear();
  });

  it.each<[label: string, exception: unknown, status: number, code: string]>([
    [
      'DomainError',
      new DomainError({ code: 'CONFLICT', detail: 'Już zakończona.' }),
      409,
      'CONFLICT',
    ],
    [
      'ZodValidationException',
      new ZodValidationException(z.object({ a: z.string() }).safeParse({}).error),
      400,
      'VALIDATION_FAILED',
    ],
    ['BadRequestException', new BadRequestException(), 400, 'BAD_REQUEST'],
    [
      'NotFoundException (nieznana trasa)',
      new NotFoundException('Cannot GET /x'),
      404,
      'NOT_FOUND',
    ],
    ['zły JSON (Fastify)', fastifyError('FST_ERR_CTP_INVALID_JSON_BODY', 400), 400, 'BAD_REQUEST'],
    [
      'nieobsługiwany typ treści (Fastify)',
      fastifyError('FST_ERR_CTP_INVALID_MEDIA_TYPE', 415),
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    ],
    [
      'za duża treść (Fastify)',
      fastifyError('FST_ERR_CTP_BODY_TOO_LARGE', 413),
      413,
      'PAYLOAD_TOO_LARGE',
    ],
    ['nieznany błąd', new Error('db password=secret'), 500, 'INTERNAL_ERROR'],
  ])('%s → %i %s jako application/problem+json', (_label, exception, status, code) => {
    const { reply, host } = setup();

    filter.catch(exception, host);

    expect(reply.statusCode).toBe(status);
    expect(reply.headers['content-type']).toBe('application/problem+json; charset=utf-8');
    expect(reply.headers['cache-control']).toBe('no-store');
    const problem = reply.payload as ProblemDetails;
    expect(isProblemDetails(problem)).toBe(true);
    expect(problem).toMatchObject({
      status,
      code,
      requestId: 'req-42',
      instance: '/v1/things/7',
      type: `https://biddy.pl/problems/${code.toLowerCase().replaceAll('_', '-')}`,
    });
  });

  it('instance to ścieżka bez parametrów zapytania (mogą zawierać tokeny)', () => {
    const { reply, host } = setup({ url: '/v1/auth/reset?token=abc' });
    filter.catch(new NotFoundException(), host);
    expect((reply.payload as ProblemDetails).instance).toBe('/v1/auth/reset');
  });

  it('nieznany błąd: loguje z obiektem błędu (logger żądania ma reqId) i wysyła do Sentry', () => {
    const { log, reply, host } = setup();
    const error = new Error('db password=secret');

    filter.catch(error, host);

    expect(log.error).toHaveBeenCalledWith(
      { err: error },
      'Nieoczekiwany błąd podczas obsługi żądania',
    );
    expect(sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { request_id: 'req-42' },
    });
    expect(JSON.stringify(reply.payload)).not.toContain('secret');
  });

  it.each([
    ['DomainError 4xx', new DomainError({ code: 'FORBIDDEN' })],
    ['walidacja', new ZodValidationException(new Error('x'))],
    ['404', new NotFoundException()],
    ['zły JSON', fastifyError('FST_ERR_CTP_INVALID_JSON_BODY', 400)],
    ['SERVICE_UNAVAILABLE', new DomainError({ code: 'SERVICE_UNAVAILABLE' })],
  ])('%s: bez logu błędu i bez Sentry', (_label, exception) => {
    const { log, host } = setup();

    filter.catch(exception, host);

    expect(log.error).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('gdy odpowiedź już wysłano, tylko loguje (nie wysyła drugi raz)', () => {
    const { log, reply, host } = setup();
    reply.sent = true;
    const send = vi.spyOn(reply, 'send');

    filter.catch(new Error('stream'), host);

    expect(send).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalled();
  });

  it('w development dołącza szczegóły nieznanego błędu w polu debug', () => {
    const devFilter = new ProblemDetailsFilter({ exposeInternals: true });
    const { reply, host } = setup();

    devFilter.catch(new TypeError('boom'), host);

    expect((reply.payload as ProblemDetails)['debug']).toMatchObject({
      name: 'TypeError',
      message: 'boom',
    });
  });

  describe('wyjątek z middleware NestJS (surowe żądanie i odpowiedź Node)', () => {
    function rawPair(url: string) {
      const request = new IncomingMessage(new Socket());
      request.url = url;
      request.method = 'GET';
      const response = new ServerResponse(request);
      return { request, response };
    }

    function middlewareHost(request: IncomingMessage, response: ServerResponse) {
      return {
        getType: () => 'http',
        switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
      } as unknown as ArgumentsHost;
    }

    it('odpowiada przez odpowiedź Fastify zapamiętaną w hooku onRequest', () => {
      const { request, response } = rawPair('/v1/m/x?token=secret');
      const { reply } = setup({ url: '/v1/m/x?token=secret' });
      const fastifyReply = Object.assign(reply, {
        raw: response,
        request: { id: 'req-mw', url: '/x', originalUrl: '/v1/m/x?token=secret', log: {} },
      });
      rememberReply(fastifyReply as unknown as FastifyReply);

      filter.catch(new UnauthorizedException(), middlewareHost(request, response));

      expect(reply.statusCode).toBe(401);
      expect(reply.headers['content-type']).toBe('application/problem+json; charset=utf-8');
      expect(reply.payload).toMatchObject({
        code: 'UNAUTHORIZED',
        requestId: 'req-mw',
        // Ścieżka sprzed skrócenia przez @fastify/middie, bez parametrów zapytania.
        instance: '/v1/m/x',
      });
    });

    it('bez znanej odpowiedzi Fastify zapisuje Problem Details wprost (żądanie nie wisi)', () => {
      const { request, response } = rawPair('/v1/m/y?token=secret');
      Object.assign(request, { id: 'req-raw', log: { error: vi.fn() } });
      const end = vi.spyOn(response, 'end');

      filter.catch(new Error('awaria middleware'), middlewareHost(request, response));

      expect(response.statusCode).toBe(500);
      expect(response.getHeader('content-type')).toBe('application/problem+json; charset=utf-8');
      expect(response.getHeader('x-request-id')).toBe('req-raw');
      const body = JSON.parse(String(end.mock.calls[0]?.[0])) as ProblemDetails;
      expect(body).toMatchObject({
        code: 'INTERNAL_ERROR',
        requestId: 'req-raw',
        instance: '/v1/m/y',
      });
      expect(JSON.stringify(body)).not.toContain('awaria');
      expect(sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
        tags: { request_id: 'req-raw' },
      });
    });
  });

  it('kontekst inny niż HTTP przekazuje wyjątek dalej', () => {
    const { host } = setup({ type: 'ws' });
    const error = new Error('ws');
    expect(() => filter.catch(error, host)).toThrow(error);
  });
});

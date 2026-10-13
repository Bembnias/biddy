import { ERROR_CODES, isProblemDetails } from '@biddy/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  MethodNotAllowedException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ZodSerializationException, ZodValidationException } from 'nestjs-zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { DomainError } from './domain-error.js';
import { ERROR_DEFINITIONS, codeForStatus } from './error-catalog.js';
import { type ProblemContext, toProblemDetails } from './problem-details.js';

const context: ProblemContext = {
  instance: '/v1/auctions/123',
  requestId: 'req-1',
  exposeInternals: false,
};

function fastifyError(code: string, statusCode: number, message = 'Fastify error'): Error {
  return Object.assign(new Error(message), { name: 'FastifyError', code, statusCode });
}

describe('ERROR_DEFINITIONS', () => {
  it('opisuje każdy kod z @biddy/shared statusem 4xx/5xx, tytułem i opisem po polsku', () => {
    expect(Object.keys(ERROR_DEFINITIONS).sort()).toEqual(Object.keys(ERROR_CODES).sort());
    for (const definition of Object.values(ERROR_DEFINITIONS)) {
      expect(definition.status).toBeGreaterThanOrEqual(400);
      expect(definition.status).toBeLessThan(600);
      expect(definition.title).not.toBe('');
      expect(definition.detail).not.toBe('');
    }
  });

  it('codeForStatus: znane statusy mają własny kod, pozostałe ogólny', () => {
    expect(codeForStatus(404)).toBe('NOT_FOUND');
    expect(codeForStatus(429)).toBe('RATE_LIMITED');
    expect(codeForStatus(418)).toBe('BAD_REQUEST');
    expect(codeForStatus(502)).toBe('INTERNAL_ERROR');
    expect(codeForStatus(503)).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('toProblemDetails: pola wspólne', () => {
  it('ma wszystkie pola RFC 9457 oraz code i requestId; przechodzi isProblemDetails', () => {
    const { problem } = toProblemDetails(new NotFoundException(), context);

    expect(problem).toEqual({
      type: 'https://biddy.pl/problems/not-found',
      title: 'Nie znaleziono',
      status: 404,
      detail: 'Nie znaleziono zasobu pod tym adresem.',
      instance: '/v1/auctions/123',
      code: 'NOT_FOUND',
      requestId: 'req-1',
    });
    expect(isProblemDetails(problem)).toBe(true);
  });
});

describe('toProblemDetails: walidacja (nestjs-zod)', () => {
  const schema = z.object({
    title: z.string().min(3, 'Tytuł musi mieć co najmniej 3 znaki'),
    price: z.object({ amount: z.number().int() }),
    tags: z.array(z.string()),
  });

  it('ZodValidationException → 400 VALIDATION_FAILED z listą błędów pól', () => {
    const result = schema.safeParse({ title: 'ab', price: { amount: 1.5 }, tags: ['ok', 7] });
    expect(result.success).toBe(false);

    const { problem, unexpected } = toProblemDetails(
      new ZodValidationException(result.error),
      context,
    );

    expect(unexpected).toBe(false);
    expect(problem).toMatchObject({
      type: 'https://biddy.pl/problems/validation-failed',
      status: 400,
      code: 'VALIDATION_FAILED',
      title: 'Nieprawidłowe dane',
      requestId: 'req-1',
    });
    expect(problem.errors).toEqual([
      { path: 'title', code: 'too_small', message: 'Tytuł musi mieć co najmniej 3 znaki' },
      { path: 'price.amount', code: 'invalid_type', message: expect.any(String) as string },
      { path: 'tags.1', code: 'invalid_type', message: expect.any(String) as string },
    ]);
  });

  it('błąd całej treści (np. brak obiektu) ma pustą ścieżkę', () => {
    const result = schema.safeParse('tekst');
    const { problem } = toProblemDetails(new ZodValidationException(result.error), context);
    expect(problem.errors).toEqual([
      { path: '', code: 'invalid_type', message: expect.any(String) as string },
    ]);
  });

  it('wyjątek bez listy problemów daje pustą listę errors', () => {
    const { problem } = toProblemDetails(new ZodValidationException(new Error('?')), context);
    expect(problem.code).toBe('VALIDATION_FAILED');
    expect(problem.errors).toEqual([]);
  });
});

describe('toProblemDetails: HttpException z NestJS', () => {
  it.each<[HttpException, number, string]>([
    [new BadRequestException('Bad'), 400, 'BAD_REQUEST'],
    [new UnauthorizedException(), 401, 'UNAUTHORIZED'],
    [new ForbiddenException(), 403, 'FORBIDDEN'],
    [new NotFoundException('Cannot GET /x'), 404, 'NOT_FOUND'],
    [new MethodNotAllowedException(), 405, 'METHOD_NOT_ALLOWED'],
    [new ConflictException(), 409, 'CONFLICT'],
    [new PayloadTooLargeException(), 413, 'PAYLOAD_TOO_LARGE'],
    [new UnsupportedMediaTypeException(), 415, 'UNSUPPORTED_MEDIA_TYPE'],
    [new HttpException('Too many', 429), 429, 'RATE_LIMITED'],
    [new HttpException("I'm a teapot", 418), 418, 'BAD_REQUEST'],
  ])('%s → %i %s, bez zgłoszenia do Sentry', (exception, status, code) => {
    const { problem, unexpected } = toProblemDetails(exception, context);
    expect(problem.status).toBe(status);
    expect(problem.code).toBe(code);
    expect(problem.detail).toBe(ERROR_DEFINITIONS[codeForStatus(status)].detail);
    expect(unexpected).toBe(false);
  });

  it('nie przepisuje angielskiego komunikatu wyjątku do odpowiedzi (poza development)', () => {
    const { problem } = toProblemDetails(new NotFoundException('Cannot GET /secret'), context);
    expect(JSON.stringify(problem)).not.toContain('Cannot GET');
    expect(problem).not.toHaveProperty('debug');
  });

  it('w development dołącza oryginalny komunikat w polu debug', () => {
    const { problem } = toProblemDetails(new NotFoundException('Cannot GET /x'), {
      ...context,
      exposeInternals: true,
    });
    expect(problem['debug']).toEqual({ message: 'Cannot GET /x' });
  });

  it('5xx z HttpException to nieoczekiwany błąd serwera (INTERNAL_ERROR, Sentry)', () => {
    const { problem, unexpected } = toProblemDetails(new InternalServerErrorException(), context);
    expect(problem).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    expect(unexpected).toBe(true);

    const serialization = toProblemDetails(new ZodSerializationException(new Error('x')), context);
    expect(serialization.problem.code).toBe('INTERNAL_ERROR');
    expect(serialization.unexpected).toBe(true);

    const badGateway = toProblemDetails(new HttpException('Bad gateway', 502), context);
    expect(badGateway.problem).toMatchObject({ status: 502, code: 'INTERNAL_ERROR' });
  });

  it('503 to świadoma niedostępność, nie zgłaszamy jej do Sentry', () => {
    const { problem, unexpected } = toProblemDetails(new ServiceUnavailableException(), context);
    expect(problem).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    expect(unexpected).toBe(false);
  });

  it('status spoza 4xx/5xx w HttpException traktuje jak błąd serwera', () => {
    const { problem, unexpected } = toProblemDetails(new HttpException('OK?', 200), context);
    expect(problem).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    expect(unexpected).toBe(true);
  });
});

describe('toProblemDetails: błędy Fastify (przed kontrolerem)', () => {
  it.each<[string, number, string, string]>([
    ['FST_ERR_CTP_INVALID_JSON_BODY', 400, 'BAD_REQUEST', 'nie jest poprawnym JSON-em'],
    ['FST_ERR_CTP_EMPTY_JSON_BODY', 400, 'BAD_REQUEST', 'pusta'],
    ['FST_ERR_CTP_INVALID_MEDIA_TYPE', 415, 'UNSUPPORTED_MEDIA_TYPE', 'application/json'],
    ['FST_ERR_CTP_BODY_TOO_LARGE', 413, 'PAYLOAD_TOO_LARGE', 'rozmiar'],
    ['FST_ERR_CTP_INVALID_CONTENT_LENGTH', 400, 'BAD_REQUEST', 'Content-Length'],
  ])('%s → %i %s', (fstCode, status, code, detailFragment) => {
    const { problem, unexpected } = toProblemDetails(fastifyError(fstCode, status), context);
    expect(problem).toMatchObject({ status, code });
    expect(problem.detail).toContain(detailFragment);
    expect(unexpected).toBe(false);
  });

  it('inny błąd Fastify 4xx dostaje kod według statusu', () => {
    const { problem } = toProblemDetails(fastifyError('FST_ERR_BAD_URL', 400), context);
    expect(problem).toMatchObject({ status: 400, code: 'BAD_REQUEST' });
  });

  it('błąd Fastify 5xx albo bez statusu to błąd serwera', () => {
    expect(toProblemDetails(fastifyError('FST_ERR_SOMETHING', 500), context)).toMatchObject({
      problem: { status: 500, code: 'INTERNAL_ERROR' },
      unexpected: true,
    });
    const noStatus = Object.assign(new Error('x'), { code: 'FST_ERR_X' });
    expect(toProblemDetails(noStatus, context).problem.status).toBe(500);
  });
});

describe('toProblemDetails: DomainError', () => {
  it('używa kodu, statusu domyślnego dla kodu i opisu z wyjątku', () => {
    const error = new DomainError({ code: 'CONFLICT', detail: 'Aukcja została już zakończona.' });
    const { problem, unexpected } = toProblemDetails(error, context);

    expect(problem).toEqual({
      type: 'https://biddy.pl/problems/conflict',
      title: 'Konflikt',
      status: 409,
      detail: 'Aukcja została już zakończona.',
      instance: '/v1/auctions/123',
      code: 'CONFLICT',
      requestId: 'req-1',
    });
    expect(unexpected).toBe(false);
  });

  it('bez opisu używa domyślnego opisu kodu; status można nadpisać', () => {
    const error = new DomainError({ code: 'BAD_REQUEST', status: 422 });
    expect(error.status).toBe(422);
    expect(error.detail).toBe(ERROR_DEFINITIONS.BAD_REQUEST.detail);
    expect(toProblemDetails(error, context).problem.status).toBe(422);
  });

  it('dodaje rozszerzenia, ale nie pozwala nadpisać pól standardowych', () => {
    const error = new DomainError({
      code: 'CONFLICT',
      extensions: { minimumBid: 1500, status: 200, code: 'HACK', requestId: 'x', debug: 'x' },
    });
    const { problem } = toProblemDetails(error, context);

    expect(problem['minimumBid']).toBe(1500);
    expect(problem.status).toBe(409);
    expect(problem.code).toBe('CONFLICT');
    expect(problem.requestId).toBe('req-1');
    expect(problem).not.toHaveProperty('debug');
  });

  it('SERVICE_UNAVAILABLE nie trafia do Sentry, inne 5xx tak', () => {
    expect(
      toProblemDetails(new DomainError({ code: 'SERVICE_UNAVAILABLE' }), context).unexpected,
    ).toBe(false);
    expect(toProblemDetails(new DomainError({ code: 'INTERNAL_ERROR' }), context).unexpected).toBe(
      true,
    );
  });

  it('przyczyna (cause) nie trafia do odpowiedzi', () => {
    const error = new DomainError({ code: 'CONFLICT', cause: new Error('SQL: duplicate key') });
    expect(error.cause).toBeInstanceOf(Error);
    expect(JSON.stringify(toProblemDetails(error, context).problem)).not.toContain('SQL');
  });
});

describe('toProblemDetails: nieznane błędy', () => {
  it.each([
    ['Error', new Error('connection string postgres://user:secret@db')],
    ['TypeError', new TypeError("Cannot read properties of undefined (reading 'id')")],
    [
      'SyntaxError ze statusCode (nie ufamy cudzym statusom)',
      Object.assign(new SyntaxError('x'), { statusCode: 400 }),
    ],
    ['tekst', 'boom'],
    ['null', null],
  ])('%s → 500 INTERNAL_ERROR bez szczegółów', (_label, exception) => {
    const { problem, unexpected } = toProblemDetails(exception, context);

    expect(problem).toEqual({
      type: 'https://biddy.pl/problems/internal-error',
      title: 'Błąd serwera',
      status: 500,
      detail: 'Wystąpił nieoczekiwany błąd serwera. Spróbuj ponownie za chwilę.',
      instance: '/v1/auctions/123',
      code: 'INTERNAL_ERROR',
      requestId: 'req-1',
    });
    expect(unexpected).toBe(true);
  });

  it('w development dołącza nazwę, komunikat i stos w polu debug', () => {
    const { problem } = toProblemDetails(new TypeError('boom'), {
      ...context,
      exposeInternals: true,
    });
    expect(problem['debug']).toMatchObject({ name: 'TypeError', message: 'boom' });
    expect((problem['debug'] as { stack: string }).stack).toContain('TypeError: boom');
  });
});

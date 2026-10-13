// Wysyłanie Problem Details (RFC 9457) jako odpowiedzi HTTP: wspólne dla globalnego filtra
// wyjątków NestJS i dla błędów, które Fastify zgłasza przed routingiem (np. zły adres URL).
import type { IncomingMessage, ServerResponse } from 'node:http';

import { PROBLEM_CONTENT_TYPE } from '@biddy/shared';
import { captureException } from '@sentry/nestjs';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { toProblemDetails } from './problem-details.js';
import { REQUEST_ID_HEADER, requestIdFor } from './request-id.js';
import { pathWithoutQuery } from './url.js';

/** Nagłówek Content-Type odpowiedzi z błędem. */
export const PROBLEM_CONTENT_TYPE_HEADER = `${PROBLEM_CONTENT_TYPE}; charset=utf-8`;

export interface ProblemResponseOptions {
  /** Tylko development na adresie lokalnym: szczegóły wyjątku w polu `debug`. */
  readonly exposeInternals: boolean;
}

const UNEXPECTED_ERROR_MESSAGE = 'Nieoczekiwany błąd podczas obsługi żądania';

/**
 * Odpowiedzi Fastify według surowych odpowiedzi Node. Middleware NestJS (@fastify/middie)
 * dostaje tylko `ServerResponse`, a filtr wyjątków potrzebuje odpowiedzi Fastify, żeby wysłać
 * błąd z nagłówkami ustawionymi wcześniej (x-request-id, CORS) i z logiem zakończenia żądania.
 */
const repliesByRawResponse = new WeakMap<ServerResponse, FastifyReply>();

/** Zapamiętuje odpowiedź Fastify dla jej surowej odpowiedzi (hook onRequest). */
export function rememberReply(reply: FastifyReply): void {
  repliesByRawResponse.set(reply.raw, reply);
}

/** Odpowiedź Fastify (`reply.status`), a nie surowa odpowiedź Node (`statusCode`). */
export function isFastifyReply(response: unknown): response is FastifyReply {
  return (
    typeof response === 'object' &&
    response !== null &&
    typeof (response as { status?: unknown }).status === 'function'
  );
}

/** Odpowiedź Fastify dla surowej odpowiedzi Node, jeśli żądanie przeszło przez hook onRequest. */
export function replyForRawResponse(response: ServerResponse): FastifyReply | undefined {
  return repliesByRawResponse.get(response);
}

/** Loguje (z reqId) i zgłasza do Sentry błąd, którego API nie przewidziało. */
function reportUnexpected(
  exception: unknown,
  requestId: string,
  log: Pick<FastifyRequest['log'], 'error'>,
): void {
  log.error({ err: exception }, UNEXPECTED_ERROR_MESSAGE);
  captureException(exception, { tags: { request_id: requestId } });
}

/**
 * Mapuje wyjątek na Problem Details i wysyła go odpowiedzią Fastify. Nieoczekiwane błędy loguje
 * z identyfikatorem żądania i wysyła do Sentry; błędów 4xx nie.
 */
export function replyWithProblem(
  exception: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
  options: ProblemResponseOptions,
): void {
  const { problem, unexpected } = toProblemDetails(exception, {
    // originalUrl: middleware NestJS może chwilowo skrócić request.url o prefiks trasy.
    instance: pathWithoutQuery(request.originalUrl),
    requestId: request.id,
    exposeInternals: options.exposeInternals,
  });

  // Błędy oczekiwane (4xx, świadome SERVICE_UNAVAILABLE) widać w logu zakończenia żądania;
  // przyczynę 503 loguje kod, który go zgłasza (np. sonda /ready).
  if (unexpected) {
    reportUnexpected(exception, request.id, request.log);
  }
  if (reply.sent) {
    // Odpowiedź już wysłana (np. strumień przerwany w połowie): zostaje tylko log.
    return;
  }
  void reply
    .status(problem.status)
    .header('content-type', PROBLEM_CONTENT_TYPE_HEADER)
    .header('cache-control', 'no-store')
    .header(REQUEST_ID_HEADER, problem.requestId)
    .send(problem);
}

/** Surowe żądanie Node z polami, które dopisuje @fastify/middie. */
type RawRequest = IncomingMessage & {
  readonly id?: unknown;
  readonly originalUrl?: string;
  readonly log?: Pick<FastifyRequest['log'], 'error'>;
};

/**
 * Awaryjna ścieżka: odpowiedź Node bez znanej odpowiedzi Fastify (żądanie nie przeszło przez
 * hook onRequest). Zapisuje Problem Details bezpośrednio, żeby żądanie nie zawisło.
 */
export function writeProblemToRawResponse(
  exception: unknown,
  request: RawRequest,
  response: ServerResponse,
  options: ProblemResponseOptions,
): void {
  const requestId = typeof request.id === 'string' ? request.id : requestIdFor(request);
  const { problem, unexpected } = toProblemDetails(exception, {
    instance: pathWithoutQuery(request.originalUrl ?? request.url ?? '/'),
    requestId,
    exposeInternals: options.exposeInternals,
  });
  if (unexpected) {
    reportUnexpected(exception, requestId, request.log ?? console);
  }
  if (response.headersSent) {
    if (!response.writableEnded) {
      response.end();
    }
    return;
  }
  const body = JSON.stringify(problem);
  // setHeader zamiast writeHead(…, nagłówki): zostają nagłówki ustawione już na surowej
  // odpowiedzi (np. przez helmet).
  response.statusCode = problem.status;
  response.setHeader('content-type', PROBLEM_CONTENT_TYPE_HEADER);
  response.setHeader('content-length', Buffer.byteLength(body));
  response.setHeader('cache-control', 'no-store');
  response.setHeader(REQUEST_ID_HEADER, requestId);
  response.end(body);
}

import type { IncomingMessage, ServerResponse } from 'node:http';

import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import {
  isFastifyReply,
  type ProblemResponseOptions,
  replyForRawResponse,
  replyWithProblem,
  writeProblemToRawResponse,
} from './problem-response.js';

export type ProblemDetailsFilterOptions = ProblemResponseOptions;

/**
 * Globalny filtr wyjątków HTTP: każdy błąd (także z Fastify, np. zły JSON albo nieznana trasa,
 * i z middleware NestJS) trafia do klienta jako application/problem+json z kodem domenowym
 * i requestId. Nieoczekiwane błędy loguje z identyfikatorem żądania i wysyła do Sentry.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(private readonly options: ProblemDetailsFilterOptions) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    // Na razie API ma tylko HTTP; gateway WebSocket (F-17) dostanie własny filtr.
    if (host.getType() !== 'http') {
      throw exception;
    }
    const http = host.switchToHttp();
    const response = http.getResponse<unknown>();

    if (isFastifyReply(response)) {
      replyWithProblem(exception, http.getRequest<FastifyRequest>(), response, this.options);
      return;
    }

    // Wyjątek z middleware NestJS: pod adapterem Fastify (@fastify/middie) Nest podaje surowe
    // żądanie i odpowiedź Node. Wracamy do odpowiedzi Fastify zapamiętanej w hooku onRequest.
    const raw = response as ServerResponse;
    const reply = replyForRawResponse(raw);
    if (reply !== undefined) {
      replyWithProblem(exception, reply.request, reply, this.options);
      return;
    }
    writeProblemToRawResponse(exception, http.getRequest<IncomingMessage>(), raw, this.options);
  }
}

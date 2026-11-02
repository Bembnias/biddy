// Endpoint webhooków operatorów płatności (F-23, PROJECT.md §7.8, §14.1):
// POST /v1/webhooks/payments/:provider. Podpis liczy się z bajtów body, więc trasa ma własny
// zakres Fastify z parserem surowych bajtów (dowolny Content-Type, limit 1 MiB). Reszta API nadal
// przyjmuje wyłącznie JSON (F-03). Trasa nie wymaga sesji (operator nie ma ciasteczek), a CSRF
// sprawdza tylko żądania z ciasteczkiem sesji.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { AppConfig } from '../../../infra/config/index.js';
import { replyWithProblem } from '../../../infra/http/index.js';
import type { PaymentEventProcessor } from '../application/payment-event-processor.js';

export const PAYMENT_WEBHOOK_PATH = '/v1/webhooks/payments/:provider';

/** Limit body webhooka (jak globalny limit JSON w API). */
const WEBHOOK_BODY_LIMIT = 1024 * 1024;

/**
 * Rejestruje trasę w osobnym zakresie Fastify. Bez `await`: oczekiwanie na register w trakcie
 * inicjalizacji NestJS załadowałoby kolejkę pluginów, zanim NestJS ustawi handler błędów, i trasy
 * kontrolerów odpowiadałyby na błędy parsera (zły JSON, 413, 415) domyślnym JSON-em Fastify
 * zamiast Problem Details. Plugin ładuje się przy `ready()`, już z handlerem NestJS.
 */
export function registerPaymentWebhookRoutes(
  fastify: FastifyInstance,
  processor: PaymentEventProcessor,
  config: AppConfig,
): void {
  const problemOptions = { exposeInternals: config.http.exposeErrorDetails };
  void fastify.register((scope, _options, done) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      '*',
      { parseAs: 'buffer', bodyLimit: WEBHOOK_BODY_LIMIT },
      (_request, body, parsed) => {
        parsed(null, body);
      },
    );
    scope.post(PAYMENT_WEBHOOK_PATH, async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { provider } = request.params as { provider: string };
        const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
        const receipt = await processor.receive(provider, { headers: request.headers, rawBody });
        await reply.status(200).send(receipt);
      } catch (error) {
        replyWithProblem(error, request, reply, problemOptions);
      }
    });
    done();
  });
}

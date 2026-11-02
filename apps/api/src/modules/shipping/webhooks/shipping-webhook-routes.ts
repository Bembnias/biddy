// Endpoint webhooków dostawców przesyłek (F-24, PROJECT.md §8.3, §14.1):
// POST /v1/webhooks/shipping/:provider. Podpis liczy się z bajtów body, więc trasa ma własny
// zakres Fastify z parserem surowych bajtów (dowolny Content-Type, limit 1 MiB), jak webhooki
// płatności (F-23). Trasa nie wymaga sesji, a CSRF sprawdza tylko żądania z ciasteczkiem sesji.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { AppConfig } from '../../../infra/config/index.js';
import { replyWithProblem } from '../../../infra/http/index.js';
import type { ShippingWebhookProcessor } from '../application/shipping-webhook-processor.js';

export const SHIPPING_WEBHOOK_PATH = '/v1/webhooks/shipping/:provider';

const WEBHOOK_BODY_LIMIT = 1024 * 1024;

/**
 * Rejestruje trasę w osobnym zakresie Fastify. Bez `await` (jak webhooki płatności): oczekiwanie
 * na register w trakcie inicjalizacji NestJS zepsułoby Problem Details w pozostałych trasach.
 */
export function registerShippingWebhookRoutes(
  fastify: FastifyInstance,
  processor: ShippingWebhookProcessor,
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
    scope.post(SHIPPING_WEBHOOK_PATH, async (request: FastifyRequest, reply: FastifyReply) => {
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

import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';

import type { AppConfig, TrustProxy } from '../config/index.js';
import { HttpLogController } from '../logger/index.js';
import { rememberReply, replyWithProblem } from './problem-response.js';
import { REQUEST_ID_HEADER, requestIdFor } from './request-id.js';
import { FALLBACK_SECURITY_HEADERS } from './security-headers.js';

/**
 * Adapter Fastify z jedną zmianą: NestJS domyślnie zamienia błędy Fastify (np.
 * FST_ERR_CTP_INVALID_JSON_BODY) na HttpException z angielskim komunikatem i gubi kod błędu.
 * Przekazujemy oryginał, a filtr Problem Details mapuje go po kodzie FST_*.
 */
export class AppFastifyAdapter extends FastifyAdapter {
  override mapException(error: unknown): unknown {
    return error;
  }
}

/** TRUST_PROXY w formacie Fastify (proxy-addr): true/false albo lista IP/CIDR. */
function fastifyTrustProxy(value: TrustProxy): boolean | string[] {
  return typeof value === 'boolean' ? value : [...value];
}

export interface HttpAdapterOptions {
  /** Ścieżki bez automatycznych logów żądań (sondy /health i /ready). */
  readonly quietPaths?: readonly string[];
}

/**
 * Adapter HTTP: logger pino jako logger Fastify (jedna linia na żądanie z reqId), request id
 * z nagłówka x-request-id albo UUIDv7, zaufane proxy według konfiguracji.
 *
 * API przyjmuje wyłącznie JSON. Parser formularzy (application/x-www-form-urlencoded) wyłącza
 * createApp (`bodyParser: false` w NestJS), a domyślny parser text/plain usuwamy tutaj. Takie
 * treści, podobnie jak multipart, dostają 415: przeglądarka wysyła je między domenami bez
 * preflightu CORS („proste żądania”), więc to pierwsza linia obrony przed CSRF. Trasa, która
 * naprawdę potrzebuje formularza (callback Apple Sign In, F-07), rejestruje parser u siebie.
 */
export function createHttpAdapter(
  config: AppConfig,
  logger: Logger,
  options: HttpAdapterOptions = {},
): AppFastifyAdapter {
  const problemOptions = { exposeInternals: config.http.exposeErrorDetails };
  const logController = new HttpLogController(options.quietPaths);
  const adapter = new AppFastifyAdapter({
    loggerInstance: logger,
    logController,
    // Nagłówek czyta requestIdFor (z walidacją formatu), nie Fastify (przyjąłby każdą wartość).
    requestIdHeader: false,
    genReqId: requestIdFor,
    trustProxy: fastifyTrustProxy(config.http.trustProxy),
    // Błędy, które Fastify zgłasza przed routingiem i hookami (zły adres URL, np. /v1/%zz,
    // za długi parametr trasy). Bez tej opcji Fastify odpowiada własnym JSON-em z kodem FST_*,
    // bez x-request-id i bez logu żądania. Hooki (helmet, CORS) tu nie działają, więc
    // podstawowe nagłówki bezpieczeństwa i log zakończenia żądania dodajemy sami.
    frameworkErrors: (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
      reply.raw.once('finish', () => {
        logController.requestCompleted(null, request, reply);
      });
      void reply.headers(FALLBACK_SECURITY_HEADERS);
      replyWithProblem(error, request, reply, problemOptions);
    },
  });

  const fastify = adapter.getInstance();
  fastify.removeContentTypeParser('text/plain');

  // Identyfikator w odpowiedzi ustawiamy na samym początku, więc mają go też błędy i 404.
  // Ten hook jest pierwszy, więc działa przed middleware NestJS (@fastify/middie).
  fastify.addHook('onRequest', (request, reply, done) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    rememberReply(reply);
    done();
  });
  return adapter;
}

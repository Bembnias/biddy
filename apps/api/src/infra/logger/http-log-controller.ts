import { type FastifyReply, type FastifyRequest, LogController } from 'fastify';

import { pathWithoutQuery } from '../http/url.js';

/**
 * Logi żądań Fastify: jedna linia po zakończeniu żądania (metoda, adres, status, czas) zamiast
 * dwóch. Każda linia ma reqId, bo Fastify loguje przez logger potomny żądania. Ścieżki
 * z `quietPaths` (sondy /health i /ready) nie są logowane automatycznie.
 */
export class HttpLogController extends LogController {
  constructor(quietPaths: readonly string[] = []) {
    const quiet = new Set(quietPaths);
    super({ disableRequestLogging: (request) => quiet.has(pathWithoutQuery(request.url)) });
  }

  override incomingRequest(): void {
    // Celowo pusto: żądanie logujemy raz, po zakończeniu (requestCompleted).
  }

  override requestCompleted(
    error: Error | null | undefined,
    request: FastifyRequest,
    reply: FastifyReply,
  ): void {
    if (this.isLogDisabled(request)) {
      return;
    }
    const fields = { req: request, res: reply, responseTime: Math.round(reply.elapsedTime) };
    if (error) {
      reply.log.error({ ...fields, err: error }, 'Żądanie przerwane błędem');
    } else if (reply.statusCode >= 500) {
      reply.log.error(fields, 'Żądanie zakończone błędem serwera');
    } else {
      reply.log.info(fields, 'Żądanie obsłużone');
    }
  }
}

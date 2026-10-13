// Logger pino dla całego API: Fastify (logi żądań z reqId), NestJS (przez nestjs-pino) i kod
// modułów. JSON na produkcji, pino-pretty w development.
import type { IncomingHttpHeaders } from 'node:http';

import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';

import type { AppConfig } from '../config/index.js';
import { pathWithoutQuery } from '../http/url.js';

/** Nagłówki z sekretami: nie mogą trafić do logów, nawet gdy ktoś zaloguje całe żądanie. */
export const REDACTED_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'headers["x-api-key"]',
  'headers["set-cookie"]',
];

interface RequestLike {
  readonly method?: string;
  readonly url?: string;
  readonly ip?: string;
  readonly headers?: IncomingHttpHeaders;
  readonly socket?: { readonly remoteAddress?: string };
}

/**
 * Żądanie w logu: bez nagłówków (mogą zawierać sesję) i bez parametrów zapytania (tokeny
 * z linków weryfikacyjnych, kody OAuth), z adresem IP i user-agentem.
 */
export function serializeRequest(request: RequestLike): Record<string, unknown> {
  return {
    method: request.method,
    url: request.url === undefined ? undefined : pathWithoutQuery(request.url),
    remoteAddress: request.ip ?? request.socket?.remoteAddress,
    userAgent: request.headers?.['user-agent'],
  };
}

export function serializeReply(reply: { readonly statusCode?: number }): Record<string, unknown> {
  return { statusCode: reply.statusCode };
}

/**
 * Tworzy główny logger aplikacji. `destination` służy testom (np. strumień w pamięci); z nim
 * logi są zawsze w JSON, bez pino-pretty.
 */
export function createRootLogger(config: AppConfig, destination?: DestinationStream): Logger {
  const options: LoggerOptions = {
    level: config.log.level,
    base: {
      service: 'biddy-api',
      env: config.env,
      ...(config.release === undefined ? {} : { release: config.release }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: [...REDACTED_PATHS], censor: '[ukryte]' },
    serializers: {
      req: serializeRequest,
      res: serializeReply,
      err: pino.stdSerializers.err,
    },
  };

  if (destination !== undefined) {
    return pino({ ...options, formatters: { level: (label) => ({ level: label }) } }, destination);
  }
  if (config.log.pretty) {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          // Np. „[HealthController] Sonda /ready…” albo „Żądanie obsłużone GET /v1/x → 404 (3 ms)”.
          messageFormat:
            '{if context}[{context}] {end}{msg}' +
            '{if req} {req.method} {req.url} → {res.statusCode} ({responseTime} ms){end}',
          ignore: 'pid,hostname,service,env,release,context,req,res,responseTime',
        },
      },
    });
  }
  // Poziom jako tekst ("info"), a nie liczba: czytelniej w Better Stack i Grafanie.
  return pino({ ...options, formatters: { level: (label) => ({ level: label }) } });
}

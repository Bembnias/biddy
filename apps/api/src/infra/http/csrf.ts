// Ochrona CSRF dla sesji w ciasteczku (PROJECT.md §16.1): żądanie zmieniające stan (POST, PUT,
// PATCH, DELETE) z ciasteczkiem sesji Biddy musi mieć nagłówek Origin z listy CORS_ORIGINS
// (OWASP: weryfikacja źródła standardowymi nagłówkami). Żądania z tokenem Bearer i bez ciasteczek
// (mobile, serwer) nie podlegają sprawdzeniu: przeglądarka nie dołączy cudzego tokenu sama.
// Drugą warstwą jest to, że API przyjmuje tylko JSON (F-03), czyli bez preflightu CORS nie da się
// wysłać żądania z obcej strony.
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { DomainError } from './domain-error.js';
import { type ProblemResponseOptions, replyWithProblem } from './problem-response.js';
import { pathWithoutQuery } from './url.js';

/** Prefiks ciasteczek sesji Better Auth (np. `biddy.session_token`, `__Secure-biddy.session_token`). */
export const AUTH_COOKIE_PREFIX = 'biddy';

/**
 * Nagłówek z adresem klienta ustalonym przez Fastify (TRUST_PROXY), przekazywany do Better Auth.
 * Ustawia go serwer; wartość od klienta jest nadpisywana.
 */
export const CLIENT_IP_HEADER = 'x-biddy-client-ip';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Callbacki OAuth (Apple wysyła form_post z appleid.apple.com) chroni parametr state. */
const EXEMPT_PATH_PREFIXES = ['/v1/auth/callback/'];

const SESSION_COOKIE = new RegExp(`(?:^|;\\s*)(?:__Secure-)?${AUTH_COOKIE_PREFIX}\\.`);

export function hasSessionCookie(cookieHeader: string | undefined): boolean {
  return cookieHeader !== undefined && SESSION_COOKIE.test(cookieHeader);
}

export type CsrfVerdict = 'allowed' | 'forbidden';

/** Czy żądanie przechodzi sprawdzenie (funkcja czysta, testowana jednostkowo). */
export function csrfVerdict(
  request: Pick<FastifyRequest, 'method' | 'url' | 'headers'>,
  allowedOrigins: ReadonlySet<string>,
): CsrfVerdict {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) {
    return 'allowed';
  }
  const path = pathWithoutQuery(request.url);
  if (EXEMPT_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return 'allowed';
  }
  if (!hasSessionCookie(request.headers.cookie)) {
    return 'allowed';
  }
  const origin = request.headers.origin;
  return typeof origin === 'string' && allowedOrigins.has(origin) ? 'allowed' : 'forbidden';
}

/**
 * Rejestruje sprawdzanie Origin; odmowa to 403 FORBIDDEN (Problem Details). Hook preHandler
 * działa po hookach onRequest (helmet, CORS), więc odpowiedź z odmową ma nagłówki CORS.
 */
export function registerCsrfProtection(
  fastify: FastifyInstance,
  allowedOrigins: readonly string[],
  problemOptions: ProblemResponseOptions,
): void {
  const origins = new Set(allowedOrigins);
  fastify.addHook('preHandler', (request, reply, done) => {
    if (csrfVerdict(request, origins) === 'forbidden') {
      replyWithProblem(
        new DomainError({
          code: 'FORBIDDEN',
          detail:
            'Żądanie z niedozwolonego źródła (nagłówek Origin). Odśwież stronę i spróbuj ponownie.',
        }),
        request,
        reply,
        problemOptions,
      );
      return;
    }
    done();
  });
}

// Trasy Better Auth w Fastify: /v1/auth/* trafia do auth.handler (Fetch API). Treść żądania jest
// już sparsowana przez Fastify (JSON; formularz tylko na callbacku Apple), więc budujemy z niej
// Fetch `Request`. Błędy Better Auth zamieniamy na Problem Details (RFC 9457) po polsku, jak
// w całym API; pole `message` zostaje dla klienta Better Auth w przeglądarce.
import {
  ERROR_CODES,
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
  isErrorCode,
  problemTypeUri,
} from '@biddy/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { AppConfig } from '../../../infra/config/index.js';
import {
  CLIENT_IP_HEADER,
  ERROR_DEFINITIONS,
  codeForStatus,
  pathWithoutQuery,
  replyWithProblem,
} from '../../../infra/http/index.js';
import type { Auth } from './auth.js';

export const AUTH_BASE_PATH = '/v1/auth';

/** Komunikaty po polsku dla kodów Better Auth, które widzi użytkownik. */
export const BETTER_AUTH_MESSAGES: Readonly<Record<string, string>> = {
  INVALID_EMAIL_OR_PASSWORD: 'Nieprawidłowy e-mail lub hasło.',
  USER_ALREADY_EXISTS: 'Konto z tym adresem już istnieje. Zaloguj się albo zresetuj hasło.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    'Konto z tym adresem już istnieje. Zaloguj się albo zresetuj hasło.',
  PASSWORD_TOO_SHORT: 'Hasło jest za krótkie: musi mieć co najmniej 10 znaków.',
  PASSWORD_TOO_LONG: 'Hasło jest za długie: może mieć najwyżej 128 znaków.',
  INVALID_EMAIL: 'Nieprawidłowy adres e-mail.',
  INVALID_TOKEN: 'Link wygasł albo jest nieprawidłowy. Poproś o nowy.',
  TOKEN_EXPIRED: 'Link wygasł. Poproś o nowy.',
  INVALID_PASSWORD: 'Nieprawidłowe hasło.',
  EMAIL_ALREADY_VERIFIED: 'Adres e-mail jest już potwierdzony.',
  INVALID_ORIGIN: 'Żądanie z niedozwolonego źródła. Odśwież stronę i spróbuj ponownie.',
  MISSING_OR_NULL_ORIGIN: 'Żądanie z niedozwolonego źródła. Odśwież stronę i spróbuj ponownie.',
  SESSION_EXPIRED: 'Sesja wygasła. Zaloguj się ponownie.',
};

/** Kody Better Auth, które odpowiadają kodom domenowym Biddy. */
const CODE_ALIASES: Readonly<Record<string, string>> = {
  VALIDATION_ERROR: ERROR_CODES.VALIDATION_FAILED,
  TOO_MANY_REQUESTS: ERROR_CODES.RATE_LIMITED,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Problem Details z odpowiedzi błędu Better Auth albo hooka Biddy (`{ code, message }`). */
export function authProblem(
  status: number,
  body: unknown,
  context: { readonly instance: string; readonly requestId: string },
): ProblemDetails {
  const raw = isRecord(body) ? body : {};
  const rawCode = typeof raw['code'] === 'string' && raw['code'] !== '' ? raw['code'] : undefined;
  const code =
    status === 429
      ? ERROR_CODES.RATE_LIMITED
      : rawCode === undefined
        ? codeForStatus(status)
        : (CODE_ALIASES[rawCode] ?? rawCode);
  const generic = ERROR_DEFINITIONS[isErrorCode(code) ? code : codeForStatus(status)];
  const ownMessage =
    isErrorCode(rawCode) && typeof raw['message'] === 'string' ? raw['message'] : undefined;
  const detail =
    ownMessage ??
    (rawCode === undefined ? undefined : BETTER_AUTH_MESSAGES[rawCode]) ??
    generic.detail;
  return {
    type: problemTypeUri(code),
    title: generic.title,
    status,
    detail,
    instance: context.instance,
    code,
    requestId: context.requestId,
    // Klient Better Auth (web) czyta komunikat błędu z pola `message`.
    message: detail,
  };
}

/** Żądanie Fastify jako Fetch `Request` dla Better Auth. */
export function toFetchRequest(request: FastifyRequest, baseUrl: string): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || name === 'content-length' || name === CLIENT_IP_HEADER) {
      continue;
    }
    for (const item of Array.isArray(value) ? value : [value]) {
      headers.append(name, item);
    }
  }
  // Adres klienta według Fastify (TRUST_PROXY), a nie dowolny nagłówek od klienta.
  headers.set(CLIENT_IP_HEADER, request.ip);

  let body: string | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.body !== undefined) {
    const formEncoded = headers
      .get('content-type')
      ?.startsWith('application/x-www-form-urlencoded');
    body = formEncoded
      ? new URLSearchParams(request.body as Record<string, string>).toString()
      : JSON.stringify(request.body);
  }
  return new Request(new URL(request.url, baseUrl), {
    method: request.method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

/** Odpowiedź Better Auth (Fetch `Response`) wysłana przez Fastify; błędy jako Problem Details. */
export async function sendFetchResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  response: Response,
): Promise<void> {
  void reply.status(response.status);
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie' && name !== 'content-length' && name !== 'content-encoding') {
      void reply.header(name, value);
    }
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) {
    void reply.header('set-cookie', cookies);
  }
  const text = await response.text();
  if (response.status >= 400) {
    let body: unknown;
    try {
      body = text === '' ? undefined : JSON.parse(text);
    } catch {
      body = undefined;
    }
    const problem = authProblem(response.status, body, {
      instance: pathWithoutQuery(request.url),
      requestId: request.id,
    });
    await reply.type(`${PROBLEM_CONTENT_TYPE}; charset=utf-8`).send(problem);
    return;
  }
  await reply.send(text === '' ? undefined : text);
}

/**
 * Rejestruje trasy Better Auth. Callback Apple (form_post) dostaje parser formularzy tylko dla
 * siebie: reszta API przyjmuje wyłącznie JSON (F-03).
 */
export async function registerAuthRoutes(
  fastify: FastifyInstance,
  auth: Auth,
  config: AppConfig,
): Promise<void> {
  const problemOptions = { exposeInternals: config.http.exposeErrorDetails };
  const handle = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await sendFetchResponse(
        request,
        reply,
        await auth.handler(toFetchRequest(request, config.auth.apiUrl)),
      );
    } catch (error) {
      replyWithProblem(error, request, reply, problemOptions);
    }
  };

  fastify.route({ method: ['GET', 'POST'], url: `${AUTH_BASE_PATH}/*`, handler: handle });

  if (config.auth.apple !== undefined) {
    await fastify.register((scope, _options, done) => {
      scope.addContentTypeParser(
        'application/x-www-form-urlencoded',
        { parseAs: 'string' },
        (_request, body, parsed) => {
          parsed(null, Object.fromEntries(new URLSearchParams(String(body))));
        },
      );
      scope.post(`${AUTH_BASE_PATH}/callback/apple`, handle);
      done();
    });
  }
}

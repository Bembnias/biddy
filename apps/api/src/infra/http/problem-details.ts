// Zamiana dowolnego wyjątku na Problem Details (RFC 9457) z kodem domenowym. Czysta funkcja
// (bez Nest i Fastify w argumentach), więc mapowanie da się przetestować bez serwera.
import {
  type ErrorCode,
  type ProblemDetails,
  type ProblemFieldError,
  problemTypeUri,
} from '@biddy/shared';
import { HttpException } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';

import { DomainError } from './domain-error.js';
import { ERROR_DEFINITIONS, codeForStatus, isErrorStatus } from './error-catalog.js';

export interface ProblemContext {
  /** Ścieżka żądania (bez parametrów zapytania). */
  readonly instance: string;
  readonly requestId: string;
  /** Tylko development: dołącz nazwę, komunikat i stos wyjątku w polu `debug`. */
  readonly exposeInternals: boolean;
}

export interface MappedProblem {
  readonly problem: ProblemDetails;
  /**
   * Nieoczekiwany błąd serwera: zalogować jako error i wysłać do Sentry. Błędy 4xx i świadome
   * SERVICE_UNAVAILABLE (np. /ready przy niedostępnej bazie) tego nie wymagają.
   */
  readonly unexpected: boolean;
}

/** Pola standardowe, których rozszerzenia DomainError nie mogą nadpisać. */
const RESERVED_FIELDS = new Set([
  'type',
  'title',
  'status',
  'detail',
  'instance',
  'code',
  'requestId',
  'errors',
  'debug',
]);

/** Opisy błędów Fastify (adres URL, parsowanie treści), które nie docierają do kontrolerów. */
const FASTIFY_ERRORS: Readonly<Record<string, { code: ErrorCode; detail: string }>> = {
  FST_ERR_CTP_INVALID_JSON_BODY: {
    code: 'BAD_REQUEST',
    detail: 'Treść żądania nie jest poprawnym JSON-em.',
  },
  FST_ERR_CTP_EMPTY_JSON_BODY: {
    code: 'BAD_REQUEST',
    detail: 'Treść żądania jest pusta, a nagłówek Content-Type wskazuje JSON.',
  },
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: {
    code: 'BAD_REQUEST',
    detail: 'Nagłówek Content-Length nie zgadza się z długością treści żądania.',
  },
  FST_ERR_CTP_INVALID_MEDIA_TYPE: {
    code: 'UNSUPPORTED_MEDIA_TYPE',
    detail: 'Nieobsługiwany typ treści żądania. Wyślij dane jako application/json.',
  },
  FST_ERR_CTP_BODY_TOO_LARGE: {
    code: 'PAYLOAD_TOO_LARGE',
    detail: 'Treść żądania przekracza dopuszczalny rozmiar.',
  },
  FST_ERR_BAD_URL: {
    code: 'BAD_REQUEST',
    detail:
      'Adres żądania zawiera nieprawidłowe kodowanie znaków (np. % bez dwóch cyfr szesnastkowych).',
  },
  FST_ERR_MAX_PARAM_LENGTH: {
    code: 'BAD_REQUEST',
    detail: 'Parametr w adresie żądania jest za długi.',
  },
};

interface FastifyErrorLike extends Error {
  readonly code: string;
  readonly statusCode?: number;
}

/** Błąd z Fastify (kody FST_*), np. przy parsowaniu treści przed wywołaniem kontrolera. */
function isFastifyError(error: unknown): error is FastifyErrorLike {
  return (
    error instanceof Error &&
    typeof (error as Partial<FastifyErrorLike>).code === 'string' &&
    (error as FastifyErrorLike).code.startsWith('FST_')
  );
}

interface ZodIssueLike {
  readonly path: readonly PropertyKey[];
  readonly code: string;
  readonly message: string;
}

function isZodIssueLike(value: unknown): value is ZodIssueLike {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof ZodIssueLike, unknown>>;
  return (
    Array.isArray(candidate.path) &&
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string'
  );
}

/** Problemy z ZodError (bez zależności od konkretnej klasy błędu Zod). */
function zodIssuesOf(error: unknown): readonly ZodIssueLike[] {
  if (typeof error !== 'object' || error === null || !('issues' in error)) {
    return [];
  }
  const issues: unknown = error.issues;
  return Array.isArray(issues) ? (issues as unknown[]).filter(isZodIssueLike) : [];
}

function toFieldErrors(issues: readonly ZodIssueLike[]): ProblemFieldError[] {
  return issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    code: issue.code,
    message: issue.message,
  }));
}

function debugInfo(exception: unknown): Record<string, unknown> {
  if (exception instanceof Error) {
    return { name: exception.name, message: exception.message, stack: exception.stack };
  }
  return { value: String(exception) };
}

interface ProblemParts {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail?: string;
  readonly errors?: readonly ProblemFieldError[];
  readonly extensions?: Readonly<Record<string, unknown>>;
  readonly debug?: Record<string, unknown>;
}

function build(parts: ProblemParts, context: ProblemContext): ProblemDetails {
  const definition = ERROR_DEFINITIONS[parts.code];
  const extensions = Object.fromEntries(
    Object.entries(parts.extensions ?? {}).filter(([key]) => !RESERVED_FIELDS.has(key)),
  );
  return {
    type: problemTypeUri(parts.code),
    title: definition.title,
    status: parts.status,
    detail: parts.detail ?? definition.detail,
    instance: context.instance,
    code: parts.code,
    requestId: context.requestId,
    ...(parts.errors === undefined ? {} : { errors: parts.errors }),
    ...extensions,
    ...(parts.debug === undefined ? {} : { debug: parts.debug }),
  };
}

function internalError(exception: unknown, context: ProblemContext, status = 500): MappedProblem {
  return {
    problem: build(
      {
        code: 'INTERNAL_ERROR',
        status,
        debug: context.exposeInternals ? debugInfo(exception) : undefined,
      },
      context,
    ),
    unexpected: true,
  };
}

/** Mapuje wyjątek na Problem Details. Nieznane wyjątki to 500 bez szczegółów (poza development). */
export function toProblemDetails(exception: unknown, context: ProblemContext): MappedProblem {
  if (exception instanceof DomainError) {
    if (!isErrorStatus(exception.status)) {
      return internalError(exception, context);
    }
    return {
      problem: build(
        {
          code: exception.code,
          status: exception.status,
          detail: exception.detail,
          extensions: exception.extensions,
        },
        context,
      ),
      unexpected: exception.status >= 500 && exception.code !== 'SERVICE_UNAVAILABLE',
    };
  }

  if (exception instanceof ZodValidationException) {
    return {
      problem: build(
        {
          code: 'VALIDATION_FAILED',
          status: 400,
          errors: toFieldErrors(zodIssuesOf(exception.getZodError())),
        },
        context,
      ),
      unexpected: false,
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status === 503) {
      return {
        problem: build({ code: 'SERVICE_UNAVAILABLE', status }, context),
        unexpected: false,
      };
    }
    if (!isErrorStatus(status)) {
      return internalError(exception, context);
    }
    if (status >= 500) {
      // 5xx z HttpException (np. ZodSerializationException) to błąd po naszej stronie.
      return internalError(exception, context, status);
    }
    return {
      problem: build(
        {
          code: codeForStatus(status),
          status,
          debug: context.exposeInternals ? { message: exception.message } : undefined,
        },
        context,
      ),
      unexpected: false,
    };
  }

  if (isFastifyError(exception)) {
    const status = exception.statusCode ?? 500;
    if (!isErrorStatus(status) || status >= 500) {
      return internalError(exception, context);
    }
    const known = FASTIFY_ERRORS[exception.code];
    return {
      problem: build(
        {
          code: known?.code ?? codeForStatus(status),
          status,
          detail: known?.detail,
          debug: context.exposeInternals
            ? { code: exception.code, message: exception.message }
            : undefined,
        },
        context,
      ),
      unexpected: false,
    };
  }

  return internalError(exception, context);
}

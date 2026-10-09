// Status HTTP, tytuł i domyślny opis dla każdego kodu błędu z @biddy/shared. Record wymusza
// uzupełnienie wpisu, gdy w shared pojawi się nowy kod.
import type { ErrorCode } from '@biddy/shared';

export interface ErrorDefinition {
  readonly status: number;
  readonly title: string;
  readonly detail: string;
}

export const ERROR_DEFINITIONS: Readonly<Record<ErrorCode, ErrorDefinition>> = {
  VALIDATION_FAILED: {
    status: 400,
    title: 'Nieprawidłowe dane',
    detail: 'Żądanie zawiera nieprawidłowe dane. Szczegóły są w polu errors.',
  },
  BAD_REQUEST: {
    status: 400,
    title: 'Nieprawidłowe żądanie',
    detail: 'Żądanie jest nieprawidłowe.',
  },
  UNAUTHORIZED: {
    status: 401,
    title: 'Wymagane logowanie',
    detail: 'Zaloguj się, aby kontynuować.',
  },
  FORBIDDEN: {
    status: 403,
    title: 'Brak uprawnień',
    detail: 'Nie masz uprawnień do tego zasobu.',
  },
  NOT_FOUND: {
    status: 404,
    title: 'Nie znaleziono',
    detail: 'Nie znaleziono zasobu pod tym adresem.',
  },
  METHOD_NOT_ALLOWED: {
    status: 405,
    title: 'Niedozwolona metoda',
    detail: 'Ten adres nie obsługuje użytej metody HTTP.',
  },
  CONFLICT: {
    status: 409,
    title: 'Konflikt',
    detail: 'Operacja jest sprzeczna z aktualnym stanem zasobu. Odśwież dane i spróbuj ponownie.',
  },
  PAYLOAD_TOO_LARGE: {
    status: 413,
    title: 'Za duża treść żądania',
    detail: 'Treść żądania przekracza dopuszczalny rozmiar.',
  },
  UNSUPPORTED_MEDIA_TYPE: {
    status: 415,
    title: 'Nieobsługiwany typ treści',
    detail: 'Nieobsługiwany typ treści żądania. Wyślij dane jako application/json.',
  },
  RATE_LIMITED: {
    status: 429,
    title: 'Za dużo żądań',
    detail: 'Wysłano za dużo żądań. Spróbuj ponownie za chwilę.',
  },
  INTERNAL_ERROR: {
    status: 500,
    title: 'Błąd serwera',
    detail: 'Wystąpił nieoczekiwany błąd serwera. Spróbuj ponownie za chwilę.',
  },
  SERVICE_UNAVAILABLE: {
    status: 503,
    title: 'Usługa niedostępna',
    detail: 'Usługa jest chwilowo niedostępna. Spróbuj ponownie za chwilę.',
  },
};

const CODE_BY_STATUS: ReadonlyMap<number, ErrorCode> = new Map([
  [400, 'BAD_REQUEST'],
  [401, 'UNAUTHORIZED'],
  [403, 'FORBIDDEN'],
  [404, 'NOT_FOUND'],
  [405, 'METHOD_NOT_ALLOWED'],
  [409, 'CONFLICT'],
  [413, 'PAYLOAD_TOO_LARGE'],
  [415, 'UNSUPPORTED_MEDIA_TYPE'],
  [429, 'RATE_LIMITED'],
  [503, 'SERVICE_UNAVAILABLE'],
]);

/** Czy status oznacza błąd (4xx albo 5xx). */
export function isErrorStatus(status: number): boolean {
  return Number.isInteger(status) && status >= 400 && status <= 599;
}

/**
 * Kod dla statusu HTTP bez własnego kodu domenowego (np. HttpException z NestJS). Inne 4xx
 * dostają BAD_REQUEST, inne 5xx INTERNAL_ERROR; status odpowiedzi zostaje oryginalny.
 */
export function codeForStatus(status: number): ErrorCode {
  return CODE_BY_STATUS.get(status) ?? (status < 500 ? 'BAD_REQUEST' : 'INTERNAL_ERROR');
}

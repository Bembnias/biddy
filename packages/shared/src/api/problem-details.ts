// Format błędów API: Problem Details (RFC 9457) z kodem domenowym. Klienci (web, mobile)
// rozpoznają błąd po polu `code`, a nie po treści komunikatu ani samym statusie HTTP.

/** Typ treści odpowiedzi z błędem (RFC 9457 §3). */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Początek adresu URI w polu `type`; dalej jest kod domenowy w kebab-case. */
export const PROBLEM_TYPE_BASE_URI = 'https://biddy.pl/problems/';

/**
 * Kody domenowe błędów zwracanych przez API. Lista jest wspólna dla serwera i klientów,
 * więc nowy kod (np. z modułu aukcji) dopisujemy tutaj.
 */
export const ERROR_CODES = {
  /** Dane wejściowe nie przeszły walidacji; szczegóły w polu `errors`. */
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  /** Żądanie jest niepoprawne (np. treść nie jest poprawnym JSON-em). */
  BAD_REQUEST: 'BAD_REQUEST',
  /** Brak sesji albo sesja wygasła. */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** Użytkownik jest zalogowany, ale nie ma uprawnień do zasobu. */
  FORBIDDEN: 'FORBIDDEN',
  /** Zasób albo trasa nie istnieje. */
  NOT_FOUND: 'NOT_FOUND',
  /**
   * Metoda HTTP nie jest obsługiwana. Uwaga: routing API odpowiada na nieobsługiwaną metodę
   * tak jak na nieznany adres (404 NOT_FOUND); ten kod pojawia się tylko wtedy, gdy zgłosi go
   * kod modułu (np. 405 dla operacji niedostępnej w danym stanie zasobu).
   */
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  /** Stan zasobu nie pozwala na operację (np. równoległa zmiana). */
  CONFLICT: 'CONFLICT',
  /** Treść żądania przekracza limit rozmiaru. */
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  /** Nieobsługiwany nagłówek Content-Type. */
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  /** Przekroczony limit żądań; spróbuj ponownie później. */
  RATE_LIMITED: 'RATE_LIMITED',
  /** Nieoczekiwany błąd serwera. */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  /** Usługa chwilowo niedostępna (np. baza danych nie odpowiada). */
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

/** Znany kod domenowy błędu. */
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Kod błędu w odpowiedzi. Starszy klient może dostać kod, którego jeszcze nie zna (nowszy
 * serwer), więc typ dopuszcza dowolny tekst; nieznany kod obsłuż według statusu HTTP.
 */
export type ProblemCode = ErrorCode | (string & Record<never, never>);

/** Błąd jednego pola w odpowiedzi VALIDATION_FAILED. */
export interface ProblemFieldError {
  /** Ścieżka pola rozdzielona kropkami, np. `address.city` albo `items.0.price` ('' = całość). */
  readonly path: string;
  /** Kod problemu walidacji (kody Zod, np. `invalid_type`, `too_small`). */
  readonly code: string;
  /** Komunikat dla użytkownika (po polsku). */
  readonly message: string;
}

/** Odpowiedź z błędem w formacie Problem Details (RFC 9457) rozszerzona o pola Biddy. */
export interface ProblemDetails {
  /** URI typu problemu: PROBLEM_TYPE_BASE_URI + kod w kebab-case. */
  readonly type: string;
  /** Krótki opis typu problemu, ten sam dla każdego wystąpienia (po polsku). */
  readonly title: string;
  /** Status HTTP odpowiedzi. */
  readonly status: number;
  /** Opis tego konkretnego wystąpienia (po polsku), można go pokazać użytkownikowi. */
  readonly detail: string;
  /** Ścieżka żądania, którego dotyczy błąd (bez parametrów zapytania). */
  readonly instance: string;
  /** Kod domenowy: po nim klient rozpoznaje błąd. */
  readonly code: ProblemCode;
  /** Identyfikator żądania (nagłówek x-request-id), przydatny w zgłoszeniu do supportu. */
  readonly requestId: string;
  /** Błędy pól; tylko przy VALIDATION_FAILED. */
  readonly errors?: readonly ProblemFieldError[];
  /** Dodatkowe pola konkretnego błędu (rozszerzenia RFC 9457 §3.2). */
  readonly [extension: string]: unknown;
}

const ERROR_CODE_VALUES: ReadonlySet<string> = new Set(Object.values(ERROR_CODES));

/** Czy tekst jest znanym kodem błędu. */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && ERROR_CODE_VALUES.has(value);
}

/** URI typu problemu dla kodu, np. NOT_FOUND → https://biddy.pl/problems/not-found. */
export function problemTypeUri(code: string): string {
  return `${PROBLEM_TYPE_BASE_URI}${code.toLowerCase().replaceAll('_', '-')}`;
}

function isFieldError(value: unknown): value is ProblemFieldError {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['path'] === 'string' &&
    typeof candidate['code'] === 'string' &&
    typeof candidate['message'] === 'string'
  );
}

/**
 * Sprawdza, czy wartość (np. sparsowana treść odpowiedzi) jest Problem Details z API Biddy.
 * Nie wymaga znanego kodu: nieznany kod nadal jest poprawnym błędem API.
 */
export function isProblemDetails(value: unknown): value is ProblemDetails {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const errors = candidate['errors'];
  return (
    typeof candidate['type'] === 'string' &&
    typeof candidate['title'] === 'string' &&
    typeof candidate['status'] === 'number' &&
    Number.isInteger(candidate['status']) &&
    typeof candidate['detail'] === 'string' &&
    typeof candidate['instance'] === 'string' &&
    typeof candidate['code'] === 'string' &&
    candidate['code'] !== '' &&
    typeof candidate['requestId'] === 'string' &&
    (errors === undefined || (Array.isArray(errors) && errors.every(isFieldError)))
  );
}

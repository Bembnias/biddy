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
  /** Operacja wymaga potwierdzonego adresu e-mail (licytowanie, wystawianie). */
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  /** Wymagana weryfikacja Turnstile (np. po kilku nieudanych logowaniach). */
  CAPTCHA_REQUIRED: 'CAPTCHA_REQUIRED',
  /** Weryfikacja Turnstile nie powiodła się albo token wygasł. */
  CAPTCHA_FAILED: 'CAPTCHA_FAILED',
  /** Brak akceptacji aktualnego regulaminu albo polityki prywatności (albo oświadczenia 18+). */
  TERMS_NOT_ACCEPTED: 'TERMS_NOT_ACCEPTED',
  /** Operacja wymaga zweryfikowanego numeru telefonu (licytowanie, wystawianie). */
  PHONE_NOT_VERIFIED: 'PHONE_NOT_VERIFIED',
  /** Numer telefonu jest przypisany do innego konta (1 numer = 1 konto). */
  PHONE_NUMBER_TAKEN: 'PHONE_NUMBER_TAKEN',
  /** Nieprawidłowy kod SMS; rozszerzenie `remainingAttempts` podaje liczbę pozostałych prób. */
  PHONE_CODE_INVALID: 'PHONE_CODE_INVALID',
  /** Brak aktywnego kodu SMS (wygasł, wykorzystano próby albo wysłano nowszy). */
  PHONE_CODE_EXPIRED: 'PHONE_CODE_EXPIRED',
  /** Osiągnięto limit zapisanych adresów (F-10). */
  ADDRESS_LIMIT_REACHED: 'ADDRESS_LIMIT_REACHED',
  /** Plik zdjęcia nie dotarł do magazynu przed potwierdzeniem uploadu (F-12). */
  MEDIA_NOT_UPLOADED: 'MEDIA_NOT_UPLOADED',
  /**
   * Sprzedający ma blokadę wystawiania (F-61): `blockedUntil` (null = bezterminowa) i `blockId`
   * w odpowiedzi.
   */
  LISTING_BLOCKED: 'LISTING_BLOCKED',
  /** Osiągnięto limit aktywnych aukcji poziomu sprzedawcy (§4.1, F-14). */
  LISTING_LIMIT_REACHED: 'LISTING_LIMIT_REACHED',
  /** Aukcja ma oferty: zmiana jest zablokowana (§6.6, F-14). */
  AUCTION_HAS_BIDS: 'AUCTION_HAS_BIDS',
  /** Aukcji z ofertami nie można anulować w ostatnich 12 h (§6.6, F-14). */
  AUCTION_CANCEL_TOO_LATE: 'AUCTION_CANCEL_TOO_LATE',
  /** Oferta poniżej minimalnej kolejnej oferty; `minimumBid` (grosze) w odpowiedzi (F-15). */
  BID_TOO_LOW: 'BID_TOO_LOW',
  /** Oferta przekracza limit konta kupującego (§4.1, F-15). */
  BID_LIMIT_EXCEEDED: 'BID_LIMIT_EXCEEDED',
  /**
   * Kupujący ma blokadę licytowania (F-61): `blockedUntil` (null = bezterminowa) i `blockId`
   * w odpowiedzi.
   */
  BIDDING_BLOCKED: 'BIDDING_BLOCKED',
  /** Aukcja się zakończyła albo została anulowana (F-15). */
  AUCTION_ENDED: 'AUCTION_ENDED',
  /** Sprzedający nie może licytować własnej aukcji (§6.6, F-15). */
  OWN_AUCTION: 'OWN_AUCTION',
  /** Kup teraz niedostępne: aukcja ma oferty albo nie ma ceny Kup teraz (F-15). */
  BUY_NOW_UNAVAILABLE: 'BUY_NOW_UNAVAILABLE',
  /** Ten sam Idempotency-Key użyty z innym żądaniem (F-15). */
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  /** Nie ma takiego strike'a albo należy do innego użytkownika (F-61). */
  STRIKE_NOT_FOUND: 'STRIKE_NOT_FOUND',
  /** Nie ma takiej blokady konta albo należy do innego użytkownika (F-61). */
  ACCOUNT_BLOCK_NOT_FOUND: 'ACCOUNT_BLOCK_NOT_FOUND',
  /** Odwołanie niemożliwe: już było, decyzja jest cofnięta albo minął termin (F-61). */
  APPEAL_NOT_ALLOWED: 'APPEAL_NOT_ALLOWED',
  /** Decyzja w odwołaniu, którego nie ma albo które już rozpatrzono (F-61). */
  APPEAL_NOT_PENDING: 'APPEAL_NOT_PENDING',
  /** Usługa dostawy nie pasuje do przedmiotu albo nie ma ceny w cenniku (F-24). */
  SHIPPING_OPTION_UNAVAILABLE: 'SHIPPING_OPTION_UNAVAILABLE',
  /** Paczkomat i punkt odbioru wymagają wskazania punktu (F-24). */
  PICKUP_POINT_REQUIRED: 'PICKUP_POINT_REQUIRED',
  /** Punktu odbioru nie ma u dostawcy (nieaktywny albo zły identyfikator, F-24). */
  PICKUP_POINT_NOT_FOUND: 'PICKUP_POINT_NOT_FOUND',
  /** Kurier wymaga adresu dostawy (F-24). */
  DELIVERY_ADDRESS_REQUIRED: 'DELIVERY_ADDRESS_REQUIRED',
  /** Sposób nadania niedostępny dla tej usługi albo dostawcy (F-24). */
  DISPATCH_METHOD_UNAVAILABLE: 'DISPATCH_METHOD_UNAVAILABLE',
  /** Zamówienie nie czeka na nadanie: nieopłacone albo bez wybranej dostawy (F-24). */
  ORDER_NOT_AWAITING_SHIPMENT: 'ORDER_NOT_AWAITING_SHIPMENT',
  /** Przesyłka jest już nadawana albo nadana, więc dostawy nie można zmienić (F-24). */
  SHIPMENT_ALREADY_DISPATCHED: 'SHIPMENT_ALREADY_DISPATCHED',
  /** Zamówienie nie czeka na płatność: już opłacone albo anulowane (F-25). */
  ORDER_NOT_AWAITING_PAYMENT: 'ORDER_NOT_AWAITING_PAYMENT',
  /** Termin płatności minął: nowa płatność i zmiana dostawy niemożliwe (F-25). */
  PAYMENT_DEADLINE_PASSED: 'PAYMENT_DEADLINE_PASSED',
  /** Płatność zamówienia jest w toku albo już udana (F-25). */
  PAYMENT_IN_PROGRESS: 'PAYMENT_IN_PROGRESS',
  /** Przed płatnością trzeba wybrać dostawę (F-25). */
  DELIVERY_REQUIRED: 'DELIVERY_REQUIRED',
  /** Suma widziana przez kupującego różni się od sumy zamówienia (F-25). */
  CHECKOUT_TOTAL_CHANGED: 'CHECKOUT_TOTAL_CHANGED',
  /** Sprzedający nie może przyjąć płatności (konto zablokowane albo bez e-maila, F-25). */
  SELLER_UNAVAILABLE: 'SELLER_UNAVAILABLE',
  /** Zamówienie nie jest odebrane, więc nie da się potwierdzić odbioru (F-26). */
  ORDER_NOT_DELIVERED: 'ORDER_NOT_DELIVERED',
  /** Zamówienie wstrzymane do wyjaśnienia chargebacku (F-26). */
  ORDER_ON_HOLD: 'ORDER_ON_HOLD',
  /** Paczka nie została jeszcze nadana (F-26). */
  ORDER_NOT_SHIPPED_YET: 'ORDER_NOT_SHIPPED_YET',
  /** Brak paczki można zgłosić dopiero 14 dni po nadaniu (F-26). */
  NOT_RECEIVED_TOO_EARLY: 'NOT_RECEIVED_TOO_EARLY',
  /** Przesyłka jest już doręczona albo zwrócona, albo zamówienie nie czeka na paczkę (F-26). */
  SHIPMENT_FINISHED: 'SHIPMENT_FINISHED',
  /** Oferty drugiej szansy nie da się teraz wysłać (przyczyna w `reason`, F-26). */
  SECOND_CHANCE_UNAVAILABLE: 'SECOND_CHANCE_UNAVAILABLE',
  /** Oferta drugiej szansy jest już przyjęta, odrzucona albo wygasła (F-26). */
  SECOND_CHANCE_CLOSED: 'SECOND_CHANCE_CLOSED',
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

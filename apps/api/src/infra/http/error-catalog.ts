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
  EMAIL_NOT_VERIFIED: {
    status: 403,
    title: 'Niepotwierdzony e-mail',
    detail: 'Potwierdź adres e-mail linkiem z wiadomości, aby kontynuować.',
  },
  CAPTCHA_REQUIRED: {
    status: 403,
    title: 'Wymagana weryfikacja',
    detail: 'Potwierdź, że nie jesteś robotem, i spróbuj ponownie.',
  },
  CAPTCHA_FAILED: {
    status: 403,
    title: 'Weryfikacja nieudana',
    detail: 'Weryfikacja nie powiodła się albo wygasła. Spróbuj ponownie.',
  },
  TERMS_NOT_ACCEPTED: {
    status: 400,
    title: 'Brak akceptacji regulaminu',
    detail: 'Zaakceptuj regulamin i politykę prywatności, aby kontynuować.',
  },
  PHONE_NOT_VERIFIED: {
    status: 403,
    title: 'Niezweryfikowany telefon',
    detail: 'Zweryfikuj numer telefonu, żeby licytować i wystawiać przedmioty.',
  },
  PHONE_NUMBER_TAKEN: {
    status: 409,
    title: 'Numer zajęty',
    detail:
      'Ten numer telefonu jest przypisany do innego konta. Jeden numer może mieć tylko jedno konto.',
  },
  PHONE_CODE_INVALID: {
    status: 400,
    title: 'Nieprawidłowy kod',
    detail: 'Nieprawidłowy kod z SMS-a.',
  },
  PHONE_CODE_EXPIRED: {
    status: 400,
    title: 'Kod nieaktywny',
    detail: 'Kod wygasł albo wykorzystano limit prób. Wyślij nowy kod.',
  },
  ADDRESS_LIMIT_REACHED: {
    status: 409,
    title: 'Limit adresów',
    detail: 'Możesz zapisać najwyżej 10 adresów. Usuń adres, którego nie używasz.',
  },
  MEDIA_NOT_UPLOADED: {
    status: 409,
    title: 'Brak pliku',
    detail: 'Plik nie dotarł do magazynu. Wyślij zdjęcie ponownie.',
  },
  LISTING_BLOCKED: {
    status: 403,
    title: 'Blokada wystawiania',
    detail: 'Masz czasową blokadę wystawiania aukcji. Szczegóły i odwołanie znajdziesz w koncie.',
  },
  LISTING_LIMIT_REACHED: {
    status: 409,
    title: 'Limit aktywnych aukcji',
    detail: 'Osiągnięto limit aktywnych aukcji. Poczekaj, aż któraś się zakończy.',
  },
  AUCTION_HAS_BIDS: {
    status: 409,
    title: 'Aukcja ma oferty',
    detail: 'Po pierwszej ofercie nie można zmieniać aukcji.',
  },
  AUCTION_CANCEL_TOO_LATE: {
    status: 409,
    title: 'Za późno na anulowanie',
    detail: 'Aukcji z ofertami nie można anulować w ostatnich 12 godzinach.',
  },
  BID_TOO_LOW: {
    status: 409,
    title: 'Za niska oferta',
    detail: 'Oferta jest niższa niż minimalna kolejna oferta.',
  },
  BID_LIMIT_EXCEEDED: {
    status: 403,
    title: 'Limit konta',
    detail: 'Oferta przekracza limit Twojego konta. Limit rośnie po opłaconych zamówieniach.',
  },
  BIDDING_BLOCKED: {
    status: 403,
    title: 'Blokada licytowania',
    detail: 'Masz czasową blokadę licytowania. Szczegóły i odwołanie znajdziesz w koncie.',
  },
  AUCTION_ENDED: {
    status: 409,
    title: 'Aukcja zakończona',
    detail: 'Aukcja już się zakończyła.',
  },
  OWN_AUCTION: {
    status: 403,
    title: 'Własna aukcja',
    detail: 'Nie możesz licytować własnej aukcji.',
  },
  BUY_NOW_UNAVAILABLE: {
    status: 409,
    title: 'Kup teraz niedostępne',
    detail: 'Kup teraz jest niedostępne: aukcja ma już oferty.',
  },
  IDEMPOTENCY_KEY_REUSED: {
    status: 422,
    title: 'Klucz już użyty',
    detail: 'Ten klucz Idempotency-Key został użyty w innym żądaniu. Wygeneruj nowy klucz.',
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

// Imię wyświetlane (F-10): reguły wspólne dla formularzy web i API (rejestracja, PATCH /v1/me).
// Imię jest publiczne (profil, oferty, wiadomości), więc nie może zawierać danych kontaktowych:
// kontakt poza platformą to główna droga oszustw (PROJECT.md §16.2).

export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 60;

/** Powód odrzucenia imienia; komunikat po polsku daje {@link DISPLAY_NAME_MESSAGES}. */
export type DisplayNameIssue = 'length' | 'characters' | 'contact';

export const DISPLAY_NAME_MESSAGES: Readonly<Record<DisplayNameIssue, string>> = {
  length: `Imię wyświetlane musi mieć od ${DISPLAY_NAME_MIN_LENGTH} do ${DISPLAY_NAME_MAX_LENGTH} znaków.`,
  characters:
    'Imię wyświetlane może zawierać litery, cyfry, spacje, kropkę, myślnik, podkreślnik i apostrof.',
  contact: 'Imię wyświetlane nie może zawierać numeru telefonu ani adresu strony.',
};

const ALLOWED = /^[\p{L}\p{M}\p{N} .'’_-]+$/u;
/** Adres strony: www., http(s) albo domena z popularną końcówką (np. „sklep.pl”). */
const WEBSITE = /(^|[\s.])(www|https?)\b|\.(pl|com|eu|net|org|info|shop|online)\b/iu;
/** 6 cyfr i więcej (także rozdzielonych spacjami) wygląda na numer telefonu albo konta. */
const MAX_DIGITS = 5;

/** Imię po przycięciu i zamianie ciągów białych znaków na pojedyncze spacje. */
export function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

/** Powód odrzucenia imienia (po normalizacji) albo `undefined`, gdy imię jest poprawne. */
export function displayNameIssue(value: string): DisplayNameIssue | undefined {
  const name = normalizeDisplayName(value);
  const length = [...name].length;
  if (length < DISPLAY_NAME_MIN_LENGTH || length > DISPLAY_NAME_MAX_LENGTH) {
    return 'length';
  }
  if (!ALLOWED.test(name)) {
    return 'characters';
  }
  if (WEBSITE.test(name) || (name.match(/\p{N}/gu) ?? []).length > MAX_DIGITS) {
    return 'contact';
  }
  return undefined;
}

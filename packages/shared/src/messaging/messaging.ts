// Wiadomości (F-29, PROJECT.md §16.2): limity, powody zgłoszeń i wykrywanie danych kontaktowych.
// Wspólne dla API (flaga na wiadomości, walidacja, limity) i klientów (podpowiedź przed wysłaniem).

/** Rodzaj danych kontaktowych wykrytych w treści wiadomości. */
export const CONTACT_FLAGS = ['PHONE', 'EMAIL', 'IBAN'] as const;
export type ContactFlag = (typeof CONTACT_FLAGS)[number];

/** Limity wiadomości: długość treści, zdjęcia i tempo wysyłki na nadawcę (decyzja nr 140). */
export const MESSAGE_LIMITS = {
  bodyMax: 2000,
  photos: 5,
  perMinute: 10,
  perDay: 200,
  newConversationsPerDay: 20,
} as const;

/** Po tylu minutach bez odczytu odbiorca dostaje powiadomienie o wiadomości (decyzja nr 138). */
export const MESSAGE_NOTIFY_DELAY_MINUTES = 5;

/** Powód zgłoszenia rozmowy albo wiadomości (F-29; kolejka i decyzje w F-35). */
export const REPORT_REASONS = ['OFF_PLATFORM', 'SCAM', 'ABUSE', 'SPAM', 'OTHER'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Opis zgłoszenia: najwyżej `max` znaków, przy `OTHER` co najmniej `minForOther`. */
export const REPORT_DETAILS_LIMITS = { minForOther: 10, max: 1000 } as const;

/**
 * Ciąg cyfr z separatorami między grupami (spacja, kropka, kreska, ukośnik, nawiasy), opcjonalnie
 * z `+` na początku. Bez nowej linii: liczby z różnych wierszy to osobne ciągi.
 */
const DIGIT_RUN = /\+?\d+(?:[ \t\u00a0\u200b().\-\u2013/]{1,2}\d+)*/gu;

const AT = String.raw`(?:\s*@\s*|\s*[([{]\s*(?:at|małpa|malpa)\s*[)\]}]\s*|\s+(?:at|małpa|malpa)\s+)`;
const DOT = String.raw`(?:\.|\s*[([{]\s*(?:dot|kropka)\s*[)\]}]\s*|\s+(?:dot|kropka)\s+)`;
/** Adres e-mail, także zapisany „jan małpa wp kropka pl” albo „jan (at) wp (dot) pl”. */
const EMAIL = new RegExp(
  String.raw`[\p{L}\p{N}._%+-]+${AT}[\p{L}\p{N}-]+(?:${DOT}[\p{L}\p{N}-]+)*${DOT}\p{L}{2,24}(?![\p{L}\p{N}])`,
  'iu',
);

/** IBAN z kodem kraju (wielkie litery), w grupach albo ciągiem; sprawdzany sumą mod 97. */
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/gu;

/** Najdłuższy fragment ciągu cyfr, który sprawdzamy (NRB ma 26 cyfr). */
const MAX_WINDOW_DIGITS = 26;

/**
 * Dane kontaktowe w treści (F-29): numer telefonu, adres e-mail albo numer konta. Wynik służy do
 * ostrzeżenia i flagi, nie do blokady, więc reguły wolą fałszywy alarm niż przeoczenie typowego
 * zapisu. Ceny, daty, kody pocztowe i numery przesyłek (24 cyfry) nie pasują.
 */
export function detectContactData(text: string): ContactFlag[] {
  const flags = new Set<ContactFlag>();
  for (const match of text.matchAll(DIGIT_RUN)) {
    const run = match[0];
    const groups = run.match(/\d+/gu) ?? [];
    if (hasPhone(run.startsWith('+'), groups)) {
      flags.add('PHONE');
    }
    if (windows(groups).some((digits) => digits.length === 26)) {
      flags.add('IBAN');
    }
  }
  if (EMAIL.test(text)) {
    flags.add('EMAIL');
  }
  for (const match of text.matchAll(IBAN)) {
    if (validIban(match[0].replaceAll(' ', ''))) {
      flags.add('IBAN');
    }
  }
  return CONTACT_FLAGS.filter((flag) => flags.has(flag));
}

/**
 * Numer telefonu: kolejne grupy cyfr dające 9 cyfr (bez zera na początku), 11 z prefiksem 48
 * albo 13 z 0048; z `+` także dowolny numer międzynarodowy (10–15 cyfr).
 */
function hasPhone(international: boolean, groups: readonly string[]): boolean {
  const total = groups.reduce((sum, group) => sum + group.length, 0);
  if (international && total >= 10 && total <= 15) {
    return true;
  }
  return windows(groups).some(
    (digits) =>
      (digits.length === 9 && !digits.startsWith('0')) ||
      (digits.length === 11 && digits.startsWith('48')) ||
      (digits.length === 13 && digits.startsWith('0048')),
  );
}

/** Ciągi cyfr z kolejnych grup (najwyżej 26 cyfr): „22 123 45 67” daje m.in. „221234567”. */
function windows(groups: readonly string[]): string[] {
  const result: string[] = [];
  for (let start = 0; start < groups.length; start += 1) {
    let digits = '';
    for (let end = start; end < groups.length; end += 1) {
      digits += groups[end] ?? '';
      if (digits.length > MAX_WINDOW_DIGITS) {
        break;
      }
      result.push(digits);
    }
  }
  return result;
}

/** Suma kontrolna IBAN (ISO 13616): kraj i cyfry kontrolne na koniec, litery na liczby, mod 97 = 1. */
function validIban(iban: string): boolean {
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const char of rearranged) {
    const value = /\d/u.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of value) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

// Rachunek do wypłat (F-27): w MVP tylko polski IBAN (`PL` + 26 cyfr) z sumą kontrolną mod 97.
// Pole przyjmuje numer ze spacjami i bez prefiksu `PL` (tak, jak pokazuje go bank).

export const IBAN_MESSAGE =
  'Podaj polski numer rachunku: 26 cyfr, np. PL61 1090 1014 0000 0712 1981 2874.';

const POLISH_IBAN = /^PL\d{26}$/u;

/** IBAN bez spacji z prefiksem `PL` albo `undefined`, gdy to nie jest poprawny polski rachunek. */
export function normalizeIban(value: string): string | undefined {
  const compact = value.replace(/[\s-]/gu, '').toUpperCase();
  const iban = /^\d{26}$/u.test(compact) ? `PL${compact}` : compact;
  return POLISH_IBAN.test(iban) && ibanChecksumValid(iban) ? iban : undefined;
}

/** Suma kontrolna IBAN (ISO 13616): przestawione 4 znaki i litery jako liczby, reszta mod 97 = 1. */
function ibanChecksumValid(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const digits = /\d/u.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

/** Zapis w grupach po 4 znaki, np. `PL61 1090 1014 0000 0712 1981 2874`. */
export function formatIban(iban: string): string {
  return iban.replace(/(.{4})(?=.)/gu, '$1 ');
}

/** Wersja do wyświetlania bez pełnego numeru: ostatnie 4 cyfry, np. `•••• 2874`. */
export function maskIban(iban: string): string {
  return `•••• ${iban.slice(-4)}`;
}

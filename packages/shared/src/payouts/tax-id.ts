// Identyfikator podatkowy sprzedającego do DAC7 (F-27, PROJECT.md §17): PESEL osoby prywatnej
// albo NIP osoby z działalnością. Sprawdzamy sumy kontrolne i zgodność PESEL z datą urodzenia;
// weryfikacja w rejestrach to osobny krok (raport DAC7, v1).

export const TAX_ID_KINDS = ['PESEL', 'NIP'] as const;
export type TaxIdKind = (typeof TAX_ID_KINDS)[number];

export const TAX_ID_MESSAGES = {
  PESEL: 'Podaj poprawny numer PESEL (11 cyfr).',
  NIP: 'Podaj poprawny NIP (10 cyfr).',
  PESEL_BIRTH_DATE: 'Data urodzenia nie zgadza się z numerem PESEL.',
} as const;

const PESEL_WEIGHTS = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3] as const;
const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7] as const;

/** Przesunięcie miesiąca w PESEL dla stulecia: 1800 → +80, 1900 → 0, 2000 → +20… */
const PESEL_CENTURIES = [
  { offset: 80, century: 1800 },
  { offset: 0, century: 1900 },
  { offset: 20, century: 2000 },
  { offset: 40, century: 2100 },
  { offset: 60, century: 2200 },
] as const;

function digitsOf(value: string): number[] {
  return [...value].map(Number);
}

/** Cyfry bez spacji i myślników. */
export function normalizeTaxId(value: string): string {
  return value.replace(/[\s-]/gu, '');
}

/** Data urodzenia `RRRR-MM-DD` zapisana w PESEL albo `undefined` (zły numer albo data). */
export function peselBirthDate(pesel: string): string | undefined {
  if (!/^\d{11}$/u.test(pesel)) {
    return undefined;
  }
  const digits = digitsOf(pesel);
  const sum = PESEL_WEIGHTS.reduce((total, weight, index) => total + weight * digits[index]!, 0);
  if ((10 - (sum % 10)) % 10 !== digits[10]) {
    return undefined;
  }
  const encodedMonth = Number(pesel.slice(2, 4));
  const entry = PESEL_CENTURIES.find(
    ({ offset }) => encodedMonth > offset && encodedMonth <= offset + 12,
  );
  if (entry === undefined) {
    return undefined;
  }
  const year = entry.century + Number(pesel.slice(0, 2));
  const month = encodedMonth - entry.offset;
  const day = Number(pesel.slice(4, 6));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  return date.toISOString().slice(0, 10);
}

export function isValidPesel(value: string): boolean {
  return peselBirthDate(value) !== undefined;
}

export function isValidNip(value: string): boolean {
  if (!/^\d{10}$/u.test(value)) {
    return false;
  }
  const digits = digitsOf(value);
  const control =
    NIP_WEIGHTS.reduce((total, weight, index) => total + weight * digits[index]!, 0) % 11;
  return control !== 10 && control === digits[9];
}

/** Identyfikator bez większości cyfr, np. `•••••••0123` (PESEL) albo `••••••0274` (NIP). */
export function maskTaxId(value: string): string {
  return `${'•'.repeat(Math.max(value.length - 4, 0))}${value.slice(-4)}`;
}

// Numery telefonów (F-08): tylko polskie numery komórkowe, zapis w E.164. Ograniczenie do
// Polski chroni też przed nadużyciem SMS-ów na drogie numery zagraniczne (SMS pumping).
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

/** Kraje, na których numery wysyłamy kody (MVP: Polska). */
export const PHONE_COUNTRIES: readonly string[] = ['PL'];

export const PHONE_NUMBER_HINT = 'Podaj polski numer komórkowy, np. 500 600 700.';

/**
 * Numer komórkowy w E.164 (np. `+48500600700`) albo `undefined`, gdy wejście nie jest
 * polskim numerem komórkowym. Przyjmuje spacje, myślniki, nawiasy, `+48` i `0048`.
 */
export function normalizePhoneNumber(input: string): string | undefined {
  const parsed = parsePhoneNumberFromString(input.trim(), 'PL');
  if (parsed === undefined || !parsed.isValid()) {
    return undefined;
  }
  if (parsed.country === undefined || !PHONE_COUNTRIES.includes(parsed.country)) {
    return undefined;
  }
  const type = parsed.getType();
  return type === 'MOBILE' || type === 'FIXED_LINE_OR_MOBILE' ? parsed.number : undefined;
}

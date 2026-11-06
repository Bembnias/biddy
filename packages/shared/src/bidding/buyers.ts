// Kupujący (F-15, PROJECT.md §4.1, §14.2): poziomy kupującego i zanonimizowane imię w historii ofert.

/** Poziom kupującego (§4.1); limity i liczenie z historii zamówień w `account/account-policy.ts` (F-61). */
export const BUYER_LEVELS = ['NEW', 'CHECKED', 'TRUSTED'] as const;
export type BuyerLevel = (typeof BUYER_LEVELS)[number];

/**
 * Zanonimizowane imię licytującego, np. „Kasia Kupująca” → „k***a”: pierwsza i ostatnia litera
 * imienia wyświetlanego (małe litery). Bez liter: „***”.
 */
export function anonymizeName(name: string): string {
  const letters = [...name.toLocaleLowerCase('pl-PL')].filter((char) => /\p{L}|\p{N}/u.test(char));
  const first = letters[0];
  const last = letters.at(-1);
  if (first === undefined || last === undefined) {
    return '***';
  }
  return letters.length === 1 ? `${first}***` : `${first}***${last}`;
}

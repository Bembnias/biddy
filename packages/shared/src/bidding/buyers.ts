// Kupujący (F-15, PROJECT.md §4.1, §14.2): limity poziomów i zanonimizowane imię w historii ofert.

/** Poziom kupującego. Liczenie z historii zamówień i nadpisania to F-61. */
export const BUYER_LEVELS = ['NEW', 'CHECKED', 'TRUSTED'] as const;
export type BuyerLevel = (typeof BUYER_LEVELS)[number];

export interface BuyerLevelLimits {
  /** Maks. kwota oferty (maksimum licytacji automatycznej) w groszach albo null (bez limitu). */
  readonly maxBidAmount: number | null;
  /** Maks. liczba aukcji z aktywną ofertą albo null (bez limitu). */
  readonly maxActiveAuctions: number | null;
}

/** Wartości startowe limitów kupującego z §4.1. */
export const BUYER_LIMITS: Readonly<Record<BuyerLevel, BuyerLevelLimits>> = {
  NEW: { maxBidAmount: 50_000, maxActiveAuctions: 10 },
  CHECKED: { maxBidAmount: 300_000, maxActiveAuctions: 50 },
  TRUSTED: { maxBidAmount: null, maxActiveAuctions: null },
};

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

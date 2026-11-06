// Zasady wypłat (F-27, PROJECT.md §7.6 decyzja 4): minimum na żądanie i przy wypłacie tygodniowej,
// blokada po zmianie rachunku i próg salda „uśpionego”, które wypłacamy bez minimum.

/** Minimalna wypłata na żądanie i tygodniowa: 20 zł w groszach. */
export const PAYOUT_MINIMUM = 2_000;

/** Blokada wypłat po zmianie rachunku (§16.1). */
export const PAYOUT_ACCOUNT_CHANGE_HOLD_HOURS = 48;

/** Saldo poniżej minimum wypłacamy automatycznie po tylu dniach bez sprzedaży. */
export const DORMANT_BALANCE_DAYS = 90;

/** Najmłodszy sprzedający z wypłatami (regulamin: 18+). */
export const PAYOUT_MIN_AGE_YEARS = 18;

/** Skąd wzięła się wypłata: na żądanie, tygodniowa, saldo uśpione, zamknięcie konta. */
export const PAYOUT_TRIGGERS = ['MANUAL', 'WEEKLY', 'DORMANT_BALANCE', 'ACCOUNT_CLOSURE'] as const;
export type PayoutTrigger = (typeof PAYOUT_TRIGGERS)[number];

/** Stan wypłaty: zlecona (czeka na operatora), wysłana, nieudana (środki wróciły na saldo). */
export const PAYOUT_STATUSES = ['PENDING', 'PAID', 'FAILED'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/**
 * Wiek w pełnych latach w dniu `today` (obie daty `RRRR-MM-DD`), np. do sprawdzenia 18+.
 * Urodzeni 29 lutego kończą lata 1 marca w latach nieprzestępnych.
 */
export function ageInYears(birthDate: string, today: string): number {
  const [birthYear, birthMonthDay] = [Number(birthDate.slice(0, 4)), birthDate.slice(5)];
  const [year, monthDay] = [Number(today.slice(0, 4)), today.slice(5)];
  return year - birthYear - (monthDay < birthMonthDay ? 1 : 0);
}

// Reguły wypłat (F-27, PROJECT.md §7.6, §16.1): co blokuje wypłatę i w jakiej kolejności, klucze
// wypłat automatycznych. Czyste funkcje bez bazy: PayoutService zbiera fakty pod blokadą profilu,
// a widok salda pokazuje ten sam powód, zanim sprzedający kliknie „Wypłać”.
import {
  addCalendarDays,
  type IsoDate,
  isoDateToParts,
  isoDayOfWeek,
  PAYOUT_MINIMUM,
  type PayoutTrigger,
} from '@biddy/shared';

import type { SellerStatus } from '../domain/payment-values.js';

export interface PayoutFacts {
  /** Dane osobowe i rachunek zapisane. */
  readonly profileComplete: boolean;
  /** Koniec blokady po zmianie rachunku. */
  readonly holdUntil: Date | null;
  /** Aktywna blokada wypłat z F-61 (`until` null = bezterminowa). */
  readonly block: { readonly id: string; readonly until: Date | null } | undefined;
  /** Status konta u operatora; undefined, gdy sprzedający nie ma konta. */
  readonly kycStatus: SellerStatus | undefined;
  /** Salda w groszach. */
  readonly available: number;
  readonly receivable: number;
  /** Kwota wypłaty w groszach (domyślnie całe saldo dostępne). */
  readonly amount: number;
  readonly trigger: PayoutTrigger;
  readonly now: Date;
}

/** Powód, dla którego wypłaty nie da się teraz zlecić (kod błędu API i dane do komunikatu). */
export type PayoutBlocker =
  | {
      readonly code: 'PAYOUTS_BLOCKED';
      readonly until: Date | null;
      readonly blockId: string;
    }
  | { readonly code: 'PAYOUT_PROFILE_INCOMPLETE' }
  | { readonly code: 'PAYOUTS_ON_HOLD'; readonly until: Date }
  | { readonly code: 'RECEIVABLE_OUTSTANDING'; readonly receivable: number }
  | { readonly code: 'SELLER_NOT_VERIFIED' }
  | { readonly code: 'INSUFFICIENT_BALANCE'; readonly available: number }
  | { readonly code: 'PAYOUT_BELOW_MINIMUM'; readonly minimum: number };

/** Wypłaty z minimum 20 zł; saldo uśpione i zamknięcie konta wypłacają całość bez minimum. */
const WITH_MINIMUM: ReadonlySet<PayoutTrigger> = new Set(['MANUAL', 'WEEKLY']);

/**
 * Pierwszy powód blokady wypłaty albo undefined. Kolejność: najpierw blokady, których
 * sprzedający nie zmieni sam (F-61), potem braki do uzupełnienia, na końcu kwota.
 */
export function payoutBlocker(facts: PayoutFacts): PayoutBlocker | undefined {
  if (facts.block !== undefined) {
    return { code: 'PAYOUTS_BLOCKED', until: facts.block.until, blockId: facts.block.id };
  }
  if (!facts.profileComplete) {
    return { code: 'PAYOUT_PROFILE_INCOMPLETE' };
  }
  if (facts.holdUntil !== null && facts.holdUntil > facts.now) {
    return { code: 'PAYOUTS_ON_HOLD', until: facts.holdUntil };
  }
  if (facts.receivable > 0) {
    return { code: 'RECEIVABLE_OUTSTANDING', receivable: facts.receivable };
  }
  if (facts.amount <= 0 || facts.amount > facts.available) {
    return { code: 'INSUFFICIENT_BALANCE', available: facts.available };
  }
  if (WITH_MINIMUM.has(facts.trigger) && facts.amount < PAYOUT_MINIMUM) {
    return { code: 'PAYOUT_BELOW_MINIMUM', minimum: PAYOUT_MINIMUM };
  }
  if (facts.kycStatus !== 'VERIFIED') {
    return { code: 'SELLER_NOT_VERIFIED' };
  }
  return undefined;
}

/** Tydzień ISO 8601 daty, np. `2026-W45` (klucz wypłaty tygodniowej). */
export function isoWeekKey(date: IsoDate): string {
  // Tydzień należy do roku, w którym wypada jego czwartek.
  const thursday = addCalendarDays(date, 4 - isoDayOfWeek(date));
  const { year } = isoDateToParts(thursday);
  const firstThursday = addCalendarDays(
    `${year}-01-04` as IsoDate,
    4 - isoDayOfWeek(`${year}-01-04` as IsoDate),
  );
  const week = Math.round(daysBetween(firstThursday, thursday) / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function daysBetween(from: IsoDate, to: IsoDate): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

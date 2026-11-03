// Błędy zlecenia wypłaty (F-27): powód z payoutBlocker jako DomainError z komunikatem po polsku
// i danymi do UI (`blockedUntil`, `blockId`, kwoty w groszach).
import { formatMoney, money } from '@biddy/shared';

import { DomainError } from '../../../infra/http/index.js';
import type { PayoutBlocker } from './payout-rules.js';

const dateTime = new Intl.DateTimeFormat('pl-PL', {
  timeZone: 'Europe/Warsaw',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

export function payoutError(blocker: PayoutBlocker): DomainError {
  switch (blocker.code) {
    case 'PAYOUTS_BLOCKED':
      return new DomainError({
        code: 'PAYOUTS_BLOCKED',
        detail: `Masz ${
          blocker.until === null
            ? 'bezterminową blokadę'
            : `blokadę do ${dateTime.format(blocker.until)}`
        } wypłat. Uzasadnienie i odwołanie znajdziesz w ustawieniach konta, w sekcji „Limity i strike'i”.`,
        extensions: {
          blockedUntil: blocker.until?.toISOString() ?? null,
          blockId: blocker.blockId,
        },
      });
    case 'PAYOUT_PROFILE_INCOMPLETE':
      return new DomainError({ code: 'PAYOUT_PROFILE_INCOMPLETE' });
    case 'PAYOUTS_ON_HOLD':
      return new DomainError({
        code: 'PAYOUTS_ON_HOLD',
        detail: `Po zmianie rachunku wypłaty ruszą ${dateTime.format(blocker.until)}.`,
        extensions: { blockedUntil: blocker.until.toISOString() },
      });
    case 'RECEIVABLE_OUTSTANDING':
      return new DomainError({
        code: 'RECEIVABLE_OUTSTANDING',
        detail: `Masz ${formatMoney(money(blocker.receivable))} do spłaty. Spłacimy to z kolejnych sprzedaży, a potem wypłaty ruszą.`,
        extensions: { receivable: blocker.receivable },
      });
    case 'SELLER_NOT_VERIFIED':
      return new DomainError({ code: 'SELLER_NOT_VERIFIED' });
    case 'INSUFFICIENT_BALANCE':
      return new DomainError({
        code: 'INSUFFICIENT_BALANCE',
        detail:
          blocker.available === 0
            ? 'Nie masz jeszcze środków do wypłaty.'
            : `Możesz wypłacić najwyżej ${formatMoney(money(blocker.available))}.`,
        extensions: { available: blocker.available },
      });
    case 'PAYOUT_BELOW_MINIMUM':
      return new DomainError({
        code: 'PAYOUT_BELOW_MINIMUM',
        detail: `Minimalna wypłata to ${formatMoney(money(blocker.minimum))}.`,
        extensions: { minimum: blocker.minimum },
      });
  }
}

// Błąd guarda przy aktywnej blokadzie (F-61): licytowanie (F-15) i wystawianie (F-14). Ten sam
// kształt odpowiedzi w obu miejscach: `blockedUntil` (null = bezterminowa) i `blockId`.
import { DomainError } from '../../../infra/http/index.js';
import type { ActiveBlock } from './account-block.service.js';
import { formatWarsawDateTime } from './statements.js';

const SUBJECT = {
  BIDDING_BLOCKED: 'licytowania',
  LISTING_BLOCKED: 'wystawiania aukcji',
} as const;

export function accountBlockedError(code: keyof typeof SUBJECT, block: ActiveBlock): DomainError {
  const period =
    block.until === null
      ? 'bezterminową blokadę'
      : `blokadę do ${formatWarsawDateTime(block.until)}`;
  return new DomainError({
    code,
    detail: `Masz ${period} ${SUBJECT[code]}. Uzasadnienie i odwołanie znajdziesz w ustawieniach konta, w sekcji „Limity i strike'i”.`,
    extensions: { blockedUntil: block.until?.toISOString() ?? null, blockId: block.id },
  });
}

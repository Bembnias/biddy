// Strike'i i blokady kont (F-61, PROJECT.md §4.1): powody, role, rodzaje blokad i stany odwołań.
// Wspólne dla API (zapis, walidacja) i klientów (etykiety, ikony).

/** Rola, w której użytkownik dostaje strike. */
export const STRIKE_ROLES = ['BUYER', 'SELLER'] as const;
export type StrikeRole = (typeof STRIKE_ROLES)[number];

/**
 * Powód strike'a. `UNPAID`, `NOT_COLLECTED` i `AUCTION_CANCELLED_WITH_BIDS` nadaje system od F-61,
 * `NOT_SHIPPED` F-26, `DISPUTE_LOST` F-28; `COUNTERFEIT` i `OTHER` personel.
 */
export const STRIKE_REASONS = [
  'UNPAID',
  'NOT_COLLECTED',
  'NOT_SHIPPED',
  'AUCTION_CANCELLED_WITH_BIDS',
  'DISPUTE_LOST',
  'COUNTERFEIT',
  'OTHER',
] as const;
export type StrikeReason = (typeof STRIKE_REASONS)[number];

/** Powody, które personel może nadać ręcznie. */
export const STAFF_STRIKE_REASONS = ['COUNTERFEIT', 'OTHER'] as const satisfies StrikeReason[];
export type StaffStrikeReason = (typeof STAFF_STRIKE_REASONS)[number];

const ROLE_BY_REASON: Readonly<Record<Exclude<StrikeReason, 'OTHER'>, StrikeRole>> = {
  UNPAID: 'BUYER',
  NOT_COLLECTED: 'BUYER',
  NOT_SHIPPED: 'SELLER',
  AUCTION_CANCELLED_WITH_BIDS: 'SELLER',
  DISPUTE_LOST: 'SELLER',
  COUNTERFEIT: 'SELLER',
};

/** Rola wynikająca z powodu; przy `OTHER` personel wskazuje ją sam (`fallback`). */
export function strikeRoleOf(reason: StrikeReason, fallback: StrikeRole = 'BUYER'): StrikeRole {
  return reason === 'OTHER' ? fallback : ROLE_BY_REASON[reason];
}

/** Rodzaj blokady: licytowanie (kupujący), wystawianie i wypłaty (sprzedający). */
export const ACCOUNT_BLOCK_KINDS = ['BIDDING', 'LISTING', 'PAYOUTS'] as const;
export type AccountBlockKind = (typeof ACCOUNT_BLOCK_KINDS)[number];

/** Przyczyna blokady: próg strike'ów albo potwierdzona podróbka. */
export const ACCOUNT_BLOCK_CAUSES = ['STRIKES', 'COUNTERFEIT'] as const;
export type AccountBlockCause = (typeof ACCOUNT_BLOCK_CAUSES)[number];

/** Blokada wynikająca z progu strike'ów danej roli. */
export function blockKindOf(role: StrikeRole): AccountBlockKind {
  return role === 'BUYER' ? 'BIDDING' : 'LISTING';
}

/** Stan odwołania od strike'a albo blokady. */
export const APPEAL_STATUSES = ['NONE', 'PENDING', 'ACCEPTED', 'REJECTED'] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

/** Decyzja personelu w odwołaniu. */
export const APPEAL_DECISIONS = ['ACCEPTED', 'REJECTED'] as const;
export type AppealDecision = (typeof APPEAL_DECISIONS)[number];

/** Długość treści odwołania (znaki po przycięciu). */
export const APPEAL_MESSAGE_MIN_LENGTH = 20;
export const APPEAL_MESSAGE_MAX_LENGTH = 2000;

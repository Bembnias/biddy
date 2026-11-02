/**
 * Publiczne API modułu `identity` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: konta i logowanie (Better Auth), sesje, weryfikacja e-maila, akceptacje
 * regulaminu z oświadczeniem 18+, weryfikacja telefonu (F-08), profil i adresy (F-10), stan
 * sprzedawcy (F-14) i kupującego (F-15), limity kont, strike'i i blokady (F-61): inne moduły nadają
 * strike'i (`StrikeService.issue`) i dopisują historię zamówień (`TradeHistoryService`) w swoich
 * transakcjach; eventy StrikeIssued, StrikeRevoked, AccountBlocked, AccountBlockLifted,
 * AppealResolved.
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 * Kolumny z ID użytkownika w innych modułach to uuid bez klucza obcego (decyzja F-07).
 */
export { IdentityModule } from './identity.module.js';
export { AddressService, MAX_ADDRESSES } from './addresses/address.service.js';
export { PHONE_NUMBER_HINT, normalizePhoneNumber } from './phone/phone-number.js';
export { type BuyerStanding, BuyerStandingService } from './buyer/buyer-standing.service.js';
export { FollowService, type NotificationContact } from './follows/follow.service.js';
export {
  AccountBlocked,
  AccountBlockLifted,
  AppealResolved,
  StrikeIssued,
  StrikeRevoked,
} from './identity.events.js';
export {
  type AccountBlockRow as AccountBlock,
  type StrikeRow as Strike,
} from './db/standing.schema.js';
export { type ActiveBlock, AccountBlockService } from './standing/account-block.service.js';
export { AccountPolicyService } from './standing/account-policy.service.js';
export { accountBlockedError } from './standing/blocked-error.js';
export {
  LATE_PAYMENT_REVOKE_NOTE,
  type StrikeContext,
  strikeSourceKey,
} from './standing/statements.js';
export {
  type IssueStrikeInput,
  type IssuedStrike,
  StrikeService,
} from './standing/strike.service.js';
export { type TradeParties, TradeHistoryService } from './standing/trade-history.service.js';
export { ProfileService, type PublicProfile } from './profile/profile.service.js';
export { type SellerStanding, SellerStandingService } from './seller/seller-standing.service.js';
export {
  CurrentUser,
  RequireSession,
  RequireStaff,
  RequireVerifiedEmail,
  RequireVerifiedPhone,
  SessionGuard,
} from './session/session.guard.js';
export { type AuthenticatedUser } from './session/session.js';
export {
  ADDRESS_COUNTRIES,
  type Address,
  STAFF_ROLES,
  USER_STATUSES,
  type StaffRole,
  type UserStatus,
} from './db/identity.schema.js';
export { TEST_USERS, TEST_USER_PASSWORD, seedTestUsers } from './seed.js';

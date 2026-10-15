/**
 * Publiczne API modułu `identity` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: konta i logowanie (Better Auth), sesje, weryfikacja e-maila, akceptacje
 * regulaminu z oświadczeniem 18+, weryfikacja telefonu (F-08), profil i adresy (F-10), stan
 * sprzedawcy (F-14); dalej limity i strike'i (F-61).
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 * Kolumny z ID użytkownika w innych modułach to uuid bez klucza obcego (decyzja F-07).
 */
export { IdentityModule } from './identity.module.js';
export { AddressService, MAX_ADDRESSES } from './addresses/address.service.js';
export { ProfileService } from './profile/profile.service.js';
export { type SellerStanding, SellerStandingService } from './seller/seller-standing.service.js';
export {
  CurrentUser,
  RequireSession,
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

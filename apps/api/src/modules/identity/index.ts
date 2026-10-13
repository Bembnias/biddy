/**
 * Publiczne API modułu `identity` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: auth (Better Auth), użytkownicy, weryfikacja telefonu, akceptacje regulaminu, role, limity, strike'i i blokady (§4.1).
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export { IdentityModule } from './identity.module.js';

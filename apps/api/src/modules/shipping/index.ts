/**
 * Publiczne API modułu `shipping` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: adapter przewoźników, wyceny, etykiety, tracking, reklamacje.
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export { ShippingModule } from './shipping.module.js';

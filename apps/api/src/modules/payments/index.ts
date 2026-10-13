/**
 * Publiczne API modułu `payments` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: adapter operatora, webhooki, KYC status, zwroty, chargebacki, wypłaty.
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export { PaymentsModule } from './payments.module.js';

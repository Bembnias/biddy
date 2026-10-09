/**
 * Publiczne API modułu `ledger` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: księga podwójnego zapisu, uzgodnienia.
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export { LedgerModule } from './ledger.module.js';

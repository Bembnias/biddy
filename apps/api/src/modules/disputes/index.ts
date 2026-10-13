/**
 * Publiczne API modułu `disputes` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: spory, dowody, decyzje, zwroty.
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export { DisputesModule } from './disputes.module.js';

/**
 * Publiczne API modułu `trust-safety` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: zgłoszenia (DSA), reguły antyfraudowe, kolejki moderacji.
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export { TrustSafetyModule } from './trust-safety.module.js';

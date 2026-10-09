/**
 * Publiczne API modułu `admin` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: API backoffice z RBAC i audit logiem.
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export { AdminModule } from './admin.module.js';

/**
 * Publiczne API modułu `search` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: indeksowanie do Meilisearch, zapisane wyszukiwania.
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export { SearchModule } from './search.module.js';

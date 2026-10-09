/**
 * Publiczne API modułu `catalog` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: kategorie (drzewo), schematy atrybutów, przedmioty.
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export { CatalogModule } from './catalog.module.js';

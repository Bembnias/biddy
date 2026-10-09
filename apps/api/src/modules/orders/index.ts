/**
 * Publiczne API modułu `orders` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: checkout, maszyna stanów zamówienia, terminy, oferty drugiej szansy.
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export { OrdersModule } from './orders.module.js';

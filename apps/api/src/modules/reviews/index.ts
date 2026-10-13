/**
 * Publiczne API modułu `reviews` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: oceny i reputacja.
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export { ReviewsModule } from './reviews.module.js';

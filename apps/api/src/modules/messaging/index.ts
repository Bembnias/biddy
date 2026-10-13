/**
 * Publiczne API modułu `messaging` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: czat kupujący ↔ sprzedający, wykrywanie kontaktu poza platformą, blokowanie użytkowników.
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export { MessagingModule } from './messaging.module.js';

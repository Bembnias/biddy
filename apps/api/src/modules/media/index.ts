/**
 * Publiczne API modułu `media` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: presigned upload, przetwarzanie zdjęć, usuwanie EXIF, moderacja obrazów.
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export { MediaModule } from './media.module.js';

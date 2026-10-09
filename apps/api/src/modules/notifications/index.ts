/**
 * Publiczne API modułu `notifications` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: web push, push mobilny (Expo, Faza 4), e-mail, SMS, in-app, preferencje.
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export { NotificationsModule } from './notifications.module.js';

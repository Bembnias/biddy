/**
 * Publiczne API modułu `messaging` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: czat kupujący ↔ sprzedający, wykrywanie kontaktu poza platformą, blokowanie
 * użytkowników (F-29).
 * - MessagingService: rozmowy i wiadomości, liczba oflagowanych wiadomości (`flaggedCount`, F-36).
 * - BlockService: blokady między użytkownikami (`between`).
 * - MessagesUnread: event o nieprzeczytanych wiadomościach (konsument: notifications).
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export { type BlockState, BlockService } from './application/block.service.js';
export { MessagingService } from './application/messaging.service.js';
export { MessagesUnread } from './messaging.events.js';
export { MessagingModule } from './messaging.module.js';

/**
 * Publiczne API modułu `reviews` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: oceny i reputacja (F-30).
 * - ReputationService: średnia i liczba ocen konta, publiczna lista ocen.
 * - ReviewSubmitted, ReviewPublished: eventy dla powiadomień.
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export {
  type RatingStats,
  ReputationService,
  type UserRating,
} from './application/reputation.service.js';
export { ReviewPublished, ReviewSubmitted } from './reviews.events.js';
export { ReviewsModule } from './reviews.module.js';

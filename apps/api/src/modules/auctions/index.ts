/**
 * Publiczne API modułu `auctions` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: aukcje, oferty, proxy bidding, anti-sniping, zamykanie, obserwowane.
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export { AuctionsModule } from './auctions.module.js';
export {
  AuctionCancelled,
  AuctionPublished,
  AuctionSubmittedForReview,
  AuctionUpdated,
} from './auctions.events.js';
export {
  AUCTION_STATUSES,
  type AuctionStatus,
  REVIEW_REASONS,
  type ReviewReason,
} from './db/auctions.schema.js';
export { ListingService } from './listings/listing.service.js';

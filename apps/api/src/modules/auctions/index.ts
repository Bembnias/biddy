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
  AuctionEnded,
  AuctionExtended,
  AuctionPublished,
  AuctionSubmittedForReview,
  AuctionUpdated,
  BidCancelled,
  BidPlaced,
  UserOutbid,
} from './auctions.events.js';
export { BiddingService } from './bidding/bidding.service.js';
export { AuctionClosingService, type CloseResult } from './closing/auction-closing.service.js';
export {
  AUCTION_STATUSES,
  type AuctionStatus,
  REVIEW_REASONS,
  type ReviewReason,
} from './db/auctions.schema.js';
export { ListingService } from './listings/listing.service.js';
export { type AuctionNotice, AuctionDirectory } from './public/auction-directory.js';
export { type AuctionSearchEntry, AuctionSearchSource } from './public/auction-search-source.js';
export { WatchlistService } from './watchlist/watchlist.service.js';

/**
 * Publiczne API modułu `search` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: indeksowanie do Meilisearch, wyszukiwanie aukcji, zapisane wyszukiwania.
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export { AuctionIndexer } from './auctions/auction-indexer.js';
export { AuctionSearchService } from './auctions/auction-search.service.js';
export { SearchModule } from './search.module.js';

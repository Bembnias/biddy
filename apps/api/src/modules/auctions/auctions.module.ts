import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/index.js';
import { MediaModule } from '../media/index.js';
import { OrdersModule } from '../orders/index.js';
import { ShippingModule } from '../shipping/index.js';
import { TrustSafetyModule } from '../trust-safety/index.js';
import {
  AdminAuctionsController,
  AdminBidsController,
  BidsController,
} from './bidding/bids.controller.js';
import { BiddingService } from './bidding/bidding.service.js';
import { AuctionClosingService } from './closing/auction-closing.service.js';
import { AuctionLiveEvents } from './live/auction-live-events.js';
import { ListingService } from './listings/listing.service.js';
import { AuctionsController, MyAuctionsController } from './listings/listings.controller.js';
import { AuctionPages } from './pages/auction-pages.js';
import { AuctionCards } from './public/auction-cards.js';
import { AuctionDirectory } from './public/auction-directory.js';
import { ListingStrikes } from './listings/listing-strikes.js';
import { MyListsService } from './public/my-lists.service.js';
import { AuctionSearchSource } from './public/auction-search-source.js';
import { AuctionViewService } from './public/auction-view.service.js';
import { MyBidsController, PublicAuctionsController } from './public/public-auctions.controller.js';
import { WatchlistController } from './watchlist/watchlist.controller.js';
import { WatchlistService } from './watchlist/watchlist.service.js';

/**
 * Moduł domenowy `auctions` (PROJECT.md §10.3): wystawianie aukcji (F-14), silnik licytacji
 * (F-15) i zamykanie aukcji z zamówieniem (F-16). Publiczne API: ./index.ts.
 */
@Module({
  imports: [CatalogModule, MediaModule, OrdersModule, ShippingModule, TrustSafetyModule],
  controllers: [
    AuctionsController,
    MyAuctionsController,
    BidsController,
    AdminBidsController,
    AdminAuctionsController,
    PublicAuctionsController,
    MyBidsController,
    WatchlistController,
  ],
  providers: [
    ListingService,
    BiddingService,
    AuctionClosingService,
    AuctionLiveEvents,
    AuctionViewService,
    AuctionPages,
    AuctionSearchSource,
    AuctionDirectory,
    ListingStrikes,
    WatchlistService,
    AuctionCards,
    MyListsService,
  ],
  exports: [
    ListingService,
    BiddingService,
    AuctionClosingService,
    AuctionSearchSource,
    AuctionDirectory,
    WatchlistService,
  ],
})
export class AuctionsModule {}

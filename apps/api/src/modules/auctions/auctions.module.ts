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
  ],
  providers: [ListingService, BiddingService, AuctionClosingService, AuctionLiveEvents],
  exports: [ListingService, BiddingService, AuctionClosingService],
})
export class AuctionsModule {}

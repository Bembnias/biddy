import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/index.js';
import { MediaModule } from '../media/index.js';
import { ShippingModule } from '../shipping/index.js';
import { TrustSafetyModule } from '../trust-safety/index.js';
import { AdminBidsController, BidsController } from './bidding/bids.controller.js';
import { BiddingService } from './bidding/bidding.service.js';
import { ListingService } from './listings/listing.service.js';
import { AuctionsController, MyAuctionsController } from './listings/listings.controller.js';

/**
 * Moduł domenowy `auctions` (PROJECT.md §10.3): wystawianie aukcji (F-14), silnik licytacji
 * (F-15); zamykanie w F-16. Publiczne API: ./index.ts.
 */
@Module({
  imports: [CatalogModule, MediaModule, ShippingModule, TrustSafetyModule],
  controllers: [AuctionsController, MyAuctionsController, BidsController, AdminBidsController],
  providers: [ListingService, BiddingService],
  exports: [ListingService, BiddingService],
})
export class AuctionsModule {}

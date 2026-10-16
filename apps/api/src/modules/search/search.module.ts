import { Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../infra/config/index.js';
import { MeiliClient } from '../../infra/search/index.js';
import { AuctionsModule } from '../auctions/index.js';
import { CatalogModule } from '../catalog/index.js';
import { AuctionIndexer } from './auctions/auction-indexer.js';
import { AuctionSearchService } from './auctions/auction-search.service.js';
import { SearchController } from './auctions/search.controller.js';

/** Moduł domenowy `search` (PROJECT.md §10.3): indeks aukcji w Meilisearch i wyszukiwanie (F-19). */
@Module({
  imports: [AuctionsModule, CatalogModule],
  controllers: [SearchController],
  providers: [
    {
      provide: MeiliClient,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new MeiliClient(config.search.url, config.search.apiKey),
    },
    AuctionIndexer,
    AuctionSearchService,
  ],
  exports: [AuctionIndexer, AuctionSearchService],
})
export class SearchModule {}

// Strike sprzedającego za anulowanie aukcji z ofertami (F-61, PROJECT.md §4.1, §6.6). Anulowanie
// przez moderatora nie daje strike'a z automatu: moderator nadaje go sam, jeśli trzeba.
import { Inject, Injectable } from '@nestjs/common';

import {
  type DomainEventContext,
  type DomainEventOf,
  OnDomainEvent,
} from '../../../infra/outbox/index.js';
import { StrikeService, strikeSourceKey } from '../../identity/index.js';
import { AuctionCancelled } from '../auctions.events.js';
import { AuctionDirectory } from '../public/auction-directory.js';

@Injectable()
export class ListingStrikes {
  constructor(
    @Inject(StrikeService) private readonly strikes: StrikeService,
    @Inject(AuctionDirectory) private readonly auctions: AuctionDirectory,
  ) {}

  @OnDomainEvent(AuctionCancelled, { consumer: 'auctions.strike-cancelled-with-bids' })
  async onAuctionCancelled(
    event: DomainEventOf<typeof AuctionCancelled>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const { cancelledBy, bidCount, sellerId } = event.payload;
    if (cancelledBy !== 'SELLER' || bidCount === 0) {
      return;
    }
    const [notice] = await this.auctions.notices([event.aggregateId], tx);
    await this.strikes.issue(tx, {
      userId: sellerId,
      reason: 'AUCTION_CANCELLED_WITH_BIDS',
      sourceKey: strikeSourceKey('AUCTION_CANCELLED_WITH_BIDS', event.aggregateId),
      auctionId: event.aggregateId,
      context: notice === undefined ? {} : { title: notice.title },
    });
  }
}

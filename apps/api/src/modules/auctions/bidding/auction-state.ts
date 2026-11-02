// Stan licytacji aukcji (F-15) do odpowiedzi API i zdarzeń na żywo (F-17): czyste funkcje
// na wierszu aukcji, bez zależności od serwisów.
import { type AuctionBiddingState, isReserveMet, minimumNextBid, money } from '@biddy/shared';

import type { Auction } from '../db/auctions.schema.js';

/** Stan licytacji z wiersza aukcji (opublikowanej, więc z ceną wywoławczą). */
export function biddingState(auction: Auction): AuctionBiddingState {
  return {
    currency: auction.currency,
    startPrice: auction.startPrice ?? 0,
    reservePrice: auction.reservePrice,
    currentPrice: auction.currentPrice,
    leaderId: auction.leaderId,
    leaderMaxAmount: auction.leaderMaxAmount,
  };
}

/** Minimalna kolejna oferta aktywnej aukcji (null po zakończeniu). */
export function nextMinimumBid(auction: Auction): number | null {
  if (auction.status !== 'ACTIVE' || auction.startPrice === null) {
    return null;
  }
  return minimumNextBid({
    startPrice: money(auction.startPrice, auction.currency),
    currentPrice:
      auction.currentPrice === null ? null : money(auction.currentPrice, auction.currency),
  }).amount;
}

export function reserveMet(auction: Auction): boolean | null {
  return isReserveMet(biddingState(auction));
}

/** Stan ceny minimalnej bez kwoty (API i zdarzenia na żywo). */
export function reserveStatus(auction: Auction): 'NONE' | 'NOT_MET' | 'MET' {
  const met = reserveMet(auction);
  return met === null ? 'NONE' : met ? 'MET' : 'NOT_MET';
}

// Zdarzenia na żywo modułu auctions (F-17, PROJECT.md §10.5, §14.2): stan aukcji dla
// oglądających (lider zanonimizowany, bez maksimów) i zdarzenia użytkownika. Serwisy wołają
// `publish` po zatwierdzeniu transakcji; błąd nie psuje operacji (RealtimePublisher).
import { anonymizeName } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { Transaction } from '../../../infra/db/index.js';
import { type RealtimeMessage, RealtimePublisher } from '../../../infra/realtime/index.js';
import { ProfileService } from '../../identity/index.js';
import type { Order } from '../../orders/index.js';
import { nextMinimumBid, reserveStatus } from '../bidding/auction-state.js';
import type { Auction } from '../db/auctions.schema.js';

/** Co wydarzyło się w aukcji, oprócz nowego stanu (który wysyłamy zawsze). */
export interface AuctionChange {
  readonly auction: Auction;
  /** Poprzedni lider przebity przez tę zmianę. */
  readonly outbidUserId?: string | null;
  /** Anti-sniping przesunął koniec. */
  readonly extended?: boolean;
  /** Aukcja się zakończyła albo została anulowana. */
  readonly ended?: 'SOLD' | 'UNSOLD' | 'CANCELLED';
  /** Zamówienie zwycięzcy (sprzedaż). */
  readonly order?: Order;
}

@Injectable()
export class AuctionLiveEvents {
  constructor(
    @Inject(ProfileService) private readonly profiles: ProfileService,
    private readonly publisher: RealtimePublisher,
  ) {}

  /**
   * Zdarzenia zmiany. Buduj je w transakcji (pod blokadą aukcji), a wysyłaj `send` zaraz po
   * jej zatwierdzeniu: wtedy zdarzenia jednej aukcji wychodzą w kolejności zmian. Odczyt idzie
   * przez `tx`, bo przy wielu ofertach czekających na blokadę pula może nie mieć wolnego połączenia.
   */
  async messages(tx: Transaction, change: AuctionChange): Promise<RealtimeMessage[]> {
    try {
      return await this.build(tx, change);
    } catch {
      // Zdarzenia na żywo to najlepszy wysiłek: błąd odczytu nie może cofnąć operacji.
      return [];
    }
  }

  /** Wysyła zdarzenia (synchronicznie, bez czekania na Redisa); nigdy nie rzuca. */
  send(messages: readonly RealtimeMessage[]): void {
    this.publisher.publish(...messages);
  }

  private async build(tx: Transaction, change: AuctionChange): Promise<RealtimeMessage[]> {
    const { auction } = change;
    const serverTime = new Date().toISOString();
    const names =
      auction.leaderId === null
        ? new Map<string, string>()
        : await this.profiles.displayNames([auction.leaderId], tx);
    const messages: RealtimeMessage[] = [
      {
        auctionId: auction.id,
        event: 'auction.updated',
        payload: {
          auctionId: auction.id,
          version: auction.version,
          status: auction.status,
          currency: auction.currency,
          currentPrice: auction.currentPrice,
          bidCount: auction.bidCount,
          leader:
            auction.leaderId === null
              ? null
              : { publicName: anonymizeName(names.get(auction.leaderId) ?? '') },
          endsAt: auction.endsAt?.toISOString() ?? null,
          reserveStatus: reserveStatus(auction),
          minimumNextBid: nextMinimumBid(auction),
          buyNowAvailable:
            auction.status === 'ACTIVE' && auction.buyNowPrice !== null && auction.bidCount === 0,
          serverTime,
        },
      },
    ];
    if (change.extended === true && auction.endsAt !== null) {
      messages.push({
        auctionId: auction.id,
        event: 'auction.extended',
        payload: { auctionId: auction.id, endsAt: auction.endsAt.toISOString(), serverTime },
      });
    }
    if (
      change.outbidUserId !== undefined &&
      change.outbidUserId !== null &&
      auction.currentPrice !== null &&
      auction.endsAt !== null
    ) {
      messages.push({
        userId: change.outbidUserId,
        event: 'user.outbid',
        payload: {
          auctionId: auction.id,
          currency: auction.currency,
          currentPrice: auction.currentPrice,
          minimumNextBid: nextMinimumBid(auction),
          endsAt: auction.endsAt.toISOString(),
          serverTime,
        },
      });
    }
    if (change.ended !== undefined) {
      messages.push({
        auctionId: auction.id,
        event: 'auction.ended',
        payload: {
          auctionId: auction.id,
          outcome: change.ended,
          currency: auction.currency,
          finalPrice: change.ended === 'SOLD' ? auction.currentPrice : null,
          serverTime,
        },
      });
    }
    if (change.order !== undefined) {
      messages.push({
        userId: change.order.buyerId,
        event: 'user.won',
        payload: {
          auctionId: auction.id,
          orderId: change.order.id,
          orderPublicId: change.order.publicId,
          currency: change.order.currency,
          total: change.order.total,
          paymentDueAt: change.order.paymentDueAt.toISOString(),
          serverTime,
        },
      });
    }
    return messages;
  }
}

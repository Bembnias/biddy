// Klient realtime w pamięci do testów komponentów (F-17, F-18): zapisuje subskrypcje i pozwala
// „wysłać” zdarzenia z testu.
import type {
  AuctionEndedEvent,
  AuctionExtendedEvent,
  AuctionHandlers,
  AuctionUpdatedEvent,
  RealtimeClient,
  RealtimeStatus,
  UserHandlers,
  UserOutbidEvent,
  UserWonEvent,
  NotificationNewEvent,
  MessageNewEvent,
  ConversationReadEvent,
} from '@biddy/realtime';
import { vi } from 'vitest';

/** Klient w pamięci: zapisuje subskrypcje i pozwala „wysłać” zdarzenia z testu. */
export function fakeRealtimeClient() {
  const auctions = new Map<string, Set<AuctionHandlers>>();
  const users = new Set<UserHandlers>();
  const views = new Map<string, Set<(count: number) => void>>();
  const reconnects = new Set<() => void>();
  const statuses = new Set<(status: RealtimeStatus) => void>();
  const clocks = new Set<(offset: number) => void>();
  const close = vi.fn();
  const client: RealtimeClient = {
    status: 'idle',
    connect: vi.fn(),
    close,
    subscribeAuction(auctionId, handlers) {
      const set = auctions.get(auctionId) ?? new Set();
      set.add(handlers);
      auctions.set(auctionId, set);
      return () => {
        set.delete(handlers);
      };
    },
    viewAuction(auctionId, onViewers) {
      const set = views.get(auctionId) ?? new Set();
      set.add(onViewers);
      views.set(auctionId, set);
      return () => {
        set.delete(onViewers);
      };
    },
    onUserEvents(handlers) {
      users.add(handlers);
      return () => {
        users.delete(handlers);
      };
    },
    onReconnect(callback) {
      reconnects.add(callback);
      return () => {
        reconnects.delete(callback);
      };
    },
    onStatus(callback) {
      statuses.add(callback);
      return () => {
        statuses.delete(callback);
      };
    },
    clockOffset: () => undefined,
    onClockOffset(callback) {
      clocks.add(callback);
      return () => {
        clocks.delete(callback);
      };
    },
    serverNow: () => Date.now(),
  };
  return {
    client,
    close,
    subscribers: (auctionId: string) => auctions.get(auctionId)?.size ?? 0,
    update(event: AuctionUpdatedEvent) {
      for (const handlers of auctions.get(event.auctionId) ?? []) {
        handlers.onUpdated?.(event);
      }
    },
    extended(event: AuctionExtendedEvent) {
      for (const handlers of auctions.get(event.auctionId) ?? []) {
        handlers.onExtended?.(event);
      }
    },
    ended(event: AuctionEndedEvent) {
      for (const handlers of auctions.get(event.auctionId) ?? []) {
        handlers.onEnded?.(event);
      }
    },
    outbid(auctionId: string, event: Partial<UserOutbidEvent> = {}) {
      for (const handlers of users) {
        handlers.onOutbid?.({
          auctionId,
          currency: 'PLN',
          currentPrice: 2_000,
          minimumNextBid: 2_100,
          endsAt: new Date().toISOString(),
          serverTime: new Date().toISOString(),
          ...event,
        });
      }
    },
    won(event: UserWonEvent) {
      for (const handlers of users) {
        handlers.onWon?.(event);
      }
    },
    notification(event: NotificationNewEvent) {
      for (const handlers of users) {
        handlers.onNotification?.(event);
      }
    },
    /** Nowa wiadomość w rozmowie (F-29). */
    message(event: MessageNewEvent) {
      for (const handlers of users) {
        handlers.onMessage?.(event);
      }
    },
    /** Odczyt wiadomości w rozmowie (F-29). */
    conversationRead(event: ConversationReadEvent) {
      for (const handlers of users) {
        handlers.onConversationRead?.(event);
      }
    },
    /** Liczba oglądających aukcję (F-63), jak `auction.viewers` z serwera. */
    viewers(auctionId: string, count: number) {
      for (const callback of views.get(auctionId) ?? []) {
        callback(count);
      }
    },
    /** Liczba stron oglądających aukcję (zgłoszeń `viewAuction`). */
    viewing: (auctionId: string) => views.get(auctionId)?.size ?? 0,
    /** Liczba subskrypcji zdarzeń użytkownika. */
    userSubscribers: () => users.size,
    reconnect() {
      reconnects.forEach((callback) => {
        callback();
      });
    },
    status(next: RealtimeStatus) {
      statuses.forEach((callback) => {
        callback(next);
      });
    },
    clock(offset: number) {
      clocks.forEach((callback) => {
        callback(offset);
      });
    },
  };
}

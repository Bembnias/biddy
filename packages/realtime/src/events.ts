// Zdarzenia WebSocket Biddy (F-17, PROJECT.md §10.5, §14.2): kontrakt serwer ↔ klient wspólny
// dla API (tylko typy), web i mobile. Kwoty w groszach, czasy ISO 8601. Każde zdarzenie niesie
// `serverTime`. Zdarzenia publiczne nie zawierają maksimów ani identyfikatorów licytujących.

/** Ścieżka Socket.IO na serwerze API. */
export const REALTIME_PATH = '/v1/realtime';

/** Najwięcej aukcji subskrybowanych naraz przez jedno połączenie. */
export const MAX_AUCTION_SUBSCRIPTIONS = 50;

export type RealtimeAuctionStatus =
  'ACTIVE' | 'ENDED_SOLD' | 'ENDED_UNSOLD' | 'CANCELLED' | 'DRAFT' | 'PENDING_REVIEW';

/** Stan ceny minimalnej bez jej kwoty. */
export type ReserveStatus = 'NONE' | 'NOT_MET' | 'MET';

/** Nowy stan aukcji (oferta, Kup teraz, unieważnienie, koniec, anulowanie). */
export interface AuctionUpdatedEvent {
  readonly auctionId: string;
  /** Rośnie z każdą zmianą aukcji: klient ignoruje stan starszy niż już pokazany. */
  readonly version: number;
  readonly status: RealtimeAuctionStatus;
  readonly currency: 'PLN';
  readonly currentPrice: number | null;
  readonly bidCount: number;
  /** Zanonimizowany lider, np. „k***a”. */
  readonly leader: { readonly publicName: string } | null;
  /** Autorytatywny koniec aukcji. */
  readonly endsAt: string | null;
  readonly reserveStatus: ReserveStatus;
  readonly minimumNextBid: number | null;
  readonly buyNowAvailable: boolean;
  readonly serverTime: string;
}

/** Anti-sniping przesunął koniec aukcji (§6.5). */
export interface AuctionExtendedEvent {
  readonly auctionId: string;
  readonly endsAt: string;
  readonly serverTime: string;
}

export type AuctionOutcome = 'SOLD' | 'UNSOLD' | 'CANCELLED';

/** Aukcja zakończona (czas, Kup teraz) albo anulowana. */
export interface AuctionEndedEvent {
  readonly auctionId: string;
  readonly outcome: AuctionOutcome;
  readonly currency: 'PLN';
  readonly finalPrice: number | null;
  readonly serverTime: string;
}

/** Ktoś przebił zalogowanego użytkownika (room `user:{id}`). */
export interface UserOutbidEvent {
  readonly auctionId: string;
  readonly currency: 'PLN';
  readonly currentPrice: number;
  readonly minimumNextBid: number | null;
  readonly endsAt: string;
  readonly serverTime: string;
}

/** Zalogowany użytkownik wygrał aukcję i ma zamówienie do opłacenia (room `user:{id}`). */
export interface UserWonEvent {
  readonly auctionId: string;
  readonly orderId: string;
  readonly orderPublicId: string;
  readonly currency: 'PLN';
  readonly total: number;
  readonly paymentDueAt: string;
  readonly serverTime: string;
}

/** Zdarzenia serwer → klient (typy dla Socket.IO). */
/** Nowe powiadomienie w centrum powiadomień (F-20), z liczbą nieprzeczytanych do dzwonka. */
export interface NotificationNewEvent {
  readonly id: string;
  /** Typ z NOTIFICATION_TYPES w @biddy/shared, np. `OUTBID`. */
  readonly type: string;
  readonly title: string;
  readonly body: string;
  /** Ścieżka w web, np. `/a/wazon-k3x9qa7m`. */
  readonly url: string;
  readonly createdAt: string;
  readonly unreadCount: number;
}

export interface ServerToClientEvents {
  'auction.updated': (event: AuctionUpdatedEvent) => void;
  'auction.extended': (event: AuctionExtendedEvent) => void;
  'auction.ended': (event: AuctionEndedEvent) => void;
  'user.outbid': (event: UserOutbidEvent) => void;
  'user.won': (event: UserWonEvent) => void;
  'notification.new': (event: NotificationNewEvent) => void;
}

export type SubscribeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: 'INVALID_AUCTION_ID' | 'TOO_MANY_SUBSCRIPTIONS' };

/** Zdarzenia klient → serwer (z potwierdzeniem, gdy jest funkcja `ack`). */
export interface ClientToServerEvents {
  'auction:subscribe': (auctionId: string, ack: (result: SubscribeResult) => void) => void;
  'auction:unsubscribe': (auctionId: string) => void;
  'time:ping': (ack: (result: { readonly serverTime: string }) => void) => void;
}

/** Nazwy roomów (serwer). */
export function auctionRoom(auctionId: string): string {
  return `auction:${auctionId}`;
}

export function userRoom(userId: string): string {
  return `user:${userId}`;
}

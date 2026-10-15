// Stan strony aukcji w przeglądarce (F-18): zdarzenia na żywo (F-17) scalane z widokiem z API,
// fazy aukcji do panelu licytacji, licznik do końca i kwota oferty z pola tekstowego.
import type { PublicAuctionDto } from '@biddy/api-client';
import type { AuctionEndedEvent, AuctionUpdatedEvent } from '@biddy/realtime';
import { MoneyParseError, parseMoney } from '@biddy/shared';

type PublicStatus = PublicAuctionDto['status'];

const PUBLIC_STATUSES: readonly string[] = ['ACTIVE', 'ENDED_SOLD', 'ENDED_UNSOLD', 'CANCELLED'];

/**
 * Widok po `auction.updated`. Starsze albo równe `version` ignorujemy: zdarzenia z różnych
 * instancji API mogą przyjść w innej kolejności niż zmiany (F-17).
 */
export function applyAuctionUpdate(
  current: PublicAuctionDto,
  event: AuctionUpdatedEvent,
): PublicAuctionDto {
  if (event.auctionId !== current.id || event.version <= current.version) {
    return current;
  }
  return {
    ...current,
    status: PUBLIC_STATUSES.includes(event.status)
      ? (event.status as PublicStatus)
      : current.status,
    currentPrice: event.currentPrice,
    bidCount: event.bidCount,
    leader: event.leader,
    endsAt: event.endsAt,
    reserveStatus: event.reserveStatus,
    minimumNextBid: event.minimumNextBid,
    buyNowAvailable: event.buyNowAvailable,
    buyNowPrice: event.buyNowAvailable ? current.buyNowPrice : null,
    version: event.version,
  };
}

const ENDED_STATUS: Record<AuctionEndedEvent['outcome'], PublicStatus> = {
  SOLD: 'ENDED_SOLD',
  UNSOLD: 'ENDED_UNSOLD',
  CANCELLED: 'CANCELLED',
};

/** Widok po `auction.ended` (pełny stan i tak dociągamy przez REST). */
export function applyAuctionEnded(
  current: PublicAuctionDto,
  event: AuctionEndedEvent,
): PublicAuctionDto {
  if (event.auctionId !== current.id) {
    return current;
  }
  return {
    ...current,
    status: ENDED_STATUS[event.outcome],
    minimumNextBid: null,
    buyNowAvailable: false,
    buyNowPrice: null,
  };
}

/** Faza aukcji w panelu licytacji. */
export type AuctionPhase =
  'scheduled' | 'active' | 'ending' | 'closing' | 'sold' | 'unsold' | 'cancelled';

/**
 * Faza aukcji w chwili `now` (czas serwera, ms). Bez `now` (renderowanie na serwerze, przed
 * hydracją) aktywna aukcja jest po prostu aktywna: licznik pojawia się w przeglądarce.
 */
export function auctionPhase(
  auction: Pick<PublicAuctionDto, 'status' | 'startsAt' | 'endsAt' | 'extensionWindowSeconds'>,
  now: number | null,
): AuctionPhase {
  switch (auction.status) {
    case 'ENDED_SOLD':
      return 'sold';
    case 'ENDED_UNSOLD':
      return 'unsold';
    case 'CANCELLED':
      return 'cancelled';
    case 'ACTIVE':
      break;
  }
  if (now === null) {
    return 'active';
  }
  if (auction.startsAt !== null && Date.parse(auction.startsAt) > now) {
    return 'scheduled';
  }
  if (auction.endsAt === null) {
    return 'active';
  }
  const remaining = Date.parse(auction.endsAt) - now;
  if (remaining <= 0) {
    // Czas minął, a zamknięcie (F-16) jeszcze nie dotarło.
    return 'closing';
  }
  return remaining <= auction.extensionWindowSeconds * 1000 ? 'ending' : 'active';
}

/** Czas do końca w częściach do wyświetlenia. */
export type Remaining =
  | { readonly kind: 'days'; readonly days: number; readonly hours: number }
  | { readonly kind: 'hours'; readonly hours: number; readonly minutes: number }
  | { readonly kind: 'minutes'; readonly minutes: number; readonly seconds: number };

/** „2 dni 4 h”, „3 h 12 min”, w ostatniej godzinie minuty i sekundy (zaokrąglenie w górę). */
export function remainingParts(milliseconds: number): Remaining {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days > 0) {
    return { kind: 'days', days, hours };
  }
  if (hours > 0) {
    return { kind: 'hours', hours, minutes };
  }
  return { kind: 'minutes', minutes, seconds: total % 60 };
}

/** Kwota z pola oferty („120”, „120,50”, „1 200 zł”) w groszach albo błąd. */
export function parseBidAmount(text: string): number | 'empty' | 'invalid' {
  if (text.trim() === '') {
    return 'empty';
  }
  try {
    const { amount } = parseMoney(text);
    return amount > 0 ? amount : 'invalid';
  } catch (error) {
    if (error instanceof MoneyParseError) {
      return 'invalid';
    }
    throw error;
  }
}

// Sygnały licytacji (F-63): ton licznika, LIVE i gorąca aukcja. Jedna definicja dla karty
// aukcji, strony aukcji i Moje Biddy (web i mobile), żeby te same aukcje wyglądały wszędzie tak samo.

/** Poniżej doby licznik jest fioletowy, poniżej godziny czerwony (design system, F-62). */
export const SOON_WINDOW_MS = 24 * 60 * 60 * 1000;
export const LIVE_WINDOW_MS = 60 * 60 * 1000;

/** Gorąca aukcja: co najmniej tyle ofert i mniej niż doba do końca. */
export const HOT_MIN_BIDS = 5;
export const HOT_WINDOW_MS = SOON_WINDOW_MS;

export type TimerTone = 'calm' | 'soon' | 'urgent';

/** Ton licznika dla czasu do końca (ms). */
export function timerTone(remainingMs: number): TimerTone {
  if (remainingMs < LIVE_WINDOW_MS) {
    return 'urgent';
  }
  return remainingMs < SOON_WINDOW_MS ? 'soon' : 'calm';
}

export interface AuctionSignalSource {
  readonly status: string;
  readonly bidCount: number;
  /** Koniec aukcji (ISO 8601) albo null. */
  readonly endsAt: string | null;
}

/** Czas do końca aktywnej aukcji (ms) albo null, gdy aukcja nie trwa. */
function remaining(auction: AuctionSignalSource, now: number): number | null {
  if (auction.status !== 'ACTIVE' || auction.endsAt === null) {
    return null;
  }
  const left = Date.parse(auction.endsAt) - now;
  return left > 0 ? left : null;
}

/** LIVE: aktywna aukcja z mniej niż godziną do końca (ten sam próg co czerwony licznik). */
export function isLiveAuction(auction: AuctionSignalSource, now: number): boolean {
  const left = remaining(auction, now);
  return left !== null && left < LIVE_WINDOW_MS;
}

/** Gorąca aukcja: aktywna, co najmniej HOT_MIN_BIDS ofert i mniej niż doba do końca. */
export function isHotAuction(auction: AuctionSignalSource, now: number): boolean {
  const left = remaining(auction, now);
  return left !== null && left < HOT_WINDOW_MS && auction.bidCount >= HOT_MIN_BIDS;
}

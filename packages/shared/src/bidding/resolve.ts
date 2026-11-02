// Licytacja automatyczna (F-15, PROJECT.md §6.4, §15.1): czysta funkcja rozstrzygająca ofertę
// względem stanu aukcji. Ta sama funkcja działa przy składaniu oferty (w transakcji z blokadą
// aukcji) i przy przeliczaniu aukcji od zera po unieważnieniu oferty (replay, §15.6).
import type { CurrencyCode } from '../money/currency.js';
import { money } from '../money/money.js';
import { bidIncrement, minimumNextBid } from '../pricing/bid-increments.js';

/** Stan licytacji aukcji (kwoty w groszach). */
export interface AuctionBiddingState {
  readonly currency: CurrencyCode;
  readonly startPrice: number;
  /** Cena minimalna (ukryta) albo null. */
  readonly reservePrice: number | null;
  /** Aktualna cena albo null, gdy nie ma ofert. */
  readonly currentPrice: number | null;
  readonly leaderId: string | null;
  /** Tajne maksimum lidera. */
  readonly leaderMaxAmount: number | null;
}

/** Oferta licytującego: maksimum, do którego system licytuje za niego. */
export interface IncomingBid {
  readonly bidderId: string;
  readonly maxAmount: number;
}

/** Oferta do zapisania: ręczna (licytującego) albo automatyczna (odpowiedź lidera). */
export interface ResolvedBid {
  readonly bidderId: string;
  readonly kind: 'MANUAL' | 'AUTO';
  /** Kwota widoczna w historii. */
  readonly amount: number;
  readonly maxAmount: number;
}

export type ResolveResult =
  | {
      readonly accepted: false;
      readonly reason: 'BID_TOO_LOW';
      /** Najniższe maksimum, które zostałoby przyjęte. */
      readonly minimumBid: number;
    }
  | {
      readonly accepted: true;
      readonly state: AuctionBiddingState;
      /** Oferty do zapisu w kolejności (najpierw ręczna, potem ewentualna automatyczna). */
      readonly bids: readonly ResolvedBid[];
      /** Zmieniła się cena albo lider (warunek przedłużenia aukcji, §6.5). */
      readonly changed: boolean;
      /** Poprzedni lider, który stracił prowadzenie, albo null. */
      readonly outbidUserId: string | null;
    };

/** Pusty stan aukcji bez ofert. */
export function initialBiddingState(
  auction: Pick<AuctionBiddingState, 'currency' | 'startPrice' | 'reservePrice'>,
): AuctionBiddingState {
  return { ...auction, currentPrice: null, leaderId: null, leaderMaxAmount: null };
}

/** Czy osiągnięto cenę minimalną (null, gdy aukcja jej nie ma). */
export function isReserveMet(state: AuctionBiddingState): boolean | null {
  if (state.reservePrice === null) {
    return null;
  }
  return state.currentPrice !== null && state.currentPrice >= state.reservePrice;
}

/**
 * Rozstrzyga ofertę (§6.4):
 * 1. oferta jest ważna, gdy maksimum ≥ minimalna kolejna oferta (pierwsza: ≥ cena wywoławcza),
 *    a lider podnoszący maksimum musi podać więcej niż dotychczas;
 * 2. maksimum > maksimum lidera: nowy lider, cena = min(maksimum, maksimum lidera + krok);
 * 3. maksimum ≤ maksimum lidera: lider bez zmian, cena = min(maksimum lidera, maksimum + krok),
 *    remis wygrywa wcześniejsza oferta;
 * 4. gdy maksimum lidera ≥ cena minimalna, a cena jest niższa, cena rośnie do ceny minimalnej;
 * 5. lider podnoszący maksimum nie podnosi ceny (poza regułą 4).
 */
export function resolve(state: AuctionBiddingState, bid: IncomingBid): ResolveResult {
  const increment = (amount: number) => bidIncrement(money(amount, state.currency)).amount;
  const withReserve = (price: number, leaderMax: number) =>
    state.reservePrice !== null && leaderMax >= state.reservePrice && price < state.reservePrice
      ? state.reservePrice
      : price;
  const { bidderId, maxAmount } = bid;

  if (state.leaderId === null || state.currentPrice === null || state.leaderMaxAmount === null) {
    if (maxAmount < state.startPrice) {
      return { accepted: false, reason: 'BID_TOO_LOW', minimumBid: state.startPrice };
    }
    const price = withReserve(state.startPrice, maxAmount);
    return {
      accepted: true,
      state: { ...state, currentPrice: price, leaderId: bidderId, leaderMaxAmount: maxAmount },
      bids: [{ bidderId, kind: 'MANUAL', amount: price, maxAmount }],
      changed: true,
      outbidUserId: null,
    };
  }

  const { currentPrice, leaderId, leaderMaxAmount } = state;
  if (bidderId === leaderId) {
    if (maxAmount <= leaderMaxAmount) {
      return { accepted: false, reason: 'BID_TOO_LOW', minimumBid: leaderMaxAmount + 1 };
    }
    const price = withReserve(currentPrice, maxAmount);
    return {
      accepted: true,
      state: { ...state, currentPrice: price, leaderMaxAmount: maxAmount },
      bids: [{ bidderId, kind: 'MANUAL', amount: price, maxAmount }],
      changed: price !== currentPrice,
      outbidUserId: null,
    };
  }

  const minimum = minimumNextBid({
    startPrice: money(state.startPrice, state.currency),
    currentPrice: money(currentPrice, state.currency),
  }).amount;
  if (maxAmount < minimum) {
    return { accepted: false, reason: 'BID_TOO_LOW', minimumBid: minimum };
  }

  if (maxAmount > leaderMaxAmount) {
    const price = withReserve(
      Math.min(maxAmount, leaderMaxAmount + increment(leaderMaxAmount)),
      maxAmount,
    );
    return {
      accepted: true,
      state: { ...state, currentPrice: price, leaderId: bidderId, leaderMaxAmount: maxAmount },
      bids: [{ bidderId, kind: 'MANUAL', amount: price, maxAmount }],
      changed: true,
      outbidUserId: leaderId,
    };
  }

  // Lider odpowiada automatycznie; przegrywający licytujący wyczerpał swoje maksimum.
  const price = withReserve(
    Math.min(leaderMaxAmount, maxAmount + increment(maxAmount)),
    leaderMaxAmount,
  );
  return {
    accepted: true,
    state: { ...state, currentPrice: price },
    bids: [
      { bidderId, kind: 'MANUAL', amount: maxAmount, maxAmount },
      { bidderId: leaderId, kind: 'AUTO', amount: price, maxAmount: leaderMaxAmount },
    ],
    changed: price !== currentPrice,
    outbidUserId: null,
  };
}

export interface ReplayStep {
  readonly bid: IncomingBid;
  readonly result: ResolveResult;
}

export interface ReplayResult {
  readonly state: AuctionBiddingState;
  /** Wynik każdej oferty w kolejności (odrzucone też, np. zależne od unieważnionej). */
  readonly steps: readonly ReplayStep[];
  /** Wszystkie oferty do zapisu, w kolejności. */
  readonly bids: readonly ResolvedBid[];
}

/**
 * Przelicza aukcję od zera: ręczne oferty po kolei przez `resolve` (§15.6). Wynik jest ten sam,
 * co przy składaniu tych ofert jedna po drugiej.
 */
export function replay(
  auction: Pick<AuctionBiddingState, 'currency' | 'startPrice' | 'reservePrice'>,
  bids: readonly IncomingBid[],
): ReplayResult {
  let state = initialBiddingState(auction);
  const steps: ReplayStep[] = [];
  const resolved: ResolvedBid[] = [];
  for (const bid of bids) {
    const result = resolve(state, bid);
    steps.push({ bid, result });
    if (result.accepted) {
      state = result.state;
      resolved.push(...result.bids);
    }
  }
  return { state, steps, bids: resolved };
}

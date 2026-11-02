'use client';

// Listy Moje Biddy na żywo (F-21): zdarzenia użytkownika odświeżają listy, a aktywne aukcje
// na liście aktualizują cenę, liczbę ofert i koniec z kanału aukcji (F-17).
import {
  getGetMyAuctionsQueryKey,
  getGetMyBidsQueryKey,
  getGetMyWatchlistQueryKey,
} from '@biddy/api-client';
import type { AuctionUpdatedEvent } from '@biddy/realtime';
import { type QueryKey, useQueryClient } from '@tanstack/react-query';

import { useAuctionChannel, useUserRealtimeEvents } from '@/lib/realtime/realtime-provider';

/** Przedrostek kluczy list licytacji (wszystkie filtry i strony). */
export const MY_BIDS_KEY: QueryKey = [getGetMyBidsQueryKey()[0]];

/** Przebicie, wygrana albo nowe powiadomienie: odśwież listy Moje Biddy. */
export function useMyBiddyRealtime(): void {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: MY_BIDS_KEY });
    void queryClient.invalidateQueries({ queryKey: getGetMyWatchlistQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetMyAuctionsQueryKey() });
  };
  useUserRealtimeEvents({ onOutbid: refresh, onWon: refresh, onNotification: refresh });
}

/**
 * Nowy stan aukcji w każdej karcie o tym ID w danych zapytania (dowolnie zagnieżdżonych): karty
 * list licytującego (`price`) i aukcje sprzedającego (`AuctionSummaryDto`, bez `price`).
 */
export function patch(data: unknown, event: AuctionUpdatedEvent): unknown {
  if (Array.isArray(data)) {
    return data.map((entry) => patch(entry, event));
  }
  if (typeof data !== 'object' || data === null) {
    return data;
  }
  const record = data as Record<string, unknown>;
  if (record['id'] === event.auctionId && 'bidCount' in record && 'currentPrice' in record) {
    return {
      ...record,
      ...('price' in record ? { price: event.currentPrice ?? record['price'] } : {}),
      currentPrice: event.currentPrice,
      bidCount: event.bidCount,
      endsAt: event.endsAt,
    };
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, patch(value, event)]),
  );
}

/** Subskrypcja kanału aktywnej aukcji z listy; zmiany trafiają do danych list. */
export function useLiveCard(auctionId: string, active: boolean, keys: readonly QueryKey[]): void {
  const queryClient = useQueryClient();
  useAuctionChannel(active ? auctionId : undefined, {
    onUpdated: (event) => {
      for (const queryKey of keys) {
        queryClient.setQueriesData({ queryKey }, (data: unknown) => patch(data, event));
      }
    },
    onEnded: () => {
      for (const queryKey of keys) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}

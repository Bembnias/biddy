'use client';

// Stan aukcji na stronie (F-18): widok z API w TanStack Query (start: HTML z ISR), zdarzenia na
// żywo (F-17) scalane według `version`, stan zalogowanego użytkownika i tykający czas serwera.
import {
  type PublicAuctionDto,
  getAuction,
  getGetAuctionQueryKey,
  getGetBidHistoryQueryKey,
  getGetMyBiddingQueryKey,
  useGetMyBidding,
  useGetSession,
} from '@biddy/api-client';
import type { AuctionExtendedEvent, UserOutbidEvent } from '@biddy/realtime';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import { useServerClock } from '@/components/providers/server-clock-provider';
import { applyAuctionEnded, applyAuctionUpdate } from '@/lib/auction/auction-state';
import { useAuctionChannel, useUserRealtimeEvents } from '@/lib/realtime/realtime-provider';

/**
 * Widok aukcji. HTML z ISR mógł się zestarzeć (do 60 s), więc po hydracji pobieramy go od razu
 * (`initialDataUpdatedAt: 0`); dalej aktualizują go zdarzenia na żywo. Odpowiedź REST wysłana
 * przed zdarzeniem może przyjść po nim, więc stanu ze starszą `version` nie przyjmujemy.
 */
export function useAuction(initial: PublicAuctionDto): PublicAuctionDto {
  const queryClient = useQueryClient();
  const queryKey = getGetAuctionQueryKey(initial.publicId);
  const { data } = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const fresh = await getAuction(initial.publicId, { signal });
      const current = queryClient.getQueryData<PublicAuctionDto>(queryKey);
      return current !== undefined && current.version > fresh.version ? current : fresh;
    },
    initialData: initial,
    initialDataUpdatedAt: 0,
    staleTime: 30_000,
  });
  return data;
}

/** Odświeża wszystko, co strona aukcji pobiera z API (po reconnect, zakończeniu, ofercie). */
export function useRefreshAuction(auction: Pick<PublicAuctionDto, 'id' | 'publicId'>) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetAuctionQueryKey(auction.publicId) }),
      queryClient.invalidateQueries({ queryKey: getGetMyBiddingQueryKey(auction.publicId) }),
      queryClient.invalidateQueries({ queryKey: getGetBidHistoryQueryKey(auction.id) }),
    ]);
  };
}

/**
 * Subskrypcja zdarzeń aukcji i użytkownika. `notify` dostaje zdarzenia, o których panel mówi
 * (przebicie, przedłużenie, koniec).
 */
export function useLiveAuction(
  auction: PublicAuctionDto,
  signedIn: boolean,
  notify: (
    notice:
      | { readonly kind: 'outbid'; readonly event: UserOutbidEvent }
      | { readonly kind: 'extended'; readonly event: AuctionExtendedEvent }
      | { readonly kind: 'ended' },
  ) => void,
): void {
  const queryClient = useQueryClient();
  const refresh = useRefreshAuction(auction);
  const key = getGetAuctionQueryKey(auction.publicId);

  useAuctionChannel(auction.id, {
    onUpdated: (event) => {
      queryClient.setQueryData<PublicAuctionDto>(key, (current) =>
        current === undefined ? current : applyAuctionUpdate(current, event),
      );
    },
    onExtended: (event) => {
      notify({ kind: 'extended', event });
    },
    onEnded: (event) => {
      queryClient.setQueryData<PublicAuctionDto>(key, (current) =>
        current === undefined ? current : applyAuctionEnded(current, event),
      );
      notify({ kind: 'ended' });
      void refresh();
    },
    onResync: () => {
      void refresh();
    },
  });

  useUserRealtimeEvents(
    {
      onOutbid: (event) => {
        if (event.auctionId === auction.id) {
          notify({ kind: 'outbid', event });
          void queryClient.invalidateQueries({
            queryKey: getGetMyBiddingQueryKey(auction.publicId),
          });
        }
      },
      onWon: (event) => {
        if (event.auctionId === auction.id) {
          void refresh();
        }
      },
    },
    signedIn,
  );
}

/** Zalogowany użytkownik (null: gość, undefined: jeszcze nie wiadomo) i jego stan w aukcji. */
export function useBidder(publicId: string) {
  const session = useGetSession({ query: { staleTime: 60_000, retry: false } });
  const user = session.isPending ? undefined : (session.data?.user ?? null);
  const bidding = useGetMyBidding(publicId, {
    query: { enabled: user !== undefined && user !== null, retry: false },
  });
  return { user, bidding: bidding.data };
}

const secondListeners = new Set<() => void>();
let secondTimer: ReturnType<typeof setInterval> | undefined;

/** Jeden zegar co sekundę dla wszystkich liczników na stronie (np. 24 karty w wynikach). */
function subscribeSeconds(callback: () => void): () => void {
  secondListeners.add(callback);
  secondTimer ??= setInterval(() => {
    for (const listener of secondListeners) {
      listener();
    }
  }, 1_000);
  return () => {
    secondListeners.delete(callback);
    if (secondListeners.size === 0) {
      clearInterval(secondTimer);
      secondTimer = undefined;
    }
  };
}

/**
 * Czas serwera (ms) odświeżany co sekundę; null przy renderowaniu na serwerze i przed hydracją,
 * żeby HTML nie zależał od zegara (licznik pojawia się w przeglądarce).
 */
export function useServerNow(): number | null {
  const { offset } = useServerClock();
  const second = useSyncExternalStore(
    subscribeSeconds,
    () => Math.floor(Date.now() / 1_000),
    () => null,
  );
  return second === null ? null : second * 1_000 + offset;
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { type ReactNode, createContext, useContext, useMemo } from 'react';

import { useRealtimeClockOffset } from '@/lib/realtime/realtime-provider';
import {
  CLOCK_OFFSET_QUERY_KEY,
  CLOCK_SYNC_INTERVAL_MS,
  measureClockOffset,
} from '@/lib/server-clock';

interface ServerClock {
  /** Przesunięcie zegara względem serwera (ms); 0, dopóki pomiar się nie uda. */
  readonly offset: number;
  /** Bieżący czas serwera (ms od epoki). */
  readonly now: () => number;
}

const ServerClockContext = createContext<ServerClock>({ offset: 0, now: () => Date.now() });

/**
 * Mierzy przesunięcie zegara po wejściu na stronę i co 5 minut. Gdy działa połączenie realtime
 * (F-17), bierze dokładniejszy pomiar z WebSocket (mediana kilku próbek, co minutę). Gdy API nie
 * odpowiada, przesunięcie zostaje 0 (czas urządzenia), bez ponowień zaśmiecających konsolę.
 */
export function ServerClockProvider({ children }: { readonly children: ReactNode }) {
  const realtimeOffset = useRealtimeClockOffset();
  const { data: restOffset = 0 } = useQuery({
    queryKey: CLOCK_OFFSET_QUERY_KEY,
    queryFn: ({ signal }) => measureClockOffset(signal),
    staleTime: CLOCK_SYNC_INTERVAL_MS,
    refetchInterval: CLOCK_SYNC_INTERVAL_MS,
    retry: false,
  });
  const offset = realtimeOffset ?? restOffset;
  const clock = useMemo<ServerClock>(() => ({ offset, now: () => Date.now() + offset }), [offset]);
  return <ServerClockContext value={clock}>{children}</ServerClockContext>;
}

/** Czas serwera dla liczników (np. do końca aukcji). */
export function useServerClock(): ServerClock {
  return useContext(ServerClockContext);
}

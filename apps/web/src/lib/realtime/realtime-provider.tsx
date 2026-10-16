'use client';

// Realtime w web (F-17): jeden klient @biddy/realtime na kartę, tworzony leniwie przy pierwszej
// subskrypcji (dynamiczny import, więc socket.io-client nie trafia do kodu stron bez realtime).
// Hooki subskrybują w efektach i kończą subskrypcję przy odmontowaniu.
import type {
  AuctionHandlers,
  RealtimeClient,
  RealtimeStatus,
  UserHandlers,
} from '@biddy/realtime';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';

import { config } from '@/config';

interface RealtimeContextValue {
  /** Klient (tworzony przy pierwszym wywołaniu). */
  readonly client: () => Promise<RealtimeClient>;
  readonly status: RealtimeStatus;
  /** Przesunięcie zegara serwera zmierzone przez WebSocket albo undefined. */
  readonly clockOffset: number | undefined;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

async function defaultClient(): Promise<RealtimeClient> {
  const { createRealtimeClient } = await import('@biddy/realtime');
  return createRealtimeClient({ url: config.apiUrl, withCredentials: true });
}

export function RealtimeProvider({
  children,
  createClient = defaultClient,
}: {
  readonly children: ReactNode;
  /** Fabryka klienta (testy). */
  readonly createClient?: () => Promise<RealtimeClient>;
}) {
  const [status, setStatus] = useState<RealtimeStatus>('idle');
  const [clockOffset, setClockOffset] = useState<number>();
  const pending = useRef<Promise<RealtimeClient> | null>(null);
  const created = useRef<RealtimeClient | null>(null);

  // Stabilna funkcja (zależy tylko od fabryki): zmiana statusu połączenia nie wymusza ponownych
  // subskrypcji w hookach.
  const client = useCallback(() => {
    pending.current ??= createClient().then((realtime) => {
      created.current = realtime;
      realtime.onStatus(setStatus);
      realtime.onClockOffset(setClockOffset);
      return realtime;
    });
    return pending.current;
  }, [createClient]);
  const value = useMemo<RealtimeContextValue>(
    () => ({ client, status, clockOffset }),
    [client, status, clockOffset],
  );

  useEffect(
    () => () => {
      created.current?.close();
      created.current = null;
      pending.current = null;
    },
    [],
  );

  return <RealtimeContext value={value}>{children}</RealtimeContext>;
}

function useRealtime(): RealtimeContextValue {
  const value = useContext(RealtimeContext);
  if (value === null) {
    throw new Error('useRealtime wymaga RealtimeProvider (AppProviders)');
  }
  return value;
}

/** Stan połączenia, np. do komunikatu „Łączenie…” w panelu licytacji (F-18). */
export function useRealtimeStatus(): RealtimeStatus {
  return useRealtime().status;
}

/** Przesunięcie zegara z WebSocket (dla ServerClockProvider); undefined bez providera i pomiaru. */
export function useRealtimeClockOffset(): number | undefined {
  return useContext(RealtimeContext)?.clockOffset;
}

/**
 * Zdarzenia aukcji na żywo. `onResync` po ponownym połączeniu: odśwież stan przez REST, bo
 * zdarzenia z czasu rozłączenia przepadły. Bez `auctionId` nic nie subskrybuje.
 */
export function useAuctionChannel(
  auctionId: string | undefined,
  handlers: AuctionHandlers & { readonly onResync?: () => void },
): void {
  const { client } = useRealtime();
  const onUpdated = useEffectEvent(
    (event: Parameters<NonNullable<AuctionHandlers['onUpdated']>>[0]) =>
      handlers.onUpdated?.(event),
  );
  const onExtended = useEffectEvent(
    (event: Parameters<NonNullable<AuctionHandlers['onExtended']>>[0]) =>
      handlers.onExtended?.(event),
  );
  const onEnded = useEffectEvent((event: Parameters<NonNullable<AuctionHandlers['onEnded']>>[0]) =>
    handlers.onEnded?.(event),
  );
  const onResync = useEffectEvent(() => handlers.onResync?.());

  useEffect(() => {
    if (auctionId === undefined) {
      return undefined;
    }
    let cancelled = false;
    const cleanups: (() => void)[] = [];
    void client().then((realtime) => {
      if (cancelled) {
        return;
      }
      cleanups.push(
        realtime.subscribeAuction(auctionId, {
          onUpdated: (event) => {
            onUpdated(event);
          },
          onExtended: (event) => {
            onExtended(event);
          },
          onEnded: (event) => {
            onEnded(event);
          },
        }),
        realtime.onReconnect(() => {
          onResync();
        }),
      );
    });
    return () => {
      cancelled = true;
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, [auctionId, client]);
}

/**
 * Zdarzenia zalogowanego użytkownika (przebicie, wygrana, nowe powiadomienie); serwer sam
 * dołącza room użytkownika.
 */
export function useUserRealtimeEvents(handlers: UserHandlers, enabled = true): void {
  const { client } = useRealtime();
  const onOutbid = useEffectEvent((event: Parameters<NonNullable<UserHandlers['onOutbid']>>[0]) =>
    handlers.onOutbid?.(event),
  );
  const onWon = useEffectEvent((event: Parameters<NonNullable<UserHandlers['onWon']>>[0]) =>
    handlers.onWon?.(event),
  );
  const onNotification = useEffectEvent(
    (event: Parameters<NonNullable<UserHandlers['onNotification']>>[0]) =>
      handlers.onNotification?.(event),
  );

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void client().then((realtime) => {
      if (!cancelled) {
        cleanup = realtime.onUserEvents({
          onOutbid: (event) => {
            onOutbid(event);
          },
          onWon: (event) => {
            onWon(event);
          },
          onNotification: (event) => {
            onNotification(event);
          },
        });
      }
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [client, enabled]);
}

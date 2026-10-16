// Klient realtime (F-17): Socket.IO z reconnectem, subskrypcje aukcji z licznikiem odwołań
// i ponowną subskrypcją po każdym połączeniu (nowe połączenie nie ma roomów), zdarzenia
// użytkownika, odświeżenie stanu po reconnect i synchronizacja zegara (§15.4). Bez Reacta:
// ten sam klient działa w web i w aplikacji Expo.
import { io, type Socket } from 'socket.io-client';

import { type ClockSample, clockSample, estimateClockOffset } from './clock.js';
import {
  type AuctionEndedEvent,
  type AuctionExtendedEvent,
  type AuctionUpdatedEvent,
  type ClientToServerEvents,
  REALTIME_PATH,
  type ServerToClientEvents,
  type UserOutbidEvent,
  type UserWonEvent,
  type NotificationNewEvent,
} from './events.js';

export type RealtimeSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting';

export interface AuctionHandlers {
  readonly onUpdated?: (event: AuctionUpdatedEvent) => void;
  readonly onExtended?: (event: AuctionExtendedEvent) => void;
  readonly onEnded?: (event: AuctionEndedEvent) => void;
}

export interface UserHandlers {
  readonly onOutbid?: (event: UserOutbidEvent) => void;
  readonly onWon?: (event: UserWonEvent) => void;
  /** Nowe powiadomienie (F-20). */
  readonly onNotification?: (event: NotificationNewEvent) => void;
}

export interface RealtimeClientOptions {
  /** Adres API (origin, bez ścieżki), np. https://api.biddy.pl. */
  readonly url: string;
  readonly path?: string;
  /** Token Bearer (aplikacja mobilna); web uwierzytelnia się ciasteczkiem sesji. */
  readonly token?: () => string | undefined;
  /** Ciasteczka przy połączeniu (web). Domyślnie true. */
  readonly withCredentials?: boolean;
  /** Liczba próbek zegara na pomiar i odstęp pomiarów. */
  readonly clockSamples?: number;
  readonly clockIntervalMs?: number;
  /** Fabryka gniazda (testy). */
  readonly socketFactory?: (url: string, options: Parameters<typeof io>[1]) => RealtimeSocket;
}

export interface RealtimeClient {
  readonly status: RealtimeStatus;
  /** Łączy, jeśli jeszcze nie (subskrypcje łączą same). */
  connect(): void;
  /** Zamyka połączenie i czyści subskrypcje. */
  close(): void;
  /** Zdarzenia aukcji; zwraca funkcję kończącą subskrypcję. */
  subscribeAuction(auctionId: string, handlers: AuctionHandlers): () => void;
  /** Zdarzenia zalogowanego użytkownika (room `user:{id}` dołącza serwer). */
  onUserEvents(handlers: UserHandlers): () => void;
  /** Wywoływane po każdym ponownym połączeniu: dociągnij stan przez REST. */
  onReconnect(callback: () => void): () => void;
  onStatus(callback: (status: RealtimeStatus) => void): () => void;
  /** Przesunięcie zegara serwera względem lokalnego (ms) albo undefined przed pomiarem. */
  clockOffset(): number | undefined;
  onClockOffset(callback: (offset: number) => void): () => void;
  /** Teraz według zegara serwera (ms od epoki); przed pomiarem: zegar lokalny. */
  serverNow(): number;
}

const PING_TIMEOUT_MS = 2_000;

function listeners<T>() {
  const set = new Set<T>();
  return {
    add(value: T): () => void {
      set.add(value);
      return () => {
        set.delete(value);
      };
    },
    forEach(callback: (value: T) => void): void {
      for (const value of [...set]) {
        callback(value);
      }
    },
    get size(): number {
      return set.size;
    },
  };
}

export function createRealtimeClient(options: RealtimeClientOptions): RealtimeClient {
  const clockSamples = options.clockSamples ?? 5;
  const clockIntervalMs = options.clockIntervalMs ?? 60_000;
  const auctions = new Map<string, Set<AuctionHandlers>>();
  const users = listeners<UserHandlers>();
  const reconnects = listeners<() => void>();
  const statuses = listeners<(status: RealtimeStatus) => void>();
  const clocks = listeners<(offset: number) => void>();
  let socket: RealtimeSocket | undefined;
  let status: RealtimeStatus = 'idle';
  let connectedBefore = false;
  let offset: number | undefined;
  let clockTimer: ReturnType<typeof setInterval> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const setStatus = (next: RealtimeStatus) => {
    if (next !== status) {
      status = next;
      statuses.forEach((callback) => {
        callback(next);
      });
    }
  };

  const ping = (current: RealtimeSocket) =>
    new Promise<ClockSample | undefined>((resolve) => {
      const sentAt = Date.now();
      current.timeout(PING_TIMEOUT_MS).emit('time:ping', (error, result) => {
        resolve(error === null ? clockSample(result.serverTime, sentAt, Date.now()) : undefined);
      });
    });

  const syncClock = async () => {
    const current = socket;
    if (current?.connected !== true) {
      return;
    }
    const samples: ClockSample[] = [];
    for (let index = 0; index < clockSamples; index += 1) {
      const sample = await ping(current);
      if (sample !== undefined) {
        samples.push(sample);
      }
    }
    const estimated = estimateClockOffset(samples);
    if (estimated !== undefined) {
      offset = estimated;
      clocks.forEach((callback) => {
        callback(estimated);
      });
    }
  };

  const subscribeOnServer = (auctionId: string) => {
    socket?.emit('auction:subscribe', auctionId, () => undefined);
  };

  const create = (): RealtimeSocket => {
    const socketOptions: Parameters<typeof io>[1] = {
      path: options.path ?? REALTIME_PATH,
      // Tylko WebSocket: long-polling wymagałby sticky sessions przy kilku instancjach API.
      transports: ['websocket'],
      withCredentials: options.withCredentials ?? true,
      autoConnect: false,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
      auth: (callback) => {
        const token = options.token?.();
        callback(token === undefined ? {} : { token });
      },
    };
    const created: RealtimeSocket =
      options.socketFactory?.(options.url, socketOptions) ?? io(options.url, socketOptions);
    created.on('connect', () => {
      setStatus('connected');
      for (const auctionId of auctions.keys()) {
        subscribeOnServer(auctionId);
      }
      if (connectedBefore) {
        reconnects.forEach((callback) => {
          callback();
        });
      }
      connectedBefore = true;
      void syncClock();
      clearInterval(clockTimer);
      clockTimer = setInterval(() => void syncClock(), clockIntervalMs);
    });
    created.on('disconnect', (reason) => {
      clearInterval(clockTimer);
      if (reason === 'io server disconnect' && !closed) {
        // Serwer zamyka połączenia przy wyłączaniu instancji (wdrożenie): Socket.IO wtedy sam nie
        // wraca, a my chcemy połączyć się z inną instancją.
        setStatus('reconnecting');
        reconnectTimer = setTimeout(() => {
          created.connect();
        }, created.io.reconnectionDelay());
        return;
      }
      setStatus(created.active ? 'reconnecting' : 'idle');
    });
    created.on('connect_error', () => {
      setStatus(created.active ? 'reconnecting' : 'idle');
    });
    const dispatch = <K extends keyof AuctionHandlers>(
      key: K,
      event: Parameters<NonNullable<AuctionHandlers[K]>>[0],
    ) => {
      for (const handlers of auctions.get(event.auctionId) ?? []) {
        (handlers[key] as ((value: typeof event) => void) | undefined)?.(event);
      }
    };
    created.on('auction.updated', (event) => {
      dispatch('onUpdated', event);
    });
    created.on('auction.extended', (event) => {
      dispatch('onExtended', event);
    });
    created.on('auction.ended', (event) => {
      dispatch('onEnded', event);
    });
    created.on('user.outbid', (event) => {
      users.forEach((handlers) => handlers.onOutbid?.(event));
    });
    created.on('user.won', (event) => {
      users.forEach((handlers) => handlers.onWon?.(event));
    });
    created.on('notification.new', (event) => {
      users.forEach((handlers) => handlers.onNotification?.(event));
    });
    return created;
  };

  const connect = () => {
    closed = false;
    socket ??= create();
    if (!socket.connected && !socket.active) {
      setStatus(connectedBefore ? 'reconnecting' : 'connecting');
      socket.connect();
    }
  };

  return {
    get status() {
      return status;
    },
    connect,
    close() {
      closed = true;
      clearInterval(clockTimer);
      clearTimeout(reconnectTimer);
      socket?.disconnect();
      socket?.removeAllListeners();
      socket = undefined;
      auctions.clear();
      connectedBefore = false;
      setStatus('idle');
    },
    subscribeAuction(auctionId, handlers) {
      const existing = auctions.get(auctionId);
      if (existing === undefined) {
        auctions.set(auctionId, new Set([handlers]));
        if (socket?.connected === true) {
          subscribeOnServer(auctionId);
        }
      } else {
        existing.add(handlers);
      }
      connect();
      return () => {
        const set = auctions.get(auctionId);
        set?.delete(handlers);
        if (set?.size === 0) {
          auctions.delete(auctionId);
          if (socket?.connected === true) {
            socket.emit('auction:unsubscribe', auctionId);
          }
        }
      };
    },
    onUserEvents(handlers) {
      const remove = users.add(handlers);
      connect();
      return remove;
    },
    onReconnect: (callback) => reconnects.add(callback),
    onStatus: (callback) => statuses.add(callback),
    clockOffset: () => offset,
    onClockOffset: (callback) => clocks.add(callback),
    serverNow: () => Date.now() + (offset ?? 0),
  };
}

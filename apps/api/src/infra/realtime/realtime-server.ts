// Serwer Socket.IO (F-17, PROJECT.md §10.5): na serwerze HTTP API, tylko WebSocket (bez
// long-pollingu, który wymagałby sticky sessions przy kilku instancjach), adapter Redis na
// instancji cache, więc zdarzenie z dowolnej instancji albo workera trafia do każdego klienta.
// W workerze (brak serwera HTTP) nic nie robi.
import type { IncomingMessage, Server as HttpServer } from 'node:http';

import type { ClientToServerEvents, ServerToClientEvents } from '@biddy/realtime';
import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { type AbstractHttpAdapter, HttpAdapterHost } from '@nestjs/core';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import { Server, type Socket } from 'socket.io';

import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { AuctionPresence, PRESENCE_REFRESH_MS } from './auction-presence.js';
import { REALTIME_AUTHENTICATOR, type RealtimeAuthenticator } from './realtime-authenticator.js';
import { closeCacheRedis, createCacheRedis, withHandledRejections } from './realtime-redis.js';
import {
  auctionRoom,
  MAX_AUCTION_SUBSCRIPTIONS,
  MAX_AUCTION_VIEWS,
  REALTIME_PATH,
  userRoom,
} from './rooms.js';

/** Liczbę oglądających aukcję wysyłamy najwyżej raz na tyle (F-63). */
export const VIEWERS_THROTTLE_MS = 5_000;

interface SocketData {
  /** Zalogowany użytkownik albo null (połączenie anonimowe). */
  userId: string | null;
  /** Aukcje, których stronę to połączenie ogląda (F-63). */
  views: Set<string>;
}

type RealtimeIo = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
type RealtimeSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

@Injectable()
export class RealtimeServer
  implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown
{
  private readonly logger = new Logger(RealtimeServer.name);
  private io: RealtimeIo | undefined;
  private readonly redis: Redis[] = [];
  private presence: AuctionPresence | undefined;
  private presenceTimer: ReturnType<typeof setInterval> | undefined;
  /** Ostatnio wysłana liczba oglądających i kiedy (throttling na instancję). */
  private readonly viewersSent = new Map<string, { readonly at: number; readonly count: number }>();
  private readonly viewersPending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REALTIME_AUTHENTICATOR) private readonly authenticator: RealtimeAuthenticator,
    @Optional() private readonly adapterHost?: HttpAdapterHost,
  ) {}

  onApplicationBootstrap(): void {
    // W workerze (createApplicationContext) HttpAdapterHost istnieje, ale bez adaptera.
    const adapter = this.adapterHost?.httpAdapter as AbstractHttpAdapter | null | undefined;
    if (adapter === null || adapter === undefined) {
      return;
    }
    const pub = createCacheRedis(this.config.cache.redisUrl, 'realtime-pub');
    const sub = createCacheRedis(this.config.cache.redisUrl, 'realtime-sub', {
      waitForConnection: true,
    });
    const presenceRedis = createCacheRedis(this.config.cache.redisUrl, 'realtime-presence');
    this.redis.push(pub, sub, presenceRedis);
    this.presence = new AuctionPresence(presenceRedis);
    const io: RealtimeIo = new Server(adapter.getHttpServer() as HttpServer, {
      path: REALTIME_PATH,
      transports: ['websocket'],
      serveClient: false,
      adapter: createAdapter(withHandledRejections(pub), withHandledRejections(sub)),
      allowRequest: (request, callback) => {
        callback(null, this.originAllowed(request));
      },
    });
    io.use((socket, next) => {
      socket.data.views = new Set();
      const auth = socket.handshake.auth as { token?: unknown };
      const token = typeof auth.token === 'string' && auth.token !== '' ? auth.token : undefined;
      this.authenticator.authenticate(socket.request.headers, token).then(
        (userId) => {
          socket.data.userId = userId;
          next();
        },
        (error: unknown) => {
          this.logger.warn({ err: error }, 'Nie udało się sprawdzić sesji połączenia WebSocket');
          next(new Error('Nie udało się sprawdzić sesji'));
        },
      );
    });
    io.on('connection', (socket) => {
      this.onConnection(socket);
    });
    this.io = io;
    this.presenceTimer = setInterval(() => {
      void this.refreshPresence();
    }, PRESENCE_REFRESH_MS);
    this.presenceTimer.unref();
  }

  /**
   * Przed zamknięciem serwera HTTP: otwarte połączenia WebSocket blokowałyby jego zamknięcie.
   * Klienci dostają rozłączenie od serwera i łączą się z inną instancją (@biddy/realtime).
   */
  async beforeApplicationShutdown(): Promise<void> {
    const io = this.io;
    if (io === undefined) {
      return;
    }
    this.io = undefined;
    clearInterval(this.presenceTimer);
    for (const timer of this.viewersPending.values()) {
      clearTimeout(timer);
    }
    this.viewersPending.clear();
    // Oglądający z tej instancji wypadają z liczników (inne instancje wyślą nowe liczby).
    await Promise.all(
      [...io.of('/').sockets.values()].flatMap((socket) =>
        [...socket.data.views].map((auctionId) => this.unview(socket, auctionId, false)),
      ),
    );
    io.local.disconnectSockets(true);
    io.engine.close();
    await Promise.resolve(io.of('/').adapter.close());
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.redis.map((redis) => closeCacheRedis(redis)));
  }

  /**
   * Ochrona przed cross-site WebSocket hijacking: przeglądarka wysyła Origin, a ciasteczko sesji
   * przyjmujemy tylko z originów aplikacji (CORS_ORIGINS). Klient bez Origin (aplikacja mobilna,
   * serwer) uwierzytelnia się tokenem.
   */
  private originAllowed(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    return origin === undefined || this.config.http.corsOrigins.includes(origin);
  }

  private onConnection(socket: RealtimeSocket): void {
    const { userId } = socket.data;
    if (userId !== null) {
      // Room użytkownika dołącza tylko serwer: klient nie wybiera, czyje zdarzenia dostaje.
      void socket.join(userRoom(userId));
    }
    socket.on('auction:subscribe', (auctionId, ack) => {
      const reply = typeof ack === 'function' ? ack : () => undefined;
      if (typeof auctionId !== 'string' || !UUID.test(auctionId)) {
        reply({ ok: false, error: 'INVALID_AUCTION_ID' });
        return;
      }
      const room = auctionRoom(auctionId);
      const auctionRooms = [...socket.rooms].filter((name) => name.startsWith('auction:'));
      if (!socket.rooms.has(room) && auctionRooms.length >= MAX_AUCTION_SUBSCRIPTIONS) {
        reply({ ok: false, error: 'TOO_MANY_SUBSCRIPTIONS' });
        return;
      }
      void socket.join(room);
      reply({ ok: true });
    });
    socket.on('auction:unsubscribe', (auctionId) => {
      if (typeof auctionId === 'string' && UUID.test(auctionId)) {
        void socket.leave(auctionRoom(auctionId));
      }
    });
    socket.on('auction:view', (auctionId, ack) => {
      const reply = typeof ack === 'function' ? ack : () => undefined;
      if (typeof auctionId !== 'string' || !UUID.test(auctionId)) {
        reply({ ok: false, error: 'INVALID_AUCTION_ID' });
        return;
      }
      const { views } = socket.data;
      if (!views.has(auctionId) && views.size >= MAX_AUCTION_VIEWS) {
        reply({ ok: false, error: 'TOO_MANY_VIEWS' });
        return;
      }
      views.add(auctionId);
      void this.view(socket, auctionId).then((viewers) => {
        reply({ ok: true, viewers });
      });
    });
    socket.on('auction:unview', (auctionId) => {
      if (typeof auctionId === 'string' && socket.data.views.has(auctionId)) {
        void this.unview(socket, auctionId, true);
      }
    });
    socket.on('disconnect', () => {
      for (const auctionId of socket.data.views) {
        void this.unview(socket, auctionId, true);
      }
    });
    socket.on('time:ping', (ack) => {
      if (typeof ack === 'function') {
        ack({ serverTime: new Date().toISOString() });
      }
    });
  }

  /** Połączenie ogląda aukcję; liczba oglądających (0 przy błędzie Redisa). */
  private async view(socket: RealtimeSocket, auctionId: string): Promise<number> {
    try {
      const count = (await this.presence?.add(auctionId, socket.id)) ?? 0;
      this.scheduleViewers(auctionId);
      return count;
    } catch (error) {
      this.logger.warn({ err: error }, 'Nie udało się zapisać oglądającego aukcję');
      return 0;
    }
  }

  private async unview(socket: RealtimeSocket, auctionId: string, announce: boolean) {
    socket.data.views.delete(auctionId);
    try {
      await this.presence?.remove(auctionId, socket.id);
      if (announce) {
        this.scheduleViewers(auctionId);
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'Nie udało się usunąć oglądającego aukcję');
    }
  }

  /** Potwierdza obecność oglądających z tej instancji i odświeża liczby (wpisy po awariach). */
  private async refreshPresence(): Promise<void> {
    const io = this.io;
    if (io === undefined || this.presence === undefined) {
      return;
    }
    const entries = [...io.of('/').sockets.values()].flatMap((socket) =>
      [...socket.data.views].map((auctionId) => ({ auctionId, member: socket.id })),
    );
    try {
      await this.presence.refresh(entries);
    } catch (error) {
      this.logger.warn({ err: error }, 'Nie udało się odświeżyć oglądających aukcje');
      return;
    }
    for (const auctionId of new Set(entries.map((entry) => entry.auctionId))) {
      this.scheduleViewers(auctionId);
    }
  }

  /**
   * Wysyła liczbę oglądających do roomu aukcji najwyżej raz na VIEWERS_THROTTLE_MS i tylko po
   * zmianie; liczbę czyta w chwili wysłania, więc seria zmian daje jedno zdarzenie.
   */
  private scheduleViewers(auctionId: string): void {
    if (this.viewersPending.has(auctionId) || this.io === undefined) {
      return;
    }
    const last = this.viewersSent.get(auctionId);
    const delay = last === undefined ? 0 : Math.max(0, last.at + VIEWERS_THROTTLE_MS - Date.now());
    const timer = setTimeout(() => {
      this.viewersPending.delete(auctionId);
      void this.sendViewers(auctionId);
    }, delay);
    timer.unref();
    this.viewersPending.set(auctionId, timer);
  }

  private async sendViewers(auctionId: string): Promise<void> {
    const io = this.io;
    if (io === undefined || this.presence === undefined) {
      return;
    }
    let count: number;
    try {
      count = await this.presence.count(auctionId);
    } catch (error) {
      this.logger.warn({ err: error }, 'Nie udało się policzyć oglądających aukcję');
      return;
    }
    if (this.viewersSent.get(auctionId)?.count === count) {
      return;
    }
    if (count === 0) {
      this.viewersSent.delete(auctionId);
    } else {
      this.viewersSent.set(auctionId, { at: Date.now(), count });
    }
    io.to(auctionRoom(auctionId)).emit('auction.viewers', {
      auctionId,
      count,
      serverTime: new Date().toISOString(),
    });
  }
}

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
import { REALTIME_AUTHENTICATOR, type RealtimeAuthenticator } from './realtime-authenticator.js';
import { closeCacheRedis, createCacheRedis, withHandledRejections } from './realtime-redis.js';
import { auctionRoom, MAX_AUCTION_SUBSCRIPTIONS, REALTIME_PATH, userRoom } from './rooms.js';

interface SocketData {
  /** Zalogowany użytkownik albo null (połączenie anonimowe). */
  userId: string | null;
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
    this.redis.push(pub, sub);
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
    socket.on('time:ping', (ack) => {
      if (typeof ack === 'function') {
        ack({ serverTime: new Date().toISOString() });
      }
    });
  }
}

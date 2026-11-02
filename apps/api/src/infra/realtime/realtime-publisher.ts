// Publikacja zdarzeń na żywo (F-17) z API i workera przez Redis (emitter Socket.IO): trafiają
// do klientów połączonych z każdą instancją API. Wołane zaraz po zatwierdzeniu transakcji.
// Najlepszy wysiłek: błąd Redisa trafia do logów i nie psuje operacji (klient po reconnect
// dociąga stan przez REST).
import type { ServerToClientEvents } from '@biddy/realtime';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Emitter } from '@socket.io/redis-emitter';
import type { Redis } from 'ioredis';

import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { closeCacheRedis, createCacheRedis, withHandledRejections } from './realtime-redis.js';
import { auctionRoom, userRoom } from './rooms.js';

type EventName = keyof ServerToClientEvents;
type Payload<E extends EventName> = Parameters<ServerToClientEvents[E]>[0];

/** Zdarzenie do wysłania: room aukcji albo użytkownika. */
export type RealtimeMessage = {
  [E in EventName]:
    | { readonly auctionId: string; readonly event: E; readonly payload: Payload<E> }
    | { readonly userId: string; readonly event: E; readonly payload: Payload<E> };
}[EventName];

@Injectable()
export class RealtimePublisher implements OnApplicationShutdown {
  private readonly logger = new Logger(RealtimePublisher.name);
  private redis: Redis | undefined;
  private emitter: Emitter<ServerToClientEvents> | undefined;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Wysyła zdarzenia; nigdy nie rzuca (błędy w logach). */
  publish(...messages: readonly RealtimeMessage[]): void {
    for (const message of messages) {
      try {
        const room =
          'auctionId' in message ? auctionRoom(message.auctionId) : userRoom(message.userId);
        (this.client().to(room).emit as (event: string, payload: unknown) => boolean)(
          message.event,
          message.payload,
        );
      } catch (error) {
        this.logger.warn(
          { err: error, event: message.event },
          'Nie udało się wysłać zdarzenia na żywo',
        );
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.redis !== undefined) {
      await closeCacheRedis(this.redis);
    }
  }

  private client(): Emitter<ServerToClientEvents> {
    if (this.emitter === undefined) {
      const redis = createCacheRedis(this.config.cache.redisUrl, 'realtime-emitter');
      this.redis = redis;
      // Emitter wywołuje publish bez obsługi błędu: nieobsłużone odrzucenie zakończyłoby proces.
      this.emitter = new Emitter<ServerToClientEvents>(withHandledRejections(redis));
    }
    return this.emitter;
  }
}

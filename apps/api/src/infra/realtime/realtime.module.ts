import { Global, Module } from '@nestjs/common';

import { RealtimePublisher } from './realtime-publisher.js';
import { RealtimeServer } from './realtime-server.js';

/**
 * Realtime (F-17): publikacja zdarzeń (API i worker) i serwer Socket.IO (tylko API). Globalny,
 * bo zdarzenia wysyłają różne moduły domenowe. Uwierzytelnienie połączeń dostarcza moduł
 * identity (token REALTIME_AUTHENTICATOR).
 */
@Global()
@Module({
  providers: [RealtimePublisher, RealtimeServer],
  exports: [RealtimePublisher],
})
export class RealtimeModule {}

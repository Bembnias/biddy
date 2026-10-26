// Publiczne API infrastruktury realtime (F-17).
export { REALTIME_AUTHENTICATOR, type RealtimeAuthenticator } from './realtime-authenticator.js';
export { type RealtimeMessage, RealtimePublisher } from './realtime-publisher.js';
export { RealtimeModule } from './realtime.module.js';
export {
  MAX_AUCTION_SUBSCRIPTIONS,
  MAX_AUCTION_VIEWS,
  REALTIME_PATH,
  auctionRoom,
  userRoom,
} from './rooms.js';
export { AuctionPresence, PRESENCE_STALE_MS, presenceKey } from './auction-presence.js';

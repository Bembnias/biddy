// Nazwy roomów i stałe protokołu realtime: te same co w @biddy/realtime (API importuje z pakietu
// tylko typy; zgodność pilnuje test realtime-protocol.test.ts).

export const REALTIME_PATH = '/v1/realtime';
export const MAX_AUCTION_SUBSCRIPTIONS = 50;
export const MAX_AUCTION_VIEWS = 5;

export function auctionRoom(auctionId: string): string {
  return `auction:${auctionId}`;
}

export function userRoom(userId: string): string {
  return `user:${userId}`;
}

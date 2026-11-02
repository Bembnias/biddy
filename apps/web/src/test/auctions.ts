// Dane aukcji do testów strony aukcji (F-18).
import type { PublicAuctionDto } from '@biddy/api-client';
import type { AuctionUpdatedEvent } from '@biddy/realtime';

export const AUCTION_ID = '01960000-0000-7000-8000-0000000000a1';
export const SELLER_ID = '01960000-0000-7000-8000-0000000000b1';

/** Aktywna aukcja bez ofert, z Kup teraz, kończy się za `endsInMs`. */
export function publicAuction(
  overrides: Partial<PublicAuctionDto> = {},
  endsInMs = 3 * 24 * 60 * 60 * 1000,
): PublicAuctionDto {
  return {
    id: AUCTION_ID,
    publicId: 'k3x9qa7m',
    slug: 'wazon-ceramiczny',
    status: 'ACTIVE',
    currency: 'PLN',
    title: 'Wazon ceramiczny',
    description: 'Ręcznie malowany wazon, bez pęknięć.',
    condition: 'VERY_GOOD',
    brand: null,
    category: [
      { id: '01960000-0000-7000-8000-0000000000c1', slug: 'dom', name: 'Dom i ogród' },
      { id: '01960000-0000-7000-8000-0000000000c2', slug: 'dekoracje', name: 'Dekoracje' },
    ],
    attributes: [],
    photos: [
      {
        id: '01960000-0000-7000-8000-0000000000d1',
        urls: {
          thumb: 'https://media.test/1-thumb.webp',
          medium: 'https://media.test/1-medium.webp',
          large: 'https://media.test/1-large.webp',
        },
      },
    ],
    packageSize: 'M',
    carriers: [
      { id: 'inpost-paczkomat', name: 'InPost Paczkomat 24/7', kind: 'LOCKER', price: 1_399 },
    ],
    shippingFrom: 1_399,
    seller: {
      id: SELLER_ID,
      name: 'Sprzedawca Testowy',
      avatarUrl: null,
      memberSince: '2026-01-10T10:00:00.000Z',
      phoneVerified: true,
      kind: 'PRIVATE',
    },
    startPrice: 2_000,
    currentPrice: null,
    bidCount: 0,
    leader: null,
    minimumNextBid: 2_000,
    reserveStatus: 'NONE',
    buyNowPrice: 10_000,
    buyNowAvailable: true,
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    endsAt: new Date(Date.now() + endsInMs).toISOString(),
    version: 1,
    extensionWindowSeconds: 120,
    serverTime: new Date().toISOString(),
    ...overrides,
  };
}

/** Zdarzenie `auction.updated` po ofercie. */
export function auctionUpdated(
  auction: PublicAuctionDto,
  overrides: Partial<AuctionUpdatedEvent> = {},
): AuctionUpdatedEvent {
  return {
    auctionId: auction.id,
    version: auction.version + 1,
    status: 'ACTIVE',
    currency: 'PLN',
    currentPrice: 3_000,
    bidCount: auction.bidCount + 1,
    leader: { publicName: 'k***a' },
    endsAt: auction.endsAt,
    reserveStatus: auction.reserveStatus,
    minimumNextBid: 3_100,
    buyNowAvailable: false,
    serverTime: new Date().toISOString(),
    ...overrides,
  };
}

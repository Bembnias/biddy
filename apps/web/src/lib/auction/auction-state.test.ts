import { describe, expect, it } from 'vitest';

import { auctionUpdated, publicAuction } from '@/test/auctions';

import {
  applyAuctionEnded,
  applyAuctionUpdate,
  auctionPhase,
  parseBidAmount,
  remainingParts,
} from './auction-state';

describe('zdarzenia na żywo', () => {
  it('auction.updated z nowszą wersją zmienia cenę, liderów i Kup teraz', () => {
    const auction = publicAuction();
    const next = applyAuctionUpdate(auction, auctionUpdated(auction));
    expect(next).toMatchObject({
      currentPrice: 3_000,
      bidCount: 1,
      leader: { publicName: 'k***a' },
      minimumNextBid: 3_100,
      buyNowAvailable: false,
      buyNowPrice: null,
      version: 2,
    });
  });

  it('starsza albo ta sama wersja i inna aukcja: bez zmian', () => {
    const auction = publicAuction({ version: 5 });
    expect(applyAuctionUpdate(auction, auctionUpdated(auction, { version: 5 }))).toBe(auction);
    expect(applyAuctionUpdate(auction, auctionUpdated(auction, { version: 4 }))).toBe(auction);
    expect(
      applyAuctionUpdate(auction, auctionUpdated(auction, { auctionId: 'inna', version: 9 })),
    ).toBe(auction);
  });

  it('auction.ended: status z wyniku, bez formularza i Kup teraz', () => {
    const auction = publicAuction();
    const event = {
      auctionId: auction.id,
      currency: 'PLN',
      serverTime: new Date().toISOString(),
    } as const;
    expect(
      applyAuctionEnded(auction, { ...event, outcome: 'SOLD', finalPrice: 10_000 }),
    ).toMatchObject({ status: 'ENDED_SOLD', minimumNextBid: null, buyNowAvailable: false });
    expect(
      applyAuctionEnded(auction, { ...event, outcome: 'CANCELLED', finalPrice: null }).status,
    ).toBe('CANCELLED');
  });
});

describe('auctionPhase', () => {
  const now = Date.parse('2026-10-15T12:00:00.000Z');
  const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();

  it('aktywna, końcówka w oknie anti-snipingu, kończenie po czasie', () => {
    const auction = publicAuction({ startsAt: at(-60_000), extensionWindowSeconds: 120 });
    expect(auctionPhase({ ...auction, endsAt: at(121_000) }, now)).toBe('active');
    expect(auctionPhase({ ...auction, endsAt: at(120_000) }, now)).toBe('ending');
    expect(auctionPhase({ ...auction, endsAt: at(0) }, now)).toBe('closing');
    expect(auctionPhase({ ...auction, startsAt: at(60_000) }, now)).toBe('scheduled');
  });

  it('bez czasu (renderowanie na serwerze) aktywna; zakończone według statusu', () => {
    expect(auctionPhase(publicAuction({ endsAt: at(1_000) }), null)).toBe('active');
    expect(auctionPhase(publicAuction({ status: 'ENDED_SOLD' }), now)).toBe('sold');
    expect(auctionPhase(publicAuction({ status: 'ENDED_UNSOLD' }), now)).toBe('unsold');
    expect(auctionPhase(publicAuction({ status: 'CANCELLED' }), null)).toBe('cancelled');
  });
});

describe('remainingParts', () => {
  it('dni i godziny, godziny i minuty, w ostatniej godzinie minuty i sekundy', () => {
    expect(remainingParts((2 * 24 + 4) * 3_600_000 + 59_000)).toEqual({
      kind: 'days',
      days: 2,
      hours: 4,
    });
    expect(remainingParts(3 * 3_600_000 + 12 * 60_000)).toEqual({
      kind: 'hours',
      hours: 3,
      minutes: 12,
    });
    expect(remainingParts(12 * 60_000 + 3_200)).toEqual({
      kind: 'minutes',
      minutes: 12,
      seconds: 4,
    });
    expect(remainingParts(-5_000)).toEqual({ kind: 'minutes', minutes: 0, seconds: 0 });
  });
});

describe('parseBidAmount', () => {
  it('złote z przecinkiem, spacjami i „zł” na grosze', () => {
    expect(parseBidAmount('120')).toBe(12_000);
    expect(parseBidAmount('120,50')).toBe(12_050);
    expect(parseBidAmount('1 200 zł')).toBe(120_000);
  });

  it('puste, niepoprawne i zero', () => {
    expect(parseBidAmount('  ')).toBe('empty');
    expect(parseBidAmount('sto')).toBe('invalid');
    expect(parseBidAmount('12,345')).toBe('invalid');
    expect(parseBidAmount('0')).toBe('invalid');
  });
});

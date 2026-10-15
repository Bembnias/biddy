import { describe, expect, it } from 'vitest';

import {
  AUCTION_SLUG_MAX_LENGTH,
  auctionCacheTag,
  auctionPath,
  auctionSlug,
  parseAuctionPath,
} from '../index.js';

describe('auctionSlug', () => {
  it('polskie znaki bez ogonków, małe litery i myślniki', () => {
    expect(auctionSlug('Żółta kurtka, rozmiar M')).toBe('zolta-kurtka-rozmiar-m');
    expect(auctionSlug('Łódź: ŚWIEŻE ćmy — 100% bawełna')).toBe('lodz-swieze-cmy-100-bawelna');
    expect(auctionSlug('  Nike Air Max 90 (42)  ')).toBe('nike-air-max-90-42');
  });

  it('pusty albo bez liter i cyfr: „aukcja”', () => {
    expect(auctionSlug('')).toBe('aukcja');
    expect(auctionSlug(null)).toBe('aukcja');
    expect(auctionSlug('🔥🔥 !!!')).toBe('aukcja');
  });

  it('najwyżej 60 znaków, cięcie na granicy słowa', () => {
    const slug = auctionSlug(
      'Konsola Nintendo Switch OLED z dwoma padami, etui i trzema grami w zestawie',
    );
    expect(slug).toBe('konsola-nintendo-switch-oled-z-dwoma-padami-etui-i-trzema');
    expect(slug.length).toBeLessThanOrEqual(AUCTION_SLUG_MAX_LENGTH);
    expect(auctionSlug('a'.repeat(100))).toBe('a'.repeat(AUCTION_SLUG_MAX_LENGTH));
  });
});

describe('ścieżka aukcji', () => {
  it('buduje i rozpoznaje ścieżkę', () => {
    expect(auctionPath('nike-air-max-90', 'k3x9qa7m')).toBe('/a/nike-air-max-90-k3x9qa7m');
    expect(parseAuctionPath('nike-air-max-90-k3x9qa7m')).toEqual({
      slug: 'nike-air-max-90',
      publicId: 'k3x9qa7m',
    });
    expect(parseAuctionPath('k3x9qa7m')).toEqual({ slug: '', publicId: 'k3x9qa7m' });
  });

  it('odrzuca segment bez poprawnego identyfikatora', () => {
    expect(parseAuctionPath('nike-air-max-90')).toBeNull();
    expect(parseAuctionPath('nike-k3x9qa7')).toBeNull();
    // i, l, o, 0 i 1 nie występują w identyfikatorach.
    expect(parseAuctionPath('nike-k3x9qa7l')).toBeNull();
    expect(parseAuctionPath('nike-K3X9QA7M')).toBeNull();
    expect(parseAuctionPath('')).toBeNull();
  });

  it('tag cache strony', () => {
    expect(auctionCacheTag('k3x9qa7m')).toBe('auction:k3x9qa7m');
  });
});

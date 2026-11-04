import { describe, expect, it } from 'vitest';

import { auctionStartBlocker, messagePreview, PREVIEW_LENGTH } from './conversation-rules.js';

describe('auctionStartBlocker', () => {
  const base = { userId: 'u', sellerId: 's', auctionStatus: 'ACTIVE', hasOrder: false };

  it('pozwala pytać o aktywną aukcję', () => {
    expect(auctionStartBlocker(base)).toBeNull();
  });

  it('nie pozwala pisać o własnej aukcji', () => {
    expect(auctionStartBlocker({ ...base, userId: 's' })).toBe('OWN_AUCTION');
  });

  it('po końcu aukcji tylko z zamówieniem pary', () => {
    expect(auctionStartBlocker({ ...base, auctionStatus: 'ENDED_UNSOLD' })).toBe('AUCTION_CLOSED');
    expect(
      auctionStartBlocker({ ...base, auctionStatus: 'ENDED_SOLD', hasOrder: true }),
    ).toBeNull();
  });
});

describe('messagePreview', () => {
  it('skraca białe znaki do jednej linii', () => {
    expect(messagePreview('  Dzień dobry,\n\ncz  jest rysa?  ')).toBe('Dzień dobry, cz jest rysa?');
  });

  it('ucina długą treść na granicy słowa z wielokropkiem', () => {
    const preview = messagePreview(`${'słowo '.repeat(40)}koniec`);
    expect(preview.length).toBeLessThanOrEqual(PREVIEW_LENGTH);
    expect(preview.endsWith('słowo…')).toBe(true);
  });
});

import type { AuctionSummaryDto } from '@biddy/api-client';
import { describe, expect, it } from 'vitest';

import { type MyBidEntry, bidRow, saleRow, watchRow } from './next-action';

const date = (iso: string) => `[${iso.slice(0, 10)}]`;

const AUCTION: MyBidEntry['auction'] = {
  id: '01960000-0000-7000-8000-0000000000a1',
  publicId: 'k3x9qa7m',
  slug: 'wazon',
  title: 'Wazon',
  status: 'ACTIVE',
  currency: 'PLN',
  price: 3_100,
  currentPrice: 3_100,
  bidCount: 2,
  endsAt: '2026-10-20T18:00:00.000Z',
  coverUrl: null,
  coverThumbUrl: null,
};

function entry(overrides: Partial<MyBidEntry> = {}): MyBidEntry {
  return {
    auction: AUCTION,
    maxAmount: 5_000,
    leading: true,
    outcome: 'NONE',
    order: null,
    ...overrides,
  };
}

const text = (value: string | undefined) => value?.replaceAll(' ', ' ');

describe('bidRow', () => {
  it('prowadzę: podgląd; przebity: ton „urgent” i zalicytuj ponownie (główna akcja)', () => {
    const leading = bidRow(entry(), date);
    expect(leading.status).toEqual({ key: 'leading', tone: 'positive' });
    expect(leading.action).toEqual({
      kind: 'link',
      label: 'view',
      href: '/a/wazon-k3x9qa7m',
      primary: false,
    });
    const outbid = bidRow(entry({ leading: false }), date);
    expect(outbid.status).toEqual({ key: 'outbid', tone: 'urgent' });
    expect(outbid.action).toMatchObject({ label: 'rebid', primary: true });
  });

  it('wygrana: kwota, termin i nieaktywne „Zapłać”; opłacona: podgląd', () => {
    const won = bidRow(
      entry({
        outcome: 'WON',
        auction: { ...AUCTION, status: 'ENDED_SOLD' },
        order: {
          id: '01960000-0000-7000-8000-000000000101',
          publicId: 'p7q2m4nx',
          status: 'AWAITING_PAYMENT',
          currency: 'PLN',
          total: 10_999,
          paymentDueAt: '2026-10-21T18:00:00.000Z',
        },
      }),
      date,
    );
    expect(won.status).toMatchObject({ key: 'won', tone: 'warning' });
    expect(text(won.status.values?.['total'])).toBe('109,99 zł');
    expect(won.status.values?.['date']).toBe('[2026-10-21]');
    expect(won.action).toEqual({ kind: 'disabled', label: 'pay', hint: 'payHint' });
    const paid = bidRow(
      entry({
        outcome: 'WON',
        order: {
          id: '01960000-0000-7000-8000-000000000101',
          publicId: 'p7q2m4nx',
          status: 'PAID',
          currency: 'PLN',
          total: 10_999,
          paymentDueAt: '2026-10-21T18:00:00.000Z',
        },
      }),
      date,
    );
    expect(paid.status.key).toBe('wonPaid');
  });

  it('przegrana, cena minimalna i anulowanie: szukaj podobnych', () => {
    expect(bidRow(entry({ outcome: 'LOST' }), date).action).toMatchObject({
      label: 'similar',
      href: '/szukaj?q=Wazon',
    });
    expect(bidRow(entry({ outcome: 'RESERVE_NOT_MET' }), date).status.key).toBe('reserveNotMet');
    expect(bidRow(entry({ auction: { ...AUCTION, status: 'CANCELLED' } }), date).status.key).toBe(
      'cancelled',
    );
  });
});

describe('watchRow i saleRow', () => {
  it('obserwowana: aktywna „Licytuj”, zakończona „Przestań obserwować”', () => {
    expect(watchRow(AUCTION).action).toMatchObject({ kind: 'link', label: 'bid' });
    expect(watchRow({ ...AUCTION, status: 'ENDED_SOLD' }).action).toEqual({ kind: 'unwatch' });
  });

  it('sprzedana: czeka na płatność, opłacona z „Nadaj paczkę” prowadzącym do strony nadania (F-24)', () => {
    const sale = (status: string): AuctionSummaryDto => ({
      id: AUCTION.id,
      publicId: AUCTION.publicId,
      status: 'ENDED_SOLD',
      editable: false,
      title: 'Wazon',
      coverUrl: null,
      currency: 'PLN',
      startPrice: 2_000,
      currentPrice: 3_100,
      bidCount: 2,
      endsAt: AUCTION.endsAt,
      updatedAt: AUCTION.endsAt ?? '',
      order: {
        id: '01960000-0000-7000-8000-000000000101',
        publicId: 'p7q2m4nx',
        status: status as 'PAID',
        paymentDueAt: '2026-10-21T18:00:00.000Z',
      },
    });
    expect(saleRow(sale('AWAITING_PAYMENT'), date)).toMatchObject({
      status: {
        key: 'awaitingPayment',
        values: { date: '[2026-10-21]', number: 'p7q2m4nx' },
        tone: 'warning',
      },
      action: { kind: 'none' },
    });
    expect(saleRow(sale('SHIPPED'), date).status).toMatchObject({
      key: 'orderStatus',
      values: { status: 'SHIPPED' },
      tone: 'info',
    });
    expect(saleRow(sale('PAID'), date).action).toEqual({
      kind: 'link',
      label: 'ship',
      href: '/zamowienia/p7q2m4nx/nadaj',
      primary: true,
    });
  });
});

// Następna akcja w listach Moje Biddy (F-21): każda pozycja mówi, co zrobić dalej. Płatność (F-25)
// jeszcze nie działa, więc jej akcja jest widoczna, ale nieaktywna; nadanie paczki prowadzi do
// strony nadania (F-24).
import type { AuctionSummaryDto, MyBidsDto, MyWatchlistDto } from '@biddy/api-client';
import { formatMoney, money } from '@biddy/shared';

import { auctionUrl, dispatchUrl, searchUrl } from '@/lib/routes';

export type MyBidEntry = MyBidsDto['items'][number];
export type WatchedAuction = MyWatchlistDto['items'][number];

/** Opis stanu: klucz z `myBiddy.status` i wartości do komunikatu. */
export interface RowStatus {
  readonly key:
    | 'leading'
    | 'outbid'
    | 'won'
    | 'wonPaid'
    | 'lost'
    | 'reserveNotMet'
    | 'cancelled'
    | 'watchActive'
    | 'ended'
    | 'awaitingPayment'
    | 'paid'
    | 'orderStatus';
  readonly values?: Readonly<Record<string, string>>;
  /** Ton tekstu stanu; `urgent` (przebito Cię) wyróżnia też całą kartę (F-63). */
  readonly tone: 'positive' | 'urgent' | 'warning' | 'info' | 'neutral';
}

export type RowAction =
  | {
      readonly kind: 'link';
      readonly label: 'view' | 'rebid' | 'similar' | 'bid' | 'ship';
      readonly href: string;
      readonly primary: boolean;
    }
  | {
      readonly kind: 'disabled';
      readonly label: 'pay';
      readonly hint: 'payHint';
    }
  | { readonly kind: 'unwatch' }
  | { readonly kind: 'none' };

const zl = (amount: number) => formatMoney(money(amount));

/** Data i godzina po polsku (Europe/Warsaw), np. „16 paź 2026, 14:00”. */
export type DateFormatter = (iso: string) => string;

export function bidRow(
  entry: MyBidEntry,
  date: DateFormatter,
): { readonly status: RowStatus; readonly action: RowAction } {
  const href = auctionUrl(entry.auction);
  switch (entry.outcome) {
    case 'WON': {
      const order = entry.order;
      if (order !== null && order.status !== 'AWAITING_PAYMENT') {
        return {
          status: { key: 'wonPaid', values: { number: order.publicId }, tone: 'positive' },
          action: { kind: 'link', label: 'view', href, primary: false },
        };
      }
      return {
        status: {
          key: 'won',
          values:
            order === null
              ? { total: zl(entry.auction.price), date: '', number: '' }
              : { total: zl(order.total), date: date(order.paymentDueAt), number: order.publicId },
          tone: 'warning',
        },
        action: { kind: 'disabled', label: 'pay', hint: 'payHint' },
      };
    }
    case 'LOST':
      return {
        status: { key: 'lost', tone: 'neutral' },
        action: {
          kind: 'link',
          label: 'similar',
          href: searchUrl(entry.auction.title),
          primary: false,
        },
      };
    case 'RESERVE_NOT_MET':
      return {
        status: { key: 'reserveNotMet', tone: 'neutral' },
        action: {
          kind: 'link',
          label: 'similar',
          href: searchUrl(entry.auction.title),
          primary: false,
        },
      };
    case 'NONE':
      break;
  }
  if (entry.auction.status === 'CANCELLED') {
    return {
      status: { key: 'cancelled', tone: 'neutral' },
      action: {
        kind: 'link',
        label: 'similar',
        href: searchUrl(entry.auction.title),
        primary: false,
      },
    };
  }
  return entry.leading
    ? {
        status: { key: 'leading', tone: 'positive' },
        action: { kind: 'link', label: 'view', href, primary: false },
      }
    : {
        status: { key: 'outbid', tone: 'urgent' },
        action: { kind: 'link', label: 'rebid', href, primary: true },
      };
}

export function watchRow(auction: WatchedAuction): {
  readonly status: RowStatus;
  readonly action: RowAction;
} {
  return auction.status === 'ACTIVE'
    ? {
        status: { key: 'watchActive', tone: 'neutral' },
        action: { kind: 'link', label: 'bid', href: auctionUrl(auction), primary: true },
      }
    : { status: { key: 'ended', tone: 'neutral' }, action: { kind: 'unwatch' } };
}

export function saleRow(
  auction: AuctionSummaryDto,
  date: DateFormatter,
): { readonly status: RowStatus; readonly action: RowAction } {
  const order = auction.order;
  if (order === null) {
    return { status: { key: 'ended', tone: 'neutral' }, action: { kind: 'none' } };
  }
  if (order.status === 'AWAITING_PAYMENT') {
    return {
      status: {
        key: 'awaitingPayment',
        values: { date: date(order.paymentDueAt), number: order.publicId },
        tone: 'warning',
      },
      action: { kind: 'none' },
    };
  }
  if (order.status === 'PAID') {
    return {
      status: { key: 'paid', values: { number: order.publicId }, tone: 'positive' },
      action: { kind: 'link', label: 'ship', href: dispatchUrl(order.publicId), primary: true },
    };
  }
  return {
    status: {
      key: 'orderStatus',
      values: { number: order.publicId, status: order.status },
      tone: IN_TRANSIT.has(order.status)
        ? 'info'
        : order.status === 'COMPLETED'
          ? 'positive'
          : 'neutral',
    },
    action: { kind: 'none' },
  };
}

/** Zamówienie w drodze do kupującego (ton informacyjny w sprzedanych). */
const IN_TRANSIT: ReadonlySet<string> = new Set(['SHIPPED', 'DELIVERED']);

// „Puls licytacji” (F-63): sygnały na zdjęciu, licznik oglądających, historia z wykresem, pasek
// licytacji i dolny arkusz na telefonie, toasty spoza strony aukcji i ograniczony ruch.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { BidHistoryDto, MyBiddingDto, PublicAuctionDto, SessionDto } from '@biddy/api-client';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { CircleCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveAlerts } from '@/components/layout/live-alerts';
import { ServerClockProvider } from '@/components/providers/server-clock-provider';
import { MAX_TOASTS, useToast } from '@/components/providers/toast-provider';
import { RealtimeProvider } from '@/lib/realtime/realtime-provider';
import { mockApi } from '@/test/api';
import { AUCTION_ID, publicAuction } from '@/test/auctions';
import { AppWrapper } from '@/test/providers';
import { fakeRealtimeClient } from '@/test/realtime';

import { AuctionSignals } from './auction-signals';
import { BidHistory } from './bid-history';
import { BidPanel } from './bid-panel';
import { MOBILE_BID_BAR_ID, MobileBidBarSlot } from './mobile-bid-bar-slot';

const pathname = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

const BUYER: NonNullable<SessionDto['user']> = {
  id: '01960000-0000-7000-8000-0000000000e1',
  name: 'Kasia Kupująca',
  avatarUrl: null,
  emailVerified: true,
  termsAccepted: true,
  phoneVerified: true,
};

const text = (element: Element) => element.textContent.replaceAll('\u00a0', ' ');

function wrapperWith(realtime: ReturnType<typeof fakeRealtimeClient>) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <AppWrapper>
        <RealtimeProvider createClient={() => Promise.resolve(realtime.client)}>
          <ServerClockProvider>{children}</ServerClockProvider>
        </RealtimeProvider>
      </AppWrapper>
    );
  };
}

function bidding(overrides: Partial<MyBiddingDto> = {}): MyBiddingDto {
  return {
    auctionId: AUCTION_ID,
    isSeller: false,
    watching: false,
    hasBid: false,
    leading: false,
    maxAmount: null,
    outcome: 'NONE',
    order: null,
    ...overrides,
  };
}

function api(auction: PublicAuctionDto, extra: Record<string, unknown> = {}) {
  return mockApi({
    [`/v1/auctions/${auction.publicId}`]: auction,
    '/v1/time': () => ({ serverTime: new Date().toISOString() }),
    ...extra,
  });
}

let desktop = true;
beforeEach(() => {
  desktop = true;
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: desktop,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AuctionSignals', () => {
  it('ostatnia godzina z ofertami: LIVE i „Gorąca aukcja”; oglądający od 3 osób', async () => {
    const auction = publicAuction({ bidCount: 6, currentPrice: 5_000 }, 30 * 60_000);
    api(auction);
    const realtime = fakeRealtimeClient();
    render(<AuctionSignals initial={auction} />, { wrapper: wrapperWith(realtime) });
    expect(await screen.findByText('Live')).toBeDefined();
    expect(screen.getByText('Gorąca aukcja')).toBeDefined();

    await waitFor(() => {
      expect(realtime.viewing(AUCTION_ID)).toBe(1);
    });
    act(() => {
      realtime.viewers(AUCTION_ID, 2);
    });
    expect(screen.queryByText(/ogląda/u)).toBeNull();
    act(() => {
      realtime.viewers(AUCTION_ID, 31);
    });
    expect(await screen.findByText('31 osób ogląda')).toBeDefined();
  });

  it('spokojna aukcja: bez sygnałów; zakończona: bez zgłaszania oglądania', async () => {
    const calm = publicAuction();
    api(calm);
    const realtime = fakeRealtimeClient();
    const { container, unmount } = render(<AuctionSignals initial={calm} />, {
      wrapper: wrapperWith(realtime),
    });
    await waitFor(() => {
      expect(realtime.viewing(AUCTION_ID)).toBe(1);
    });
    expect(container.textContent).toBe('');
    unmount();
    expect(realtime.viewing(AUCTION_ID)).toBe(0);

    const ended = publicAuction({ status: 'ENDED_SOLD', currentPrice: 3_000 });
    api(ended);
    render(<AuctionSignals initial={ended} />, { wrapper: wrapperWith(realtime) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(realtime.viewing(AUCTION_ID)).toBe(0);
  });
});

describe('BidHistory: wykres i czas względny', () => {
  it('wykres od ceny wywoławczej, „teraz” dla świeżej oferty, wyróżniona najnowsza', async () => {
    const auction = publicAuction({ bidCount: 2, currentPrice: 2_500 });
    const page: BidHistoryDto = {
      currency: 'PLN',
      items: [
        {
          id: '01960000-0000-7000-8000-000000000301',
          amount: 2_500,
          kind: 'MANUAL',
          createdAt: new Date(Date.now() - 5_000).toISOString(),
          bidder: 'k***a',
        },
        {
          id: '01960000-0000-7000-8000-000000000302',
          amount: 2_000,
          kind: 'AUTO',
          createdAt: new Date(Date.now() - 5 * 60_000 - 30_000).toISOString(),
          bidder: 'b***k',
        },
      ],
      nextBefore: null,
    };
    api(auction, { [`/v1/auctions/${AUCTION_ID}/bids`]: page });
    render(<BidHistory initial={auction} />, { wrapper: wrapperWith(fakeRealtimeClient()) });
    expect(
      await screen.findByRole('img', { name: /^Cena rosła od 20\szł do 25\szł w 2 ofertach$/u }),
    ).toBeDefined();
    expect(screen.getByText('Aktualizuje się na żywo')).toBeDefined();
    const [newest, older] = screen.getAllByRole('listitem');
    expect(text(newest as HTMLElement)).toContain('k***a');
    expect(text(newest as HTMLElement)).toContain('teraz');
    expect(newest?.className).toContain('bg-accent');
    expect(text(older as HTMLElement)).toContain('5 min temu');
  });
});

describe('BidPanel na telefonie', () => {
  function setupMobile(options: { readonly outbid?: boolean } = {}) {
    desktop = false;
    const auction = publicAuction({ currentPrice: 4_000, minimumNextBid: 4_100, bidCount: 3 });
    api(auction, {
      '/v1/session': { user: BUYER },
      [`/v1/me/bids/${auction.publicId}`]: bidding(
        options.outbid === true ? { hasBid: true, leading: false, maxAmount: 3_500 } : {},
      ),
      '/v1/fee-schedules/current': () => new Response('{}', { status: 503 }),
    });
    const realtime = fakeRealtimeClient();
    render(
      <>
        <BidPanel initial={auction} />
        <MobileBidBarSlot />
      </>,
      { wrapper: wrapperWith(realtime) },
    );
    return realtime;
  }

  it('pasek na dole strony z ceną i licznikiem; przycisk otwiera dolny arkusz z formularzem', async () => {
    setupMobile({ outbid: true });
    const slot = document.getElementById(MOBILE_BID_BAR_ID) as HTMLElement;
    const open = await within(slot).findByRole('button', { name: 'Przebij ofertę' });
    expect(text(slot)).toContain('40 zł');
    await userEvent.setup().click(open);
    const sheet = await screen.findByRole('dialog', { name: 'Przebito Cię' });
    expect(text(sheet)).toContain('Twoje maksimum 35 zł nie wystarcza.');
    expect(within(sheet).getByLabelText('Nowe maksimum')).toBeDefined();
    expect(within(sheet).getByRole('group', { name: 'Szybkie kwoty' })).toBeDefined();
  });

  it('„Zalicytuj ponownie” na telefonie otwiera arkusz z minimalną ofertą', async () => {
    const realtime = setupMobile();
    await screen.findByRole('region', { name: 'Licytacja' });
    await waitFor(() => {
      expect(realtime.userSubscribers()).toBeGreaterThan(0);
    });
    act(() => {
      realtime.outbid(AUCTION_ID, { minimumNextBid: 4_100 });
    });
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Zalicytuj ponownie' }));
    const sheet = await screen.findByRole('dialog');
    const input = within(sheet).getByLabelText(/maksimum/u);
    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe('41');
    });
  });
});

describe('LiveAlerts: toasty spoza strony aukcji', () => {
  function setupAlerts(current: string) {
    pathname.current = current;
    mockApi({ '/v1/session': { user: BUYER } });
    const realtime = fakeRealtimeClient();
    render(<LiveAlerts />, { wrapper: wrapperWith(realtime) });
    return realtime;
  }

  const outbidNotification = {
    id: '01960000-0000-7000-8000-000000000401',
    type: 'OUTBID',
    title: 'Przebito Twoją ofertę',
    body: '„Wazon ceramiczny”: aktualna cena 31,00 zł.',
    url: '/a/wazon-ceramiczny-k3x9qa7m',
    createdAt: new Date().toISOString(),
    unreadCount: 1,
  };

  it('przebicie na innej stronie: toast z linkiem do aukcji', async () => {
    const realtime = setupAlerts('/szukaj');
    await waitFor(() => {
      expect(realtime.userSubscribers()).toBe(1);
    });
    act(() => {
      realtime.notification(outbidNotification);
    });
    const title = await screen.findByText('Przebito Twoją ofertę');
    const toast = title.closest('[data-slot="toast"]') as HTMLElement;
    expect(toast.getAttribute('data-tone')).toBe('urgent');
    expect(within(toast).getByRole('link', { name: 'Zobacz aukcję' }).getAttribute('href')).toBe(
      '/a/wazon-ceramiczny-k3x9qa7m',
    );
  });

  it('na stronie tej samej aukcji i dla innych typów: bez toastu', async () => {
    const realtime = setupAlerts('/a/wazon-ceramiczny-k3x9qa7m');
    await waitFor(() => {
      expect(realtime.userSubscribers()).toBe(1);
    });
    act(() => {
      realtime.notification(outbidNotification);
      realtime.notification({
        ...outbidNotification,
        id: '01960000-0000-7000-8000-000000000402',
        type: 'FOLLOWED_SELLER_NEW_AUCTION',
        url: '/a/inna-aukcja-k3x9qa7n',
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText('Przebito Twoją ofertę')).toBeNull();
  });
});

describe('ToastProvider', () => {
  function Trigger() {
    const show = useToast();
    return (
      <button
        type="button"
        onClick={() => {
          for (let index = 1; index <= 5; index += 1) {
            show({ tone: 'success', icon: CircleCheck, title: `Toast ${String(index)}` });
          }
          show({ id: 'stały', tone: 'brand', icon: CircleCheck, title: 'Pierwsza wersja' });
          show({ id: 'stały', tone: 'brand', icon: CircleCheck, title: 'Druga wersja' });
        }}
      >
        Pokaż
      </button>
    );
  }

  it('najwyżej trzy naraz; toast o tym samym id zastępuje poprzedni', async () => {
    render(<Trigger />, { wrapper: AppWrapper });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Pokaż' }));
    const toasts = document.querySelectorAll('[data-slot="toast"]');
    expect(toasts).toHaveLength(MAX_TOASTS);
    expect(screen.getByText('Druga wersja')).toBeDefined();
    expect(screen.queryByText('Pierwsza wersja')).toBeNull();
    expect(screen.queryByText('Toast 3')).toBeNull();
  });
});

describe('ograniczony ruch', () => {
  it('globals.css kończy animacje od razu przy prefers-reduced-motion', () => {
    const css = readFileSync(path.resolve(import.meta.dirname, '../../app/globals.css'), 'utf8');
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toContain('animation-duration: 0.01ms !important;');
    expect(block).toContain('animation-iteration-count: 1 !important;');
    expect(block).toContain('transition-duration: 0.01ms !important;');
  });
});

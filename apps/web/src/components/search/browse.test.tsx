// Przeglądanie (F-63, etap 2): sygnały na karcie aukcji (ton licznika, LIVE, „Gorąca”, pasek
// ostatniej godziny) i aukcja na żywo w hero strony głównej.
import type { BidHistoryDto } from '@biddy/api-client';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { HomeShowcase } from '@/components/home/home-showcase';
import { ServerClockProvider } from '@/components/providers/server-clock-provider';
import { RealtimeProvider } from '@/lib/realtime/realtime-provider';
import { mockApi } from '@/test/api';
import { AUCTION_ID } from '@/test/auctions';
import { AppWrapper, IntlWrapper } from '@/test/providers';
import { fakeRealtimeClient } from '@/test/realtime';

import type { AuctionCardData } from './auction-card';
import { CardHotBadge, CardHourBar, CardTimeBadge, CardTimer } from './card-signals';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const text = (element: Element) => element.textContent.replaceAll(' ', ' ');
const endsIn = (ms: number) => new Date(Date.now() + ms).toISOString();

describe('sygnały na karcie aukcji', () => {
  it('ostatnia godzina: LIVE i czerwony licznik mm:ss z pełnym opisem dla czytników', () => {
    const { container } = render(
      <CardTimeBadge endsAt={endsIn(30 * MINUTE)} endsAtLabel="Koniec: 26 paź, 18:30" />,
      { wrapper: IntlWrapper },
    );
    expect(screen.getByText('Live')).toBeDefined();
    const chip = container.querySelector('[data-tone]');
    expect(chip?.getAttribute('data-tone')).toBe('urgent');
    expect(text(chip as Element)).toMatch(
      /^Do końca: (30:0[01]|29:59)(30 min [01] s|29 min 59 s)$/u,
    );
  });

  it('poniżej doby fioletowy „5 godz. 0 min”, dalej spokojny „3 dni”, bez LIVE', () => {
    const { container, rerender } = render(
      <CardTimeBadge endsAt={endsIn(5 * HOUR)} endsAtLabel="Koniec" />,
      { wrapper: IntlWrapper },
    );
    expect(container.querySelector('[data-tone]')?.getAttribute('data-tone')).toBe('soon');
    expect(screen.getAllByText(/^5 godz\. 0 min$/u)).toHaveLength(2);
    expect(screen.queryByText('Live')).toBeNull();

    rerender(<CardTimeBadge endsAt={endsIn(3 * 24 * HOUR + MINUTE)} endsAtLabel="Koniec" />);
    expect(container.querySelector('[data-tone]')?.getAttribute('data-tone')).toBe('calm');
    expect(screen.getAllByText('3 dni')).toHaveLength(2);
  });

  it('ciemna karta: na zdjęciu tylko LIVE, licznik i pasek godziny pod ceną', () => {
    const endsAt = endsIn(15 * MINUTE);
    const { container } = render(
      <>
        <CardTimeBadge endsAt={endsAt} endsAtLabel="Koniec" liveOnly />
        <CardTimer endsAt={endsAt} />
        <CardHourBar endsAt={endsAt} />
      </>,
      { wrapper: IntlWrapper },
    );
    expect(screen.getByText('Live')).toBeDefined();
    expect(container.querySelectorAll('[data-tone="urgent"]')).toHaveLength(1);
    const bar = container.querySelector<HTMLElement>('[aria-hidden="true"] > div[style]');
    expect(Number.parseFloat(bar?.style.width ?? '')).toBeCloseTo(25, 0);
  });

  it('pasek godziny i LIVE na ciemnej karcie znikają, gdy do końca jest ponad godzina', () => {
    const endsAt = endsIn(2 * HOUR);
    const { container } = render(
      <>
        <CardTimeBadge endsAt={endsAt} endsAtLabel="Koniec" liveOnly />
        <CardHourBar endsAt={endsAt} />
      </>,
      { wrapper: IntlWrapper },
    );
    expect(container.textContent).toBe('');
  });

  it('„Gorąca” od 5 ofert w ostatniej dobie', () => {
    const { rerender } = render(<CardHotBadge endsAt={endsIn(3 * HOUR)} bidCount={5} />, {
      wrapper: IntlWrapper,
    });
    expect(screen.getByText('Gorąca')).toBeDefined();
    rerender(<CardHotBadge endsAt={endsIn(3 * HOUR)} bidCount={4} />);
    expect(screen.queryByText('Gorąca')).toBeNull();
    rerender(<CardHotBadge endsAt={endsIn(30 * HOUR)} bidCount={9} />);
    expect(screen.queryByText('Gorąca')).toBeNull();
  });
});

function card(overrides: Partial<AuctionCardData> = {}): AuctionCardData {
  return {
    id: AUCTION_ID,
    publicId: 'k3x9qa7m',
    slug: 'nike-air-max-97',
    title: 'Nike Air Max Retro ’97',
    condition: 'LIKE_NEW',
    currency: 'PLN',
    price: 32_000,
    currentPrice: 32_000,
    bidCount: 6,
    buyNowPrice: null,
    endsAt: endsIn(4 * MINUTE),
    coverUrl: null,
    coverThumbUrl: null,
    ...overrides,
  };
}

function history(items: { bidder: string; amount: number; agoMs: number }[]): BidHistoryDto {
  return {
    currency: 'PLN',
    nextBefore: null,
    items: items.map((item, index) => ({
      id: `01960000-0000-7000-8000-0000000001${String(index).padStart(2, '0')}`,
      bidder: item.bidder,
      amount: item.amount,
      kind: 'MANUAL',
      createdAt: new Date(Date.now() - item.agoMs).toISOString(),
    })),
  };
}

describe('aukcja na żywo w hero strony głównej', () => {
  it('cena, licznik w kafelkach, ostatnie oferty; po ofercie na żywo nowa cena z przyrostem', async () => {
    const bids = {
      current: history([
        { bidder: 'a***k', amount: 32_000, agoMs: 10_000 },
        { bidder: 't***9', amount: 31_000, agoMs: 2 * MINUTE },
        { bidder: 'v***r', amount: 30_000, agoMs: 6 * MINUTE },
        { bidder: 'z***z', amount: 29_000, agoMs: 9 * MINUTE },
      ]),
    };
    mockApi({
      [`/v1/auctions/${AUCTION_ID}/bids`]: () => bids.current,
      '/v1/time': () => ({ serverTime: new Date().toISOString() }),
    });
    const realtime = fakeRealtimeClient();
    render(<HomeShowcase initial={card()} />, {
      wrapper: ({ children }: { readonly children: ReactNode }) => (
        <AppWrapper>
          <RealtimeProvider createClient={() => Promise.resolve(realtime.client)}>
            <ServerClockProvider>{children}</ServerClockProvider>
          </RealtimeProvider>
        </AppWrapper>
      ),
    });

    const article = screen.getByRole('article', { name: 'Aukcja na żywo: Nike Air Max Retro ’97' });
    expect(text(screen.getByTestId('auction-price'))).toBe('320 zł');
    expect(screen.getByText('Live')).toBeDefined();
    expect(screen.getByRole('timer').getAttribute('aria-label')).toMatch(/^[34] min \d+ s$/u);
    expect(screen.getByText('Gorąca aukcja')).toBeDefined();
    const recent = await screen.findByRole('list', { name: 'Ostatnie oferty' });
    expect(recent.querySelectorAll('li')).toHaveLength(3);
    expect(text(recent)).toContain('a***k320 złteraz');
    expect(screen.getByRole('link', { name: 'Dołącz do licytacji' }).getAttribute('href')).toBe(
      '/a/nike-air-max-97-k3x9qa7m',
    );
    expect(article.textContent).toContain('Jak nowy · 6 ofert');

    bids.current = history([{ bidder: 'm***a', amount: 33_000, agoMs: 1_000 }]);
    await waitFor(() => {
      expect(realtime.subscribers(AUCTION_ID)).toBe(1);
    });
    act(() => {
      realtime.update({
        auctionId: AUCTION_ID,
        version: 9,
        status: 'ACTIVE',
        currency: 'PLN',
        currentPrice: 33_000,
        bidCount: 7,
        leader: { publicName: 'm***a' },
        endsAt: card().endsAt,
        reserveStatus: 'NONE',
        minimumNextBid: 33_500,
        buyNowAvailable: false,
        serverTime: new Date().toISOString(),
      });
    });
    expect(text(screen.getByTestId('auction-price'))).toBe('330 zł');
    expect(screen.getByText(/^\+10\s?zł$/u)).toBeDefined();
    expect(text(await screen.findByText(/m\*\*\*a podbija do/u))).toBe('m***a podbija do 330 zł');
  });
});

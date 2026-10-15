import type {
  BidHistoryDto,
  FeeScheduleDto,
  MyBiddingDto,
  PublicAuctionDto,
  SessionDto,
} from '@biddy/api-client';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { ServerClockProvider } from '@/components/providers/server-clock-provider';
import { RealtimeProvider } from '@/lib/realtime/realtime-provider';
import { apiCalls, mockApi } from '@/test/api';
import { AUCTION_ID, SELLER_ID, auctionUpdated, publicAuction } from '@/test/auctions';
import { AppWrapper } from '@/test/providers';
import { fakeRealtimeClient } from '@/test/realtime';

import { AuctionGallery } from './auction-gallery';
import { BidHistory } from './bid-history';
import { BidPanel } from './bid-panel';

const SCHEDULE: FeeScheduleDto = {
  id: '019b76da-a800-7473-8d63-395c20bf8898',
  currency: 'PLN',
  fixedFee: 299,
  tiers: [
    { upTo: 100_000, bp: 700 },
    { upTo: null, bp: 400 },
  ],
  vatRateBp: 2300,
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: null,
};

type SessionUser = NonNullable<SessionDto['user']>;

const BUYER: SessionUser = {
  id: '01960000-0000-7000-8000-0000000000e1',
  name: 'Kasia Kupująca',
  avatarUrl: null,
  emailVerified: true,
  termsAccepted: true,
  phoneVerified: true,
};

function myBidding(overrides: Partial<MyBiddingDto> = {}): MyBiddingDto {
  return {
    auctionId: AUCTION_ID,
    isSeller: false,
    hasBid: false,
    leading: false,
    maxAmount: null,
    outcome: 'NONE',
    order: null,
    ...overrides,
  };
}

/** Tekst bez twardych spacji z Intl (U+00A0 przed „zł”). */
const text = (element: Element) => element.textContent.replaceAll(' ', ' ');

function setup(
  auction: PublicAuctionDto,
  options: {
    readonly user?: SessionUser | null;
    readonly bidding?: MyBiddingDto;
    readonly api?: Record<string, unknown>;
  } = {},
) {
  const fetchMock = mockApi({
    [`/v1/auctions/${auction.publicId}`]: auction,
    '/v1/session': { user: options.user ?? null },
    [`/v1/me/bids/${auction.publicId}`]: options.bidding ?? myBidding(),
    '/v1/fee-schedules/current': SCHEDULE,
    '/v1/time': () => ({ serverTime: new Date().toISOString() }),
    ...options.api,
  });
  const realtime = fakeRealtimeClient();
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <AppWrapper>
      <RealtimeProvider createClient={() => Promise.resolve(realtime.client)}>
        <ServerClockProvider>{children}</ServerClockProvider>
      </RealtimeProvider>
    </AppWrapper>
  );
  const view = render(<BidPanel initial={auction} feeSchedule={SCHEDULE} />, { wrapper });
  return { fetchMock, realtime, view };
}

const price = () => text(screen.getByTestId('auction-price'));

describe('BidPanel: kto może licytować', () => {
  it('gość: cena wywoławcza, licznik i logowanie z powrotem na aukcję', async () => {
    setup(publicAuction());
    const login = await screen.findByRole('link', { name: 'Zaloguj się, aby licytować' });
    expect(login.getAttribute('href')).toBe(
      `/logowanie?next=${encodeURIComponent('/a/wazon-ceramiczny-k3x9qa7m')}`,
    );
    expect(screen.getByText('Cena wywoławcza')).toBeDefined();
    expect(price()).toBe('20 zł');
    expect(screen.getByRole('timer').textContent).toMatch(/^(3 dni 0 h|2 dni 23 h)$/u);
    expect(screen.queryByRole('button', { name: 'Licytuj' })).toBeNull();
  });

  it('bez zweryfikowanego telefonu: zachęta do weryfikacji zamiast przycisku licytacji', async () => {
    setup(publicAuction(), { user: { ...BUYER, phoneVerified: false } });
    const verify = await screen.findByRole('link', { name: 'Zweryfikuj telefon, aby licytować' });
    expect(verify.getAttribute('href')).toBe(
      `/weryfikacja-telefonu?next=${encodeURIComponent('/a/wazon-ceramiczny-k3x9qa7m')}`,
    );
    expect(screen.queryByRole('button', { name: 'Licytuj' })).toBeNull();
  });

  it('sprzedający widzi swoją aukcję bez formularza', async () => {
    setup(publicAuction(), {
      user: { ...BUYER, id: SELLER_ID },
      bidding: myBidding({ isSeller: true }),
    });
    expect(await screen.findByText('To Twoja aukcja.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Licytuj' })).toBeNull();
  });
});

describe('BidPanel: oferta', () => {
  it('cena łączna przed ofertą, potwierdzenie i oferta z Idempotency-Key', async () => {
    const auction = publicAuction();
    const { fetchMock } = setup(auction, {
      user: BUYER,
      api: {
        [`/v1/auctions/${AUCTION_ID}/bids`]: () =>
          Response.json(
            {
              bid: {
                id: '01960000-0000-7000-8000-0000000000f1',
                amount: 2_000,
                maxAmount: 50_000,
                kind: 'MANUAL',
                createdAt: new Date().toISOString(),
              },
              leading: true,
              auction: {
                id: AUCTION_ID,
                status: 'ACTIVE',
                currency: 'PLN',
                currentPrice: 2_000,
                bidCount: 1,
                endsAt: auction.endsAt,
                reserveStatus: 'NONE',
                minimumNextBid: 2_100,
                buyNowAvailable: false,
              },
            },
            { status: 201 },
          ),
      },
    });
    const user = userEvent.setup();
    const input = await screen.findByLabelText('Twoje maksimum');
    await user.type(input, '500');
    const panel = screen.getByRole('region', { name: 'Licytacja' });
    await waitFor(() => {
      expect(text(panel)).toContain('Licytujesz do 500 zł · zapłacisz najwyżej 537,99 zł');
    });

    await user.click(screen.getByRole('button', { name: 'Licytuj' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Potwierdź ofertę' });
    expect(text(dialog)).toContain('Licytujesz do 500 zł. Oferta jest wiążąca');
    expect(text(dialog)).toContain('zapłacisz najwyżej 537,99 zł');
    await user.click(within(dialog).getByRole('button', { name: 'Potwierdź ofertę' }));

    expect(await screen.findByText('Prowadzisz. Twoje maksimum: 500 zł')).toBeDefined();
    const [call] = apiCalls(fetchMock, `/v1/auctions/${AUCTION_ID}/bids`);
    expect(call?.body).toEqual({ maxAmount: 50_000 });
    expect(call?.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('kwota poniżej minimalnej oferty: komunikat bez wysyłki', async () => {
    const { fetchMock } = setup(publicAuction(), { user: BUYER });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Twoje maksimum'), '10');
    await user.click(screen.getByRole('button', { name: 'Licytuj' }));
    expect(screen.getByText('Najniższa możliwa oferta to 20 zł.')).toBeDefined();
    expect(screen.getByLabelText('Twoje maksimum').getAttribute('aria-invalid')).toBe('true');
    expect(apiCalls(fetchMock, `/v1/auctions/${AUCTION_ID}/bids`)).toHaveLength(0);
  });

  it('błąd z API (np. BID_TOO_LOW) przy polu kwoty', async () => {
    setup(publicAuction(), {
      user: BUYER,
      api: {
        [`/v1/auctions/${AUCTION_ID}/bids`]: () =>
          Response.json(
            {
              type: 'https://biddy.pl/problems/bid-too-low',
              title: 'Za niska oferta',
              status: 409,
              detail: 'Najniższa możliwa oferta to 21 zł.',
              instance: `/v1/auctions/${AUCTION_ID}/bids`,
              code: 'BID_TOO_LOW',
              requestId: 'test',
            },
            { status: 409, headers: { 'content-type': 'application/problem+json' } },
          ),
      },
    });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Twoje maksimum'), '20');
    await user.click(screen.getByRole('button', { name: 'Licytuj' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Potwierdź ofertę' }));
    expect(await screen.findByText('Najniższa możliwa oferta to 21 zł.')).toBeDefined();
  });
});

describe('BidPanel: na żywo i stany', () => {
  it('auction.updated zmienia cenę bez odświeżania; starsza wersja jest ignorowana', async () => {
    const auction = publicAuction();
    const { fetchMock, realtime } = setup(auction);
    await waitFor(() => {
      expect(realtime.subscribers(AUCTION_ID)).toBe(1);
      expect(apiCalls(fetchMock, `/v1/auctions/${auction.publicId}`).length).toBeGreaterThan(0);
    });
    act(() => {
      realtime.update(auctionUpdated(auction, { version: 3, currentPrice: 4_500, bidCount: 2 }));
    });
    // TanStack Query powiadamia komponenty asynchronicznie.
    await waitFor(() => {
      expect(price()).toBe('45 zł');
    });
    expect(screen.getByText(/2 oferty/u)).toBeDefined();
    await act(async () => {
      realtime.update(auctionUpdated(auction, { version: 2, currentPrice: 3_000 }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(price()).toBe('45 zł');
  });

  it('końcówka: wyróżniony licznik i informacja o przedłużeniu', async () => {
    setup(publicAuction({}, 90_000));
    expect(
      await screen.findByText('Końcówka aukcji: oferta teraz przedłuży aukcję o 2 minuty.'),
    ).toBeDefined();
    expect(screen.getByRole('timer').textContent).toMatch(/^01:[23]\d$/u);
  });

  it('wygrana: kwota i termin płatności z zamówienia', async () => {
    setup(publicAuction({ status: 'ENDED_SOLD', currentPrice: 10_000, bidCount: 1 }), {
      user: BUYER,
      bidding: myBidding({
        hasBid: true,
        leading: true,
        maxAmount: 10_000,
        outcome: 'WON',
        order: {
          id: '01960000-0000-7000-8000-000000000101',
          publicId: 'p7q2m4nx',
          status: 'AWAITING_PAYMENT',
          currency: 'PLN',
          total: 10_999,
          paymentDueAt: '2026-10-16T12:00:00.000Z',
        },
      }),
    });
    expect(await screen.findByText('Wygrana! Przedmiot jest Twój.')).toBeDefined();
    expect(text(screen.getByTestId('bidder-status'))).toContain(
      'Zamówienie p7q2m4nx: do zapłaty 109,99 zł (bez dostawy) do 16 paź 2026, 14:00.',
    );
    expect(screen.getByText('Sprzedano za 100 zł')).toBeDefined();
  });

  it('przegrana i nieosiągnięta cena minimalna', async () => {
    const { view } = setup(publicAuction({ status: 'ENDED_SOLD', currentPrice: 6_000 }), {
      user: BUYER,
      bidding: myBidding({ hasBid: true, maxAmount: 3_000, outcome: 'LOST' }),
    });
    expect(await screen.findByText('Nie udało się wygrać tej aukcji.')).toBeDefined();
    view.unmount();
    setup(publicAuction({ status: 'ENDED_UNSOLD', currentPrice: 4_000 }), {
      user: BUYER,
      bidding: myBidding({ hasBid: true, leading: true, outcome: 'RESERVE_NOT_MET' }),
    });
    expect(
      await screen.findByText(
        'Twoja oferta była najwyższa, ale nie osiągnęła ceny minimalnej sprzedawcy.',
      ),
    ).toBeDefined();
    expect(screen.getByText('Aukcja zakończona bez sprzedaży')).toBeDefined();
  });

  it('przebicie przez innego licytującego: komunikat na żywo', async () => {
    const { realtime } = setup(publicAuction(), {
      user: BUYER,
      bidding: myBidding({ hasBid: true, leading: true, maxAmount: 2_500 }),
    });
    expect(await screen.findByText('Prowadzisz. Twoje maksimum: 25 zł')).toBeDefined();
    await waitFor(() => {
      expect(realtime.subscribers(AUCTION_ID)).toBe(1);
    });
    act(() => {
      realtime.outbid(AUCTION_ID, { minimumNextBid: 3_100 });
    });
    expect(text(screen.getByRole('status'))).toBe('Przebito Cię. Najniższa oferta to 31 zł.');
  });
});

describe('AuctionGallery i BidHistory', () => {
  it('galeria: zdjęcia z wariantami i przełączanie przyciskami', async () => {
    const photos = publicAuction().photos;
    const second = {
      id: '01960000-0000-7000-8000-0000000000d2',
      urls: {
        thumb: 'https://media.test/2-thumb.webp',
        medium: 'https://media.test/2-medium.webp',
        large: 'https://media.test/2-large.webp',
      },
    };
    render(<AuctionGallery title="Wazon" photos={[...photos, second]} />, { wrapper: AppWrapper });
    const main = screen.getByAltText('Zdjęcie 1 z 2: Wazon');
    expect(main.getAttribute('srcset')).toContain('https://media.test/1-large.webp 1600w');
    expect(main.getAttribute('fetchpriority')).toBe('high');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Następne zdjęcie' }));
    expect(screen.getByAltText('Zdjęcie 2 z 2: Wazon').getAttribute('src')).toBe(
      'https://media.test/2-medium.webp',
    );
  });

  it('historia: zanonimizowani licytujący, oferty automatyczne i kolejne strony', async () => {
    const auction = publicAuction({ bidCount: 2, currentPrice: 2_100 });
    const page = (before?: number): BidHistoryDto => ({
      currency: 'PLN',
      items:
        before === undefined
          ? [
              {
                id: '01960000-0000-7000-8000-000000000201',
                amount: 2_100,
                kind: 'AUTO',
                createdAt: '2026-10-15T10:00:00.000Z',
                bidder: 'k***a',
              },
            ]
          : [
              {
                id: '01960000-0000-7000-8000-000000000202',
                amount: 2_000,
                kind: 'MANUAL',
                createdAt: '2026-10-15T09:00:00.000Z',
                bidder: 'b***k',
              },
            ],
      nextBefore: before === undefined ? 2 : null,
    });
    const fetchMock = mockApi({ [`/v1/auctions/${auction.publicId}`]: auction });
    fetchMock.mockImplementation((input) => {
      const url = new URL(typeof input === 'string' ? input : (input as Request).url);
      const before = url.searchParams.get('before');
      return Promise.resolve(
        Response.json(
          url.pathname.endsWith('/bids')
            ? page(before === null ? undefined : Number(before))
            : auction,
        ),
      );
    });
    render(<BidHistory initial={auction} />, { wrapper: AppWrapper });
    expect(await screen.findByText('k***a')).toBeDefined();
    expect(screen.getByText('licytacja automatyczna')).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Pokaż starsze' }));
    expect(await screen.findByText('b***k')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Pokaż starsze' })).toBeNull();
  });
});

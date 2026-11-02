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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServerClockProvider } from '@/components/providers/server-clock-provider';
import { RealtimeProvider } from '@/lib/realtime/realtime-provider';
import { apiCalls, mockApi } from '@/test/api';
import { AUCTION_ID, SELLER_ID, auctionUpdated, publicAuction } from '@/test/auctions';
import { AppWrapper } from '@/test/providers';
import { fakeRealtimeClient } from '@/test/realtime';

import { AuctionGallery } from './auction-gallery';
import { BidHistory } from './bid-history';
import { BidPanel } from './bid-panel';
import { winStep } from './win-panel';

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
    watching: false,
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

// Panel na desktopie (formularz obok galerii), chyba że test mówi inaczej.
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('BidPanel: kto może licytować', () => {
  it('gość: cena wywoławcza, licznik i logowanie z powrotem na aukcję', async () => {
    setup(publicAuction());
    expect(await screen.findByText('Zaloguj się, aby licytować')).toBeDefined();
    const login = screen.getByRole('link', { name: 'Zaloguj się' });
    expect(login.getAttribute('href')).toBe(
      `/logowanie?next=${encodeURIComponent('/a/wazon-ceramiczny-k3x9qa7m')}`,
    );
    expect(
      screen.getByRole('link', { name: 'Nie masz konta? Załóż konto' }).getAttribute('href'),
    ).toBe(`/rejestracja?next=${encodeURIComponent('/a/wazon-ceramiczny-k3x9qa7m')}`);
    expect(screen.getByText('Cena wywoławcza')).toBeDefined();
    expect(price()).toBe('20 zł');
    expect(screen.getByRole('timer').textContent).toMatch(/^(3 dni 0 godz\.|2 dni 23 godz\.)$/u);
    expect(screen.queryByRole('button', { name: 'Licytuj' })).toBeNull();
  });

  it('bez zweryfikowanego telefonu: zachęta do weryfikacji zamiast przycisku licytacji', async () => {
    setup(publicAuction(), { user: { ...BUYER, phoneVerified: false } });
    expect(await screen.findByText('Zweryfikuj telefon, aby licytować')).toBeDefined();
    const verify = screen.getByRole('link', { name: 'Zweryfikuj telefon' });
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
    // Najtańsza dostawa z cennika Biddy (F-24).
    expect(text(panel)).toContain('+ dostawa od 13,99 zł');

    await user.click(screen.getByRole('button', { name: 'Licytuj' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Potwierdź ofertę' });
    expect(text(dialog)).toContain('Licytujesz do 500 zł. Oferta jest wiążąca');
    expect(text(dialog)).toContain('zapłacisz najwyżej 537,99 zł');
    expect(text(dialog)).toContain('Wazon ceramiczny');
    expect(text(dialog)).toContain('Aktualna oferta20 zł');
    await user.click(within(dialog).getByRole('button', { name: 'Potwierdź ofertę' }));

    // Wynik oferty w toaście (F-63), nie w linijce panelu.
    const toast = await screen.findByText('Twoje maksimum 500 zł prowadzi. Cena: 20 zł.');
    expect(toast.closest('[data-slot="toast"]')?.getAttribute('data-tone')).toBe('success');
    const [call] = apiCalls(fetchMock, `/v1/auctions/${AUCTION_ID}/bids`);
    expect(call?.body).toEqual({ maxAmount: 50_000 });
    expect(call?.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('szybkie kwoty (F-63): minimalna i dwie okrągłe kwoty, wybór wpisuje kwotę do pola', async () => {
    setup(publicAuction(), { user: BUYER });
    const group = await screen.findByRole('group', { name: 'Szybkie kwoty' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((button) => text(button))).toEqual(['20 zł', '25 zł', '30 zł']);
    await userEvent.setup().click(within(group).getByRole('button', { name: /^25\szł$/u }));
    expect(screen.getByLabelText<HTMLInputElement>('Twoje maksimum').value).toBe('25');
    expect(
      within(group)
        .getByRole('button', { name: /^25\szł$/u })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('potwierdzenie po ofercie kogoś innego: nowa minimalna zamiast starej kwoty', async () => {
    const auction = publicAuction();
    const { realtime, fetchMock } = setup(auction, { user: BUYER });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Twoje maksimum'), '20');
    await user.click(screen.getByRole('button', { name: 'Licytuj' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Potwierdź ofertę' });
    await waitFor(() => {
      expect(realtime.subscribers(AUCTION_ID)).toBe(1);
    });
    act(() => {
      realtime.update(
        auctionUpdated(auction, {
          version: 5,
          currentPrice: 2_400,
          bidCount: 1,
          minimumNextBid: 2_500,
        }),
      );
    });
    expect(
      await within(dialog).findByText(
        'W międzyczasie ktoś zalicytował. Najniższa oferta to teraz 25 zł.',
      ),
    ).toBeDefined();
    await user.click(within(dialog).getByRole('button', { name: /^Licytuj 25\szł$/u }));
    expect(text(dialog)).toContain('Licytujesz do 25 zł.');
    expect(apiCalls(fetchMock, `/v1/auctions/${AUCTION_ID}/bids`)).toHaveLength(0);
  });

  it('błąd sieci: kwota zostaje, „Spróbuj ponownie” wysyła tę samą próbę (ten sam klucz)', async () => {
    let attempts = 0;
    const { fetchMock } = setup(publicAuction(), {
      user: BUYER,
      api: {
        [`/v1/auctions/${AUCTION_ID}/bids`]: () => {
          attempts += 1;
          return attempts === 1
            ? new Response('{}', { status: 503 })
            : Response.json(
                {
                  bid: {
                    id: '01960000-0000-7000-8000-0000000000f2',
                    amount: 2_000,
                    maxAmount: 3_000,
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
                    endsAt: new Date(Date.now() + 86_400_000).toISOString(),
                    reserveStatus: 'NONE',
                    minimumNextBid: 2_100,
                    buyNowAvailable: false,
                  },
                },
                { status: 201 },
              );
        },
      },
    });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Twoje maksimum'), '30');
    await user.click(screen.getByRole('button', { name: 'Licytuj' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Potwierdź ofertę',
      }),
    );
    expect(
      await screen.findByText(
        'Nie udało się wysłać oferty. Sprawdź połączenie i spróbuj ponownie.',
      ),
    ).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>('Twoje maksimum').value).toBe('30');
    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByText('Twoje maksimum 30 zł prowadzi. Cena: 20 zł.')).toBeDefined();
    const calls = apiCalls(fetchMock, `/v1/auctions/${AUCTION_ID}/bids`);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.headers.get('idempotency-key')).toBe(calls[0]?.headers.get('idempotency-key'));
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
    // Impuls ceny (F-63): plakietka przyrostu po wzroście z realtime.
    expect(screen.getByText('+25 zł')).toBeDefined();
    await act(async () => {
      realtime.update(auctionUpdated(auction, { version: 2, currentPrice: 3_000 }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(price()).toBe('45 zł');
  });

  it('końcówka: „Ostatnie minuty”, licznik w kafelkach i informacja o przedłużeniu', async () => {
    setup(publicAuction({}, 90_000));
    expect(
      await screen.findByText('Końcówka aukcji: oferta teraz przedłuży aukcję o 2 minuty.'),
    ).toBeDefined();
    expect(screen.getByText('Ostatnie minuty')).toBeDefined();
    const timer = screen.getByRole('timer');
    expect(timer.getAttribute('aria-label')).toMatch(/^1 min [23]\d s$/u);
    expect(timer.textContent).toMatch(/^00godz:01min:[23]\dsek$/u);
  });

  it('poniżej doby licznik gg:mm:ss', async () => {
    setup(publicAuction({}, 5 * 3_600_000));
    expect((await screen.findByRole('timer')).textContent).toMatch(/^0[45]:\d{2}:\d{2}$/u);
  });

  it('przedłużenie: toast i informacja o nowym końcu w panelu', async () => {
    const auction = publicAuction({}, 90_000);
    const { realtime } = setup(auction);
    await waitFor(() => {
      expect(realtime.subscribers(AUCTION_ID)).toBe(1);
    });
    const endsAt = new Date(Date.now() + 210_000);
    act(() => {
      realtime.extended({
        auctionId: AUCTION_ID,
        endsAt: endsAt.toISOString(),
        serverTime: new Date().toISOString(),
      });
    });
    expect(await screen.findByText('Aukcja przedłużona')).toBeDefined();
    const time = new Intl.DateTimeFormat('pl-PL', {
      timeStyle: 'short',
      timeZone: 'Europe/Warsaw',
    }).format(endsAt);
    expect(screen.getByText(`Aukcja przedłużona. Nowy koniec: ${time}.`)).toBeDefined();
  });

  it('ostatnie minuty obserwowanej aukcji: toast raz na sesję', async () => {
    const auction = publicAuction({}, 4 * 60_000);
    const { view } = setup(auction, { user: BUYER, bidding: myBidding({ watching: true }) });
    expect(await screen.findByText('Aukcja kończy się za kilka minut')).toBeDefined();
    view.unmount();
    setup(auction, { user: BUYER, bidding: myBidding({ watching: true }) });
    await screen.findByRole('region', { name: 'Licytacja' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('Aukcja kończy się za kilka minut')).toBeNull();
  });

  it.each([
    ['3 dni', 3 * 86_400_000, 'calm'],
    ['5 godzin', 5 * 3_600_000, 'soon'],
    ['40 minut', 40 * 60_000, 'urgent'],
  ])('ton licznika (F-62): do końca %s → %s', async (_label, remaining, tone) => {
    setup(publicAuction({}, remaining));
    const timer = await screen.findByRole('timer');
    expect(timer.closest('[data-tone]')?.getAttribute('data-tone')).toBe(tone);
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
    // Panel wygranej (D2) zamiast panelu licytacji: cena, zamówienie, kroki i podsumowanie.
    expect(await screen.findByRole('heading', { name: 'Wygrana!' })).toBeDefined();
    const win = text(screen.getByTestId('bidder-status'));
    expect(win).toContain('Przedmiot jest Twój.');
    expect(win).toContain('Zamówienie p7q2m4nx');
    expect(win).toContain('Zapłać do 16 października 2026');
    expect(win).toContain('Pakiet Ochrony Kupujących9,99 zł');
    expect(win).toContain('Do zapłaty bez dostawy109,99 zł');
    // Checkout (F-25): główna akcja to płatność, Moje Biddy jest drugą.
    expect(
      screen.getByRole('link', { name: /^Zapłać 109,99\s+zł \+ dostawa$/u }).getAttribute('href'),
    ).toBe('/zamowienia/p7q2m4nx/zaplac');
    expect(screen.getByRole('link', { name: 'Zobacz w Moje Biddy' }).getAttribute('href')).toBe(
      '/moje-biddy/wygrane',
    );
    expect(screen.queryByRole('region', { name: 'Licytacja' })).toBeNull();
    expect(text(screen.getByRole('listitem', { current: 'step' }))).toContain('Zapłać do');
  });

  it('wygrana po opłaceniu: bieżący krok to nadanie, bez przycisku płatności', async () => {
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
          status: 'PAID',
          currency: 'PLN',
          total: 10_999,
          paymentDueAt: '2026-10-16T12:00:00.000Z',
        },
      }),
    });
    expect(await screen.findByRole('heading', { name: 'Wygrana!' })).toBeDefined();
    const win = text(screen.getByTestId('bidder-status'));
    expect(win).toContain('Opłacone');
    expect(win).not.toContain('Zapłać do');
    expect(text(screen.getByRole('listitem', { current: 'step' }))).toContain(
      'Sprzedawca nada paczkę',
    );
    expect(screen.queryByRole('link', { name: /^Zapłać/u })).toBeNull();
  });

  it.each([
    [null, 0],
    ['AWAITING_PAYMENT', 0],
    ['PAID', 1],
    ['SHIPPED', 2],
    ['DELIVERED', 2],
    ['COMPLETED', 3],
    ['CANCELLED_UNPAID', null],
    ['DISPUTED', null],
  ] as const)('krok „Co dalej” dla zamówienia %s: %s', (status, step) => {
    expect(winStep(status)).toBe(step);
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

  it('przebicie na żywo: jeden toast z „Zalicytuj ponownie”, które wpisuje minimalną ofertę', async () => {
    const { realtime } = setup(publicAuction({ minimumNextBid: 3_100 }), {
      user: BUYER,
      bidding: myBidding({ hasBid: true, leading: true, maxAmount: 2_500 }),
    });
    expect(
      await screen.findByText(
        'Twoje maksimum: 25 zł. Biddy podbije cenę za Ciebie, jeśli ktoś zalicytuje.',
      ),
    ).toBeDefined();
    await waitFor(() => {
      expect(realtime.subscribers(AUCTION_ID)).toBe(1);
    });
    act(() => {
      realtime.outbid(AUCTION_ID, { minimumNextBid: 3_100 });
    });
    const toast = (await screen.findByText('Wazon ceramiczny · najniższa oferta 31 zł')).closest(
      '[data-slot="toast"]',
    );
    expect(toast?.getAttribute('data-tone')).toBe('urgent');
    // Panel nie ma już własnej linijki role="status": czytnik ekranu słyszy tylko toast.
    expect(
      within(screen.getByRole('region', { name: 'Licytacja' })).queryByRole('status'),
    ).toBeNull();

    await userEvent
      .setup()
      .click(within(toast as HTMLElement).getByRole('button', { name: 'Zalicytuj ponownie' }));
    const input = screen.getByLabelText('Nowe maksimum');
    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe('31');
      expect(document.activeElement).toBe(input);
    });
  });

  it('przebity: czerwony pasek z minimalną ofertą i przycisk „Przebij ofertę”', async () => {
    setup(publicAuction({ currentPrice: 4_000, minimumNextBid: 4_100, bidCount: 3 }), {
      user: BUYER,
      bidding: myBidding({ hasBid: true, leading: false, maxAmount: 3_500 }),
    });
    const bar = await screen.findByTestId('bidder-status');
    expect(bar.getAttribute('data-tone')).toBe('urgent');
    expect(text(bar)).toBe(
      'Przebito CięTwoje maksimum 35 zł nie wystarcza. Zalicytuj co najmniej 41 zł.',
    );
    expect(screen.getByRole('button', { name: 'Przebij ofertę' })).toBeDefined();
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

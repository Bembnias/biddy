// Moje Biddy (F-21, układ F-63): podsumowanie licytacji, wyróżnienie przebitych, filtr, cena na
// żywo, zwarte przegrane i sprzedane, gorąca aukcja sprzedawcy.
import type { AuctionSummaryDto, MyBidsDto } from '@biddy/api-client';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { RealtimeProvider } from '@/lib/realtime/realtime-provider';
import { mockApi } from '@/test/api';
import { auctionUpdated, publicAuction } from '@/test/auctions';
import { AppWrapper } from '@/test/providers';
import { fakeRealtimeClient } from '@/test/realtime';

import { HotAuction, hottestAuction } from './hot-auction';
import { MyBids } from './my-bids';
import { Sales } from './sales';

const HOUR = 60 * 60 * 1000;
const text = (element: Element) => element.textContent.replaceAll('\u00a0', ' ');
const endsIn = (ms: number) => new Date(Date.now() + ms).toISOString();

function card(index: number, overrides: Partial<MyBidsDto['items'][number]['auction']> = {}) {
  return {
    id: `01960000-0000-7000-8000-0000000000a${String(index)}`,
    publicId: `k3x9qa7${'mn'[index % 2] ?? 'm'}`,
    slug: `aukcja-${String(index)}`,
    title: `Aukcja ${String(index)}`,
    status: 'ACTIVE' as const,
    currency: 'PLN' as const,
    price: 3_000,
    currentPrice: 3_000,
    bidCount: 2,
    endsAt: endsIn(3 * HOUR),
    coverUrl: null,
    coverThumbUrl: null,
    ...overrides,
  };
}

const ACTIVE: MyBidsDto = {
  items: [
    { auction: card(1), maxAmount: 5_000, leading: true, outcome: 'NONE', order: null },
    { auction: card(2), maxAmount: 2_500, leading: false, outcome: 'NONE', order: null },
  ],
  total: 2,
  page: 1,
  totalPages: 1,
  // Na dalszych stronach są kolejne aukcje: kafelki liczą wszystkie, nie tylko wczytane.
  summary: { leading: 4, outbid: 3, endingSoon: 2 },
};

function realtimeWrapper() {
  const realtime = fakeRealtimeClient();
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <AppWrapper>
      <RealtimeProvider createClient={() => Promise.resolve(realtime.client)}>
        {children}
      </RealtimeProvider>
    </AppWrapper>
  );
  return { realtime, wrapper };
}

/** Kwota w karcie pod etykietą (`dt` → `dd`). */
function amount(row: HTMLElement, label: string): string {
  const term = within(row).getByText(label, { selector: 'dt' });
  return text(term.nextElementSibling ?? document.body);
}

describe('MyBids: licytuję', () => {
  it('kafelki z API, przebita karta wyróżniona z akcją, filtr i cena na żywo', async () => {
    mockApi({ '/v1/me/bids': ACTIVE });
    const { realtime, wrapper } = realtimeWrapper();
    const user = userEvent.setup();
    render(<MyBids status="ACTIVE" />, { wrapper });

    const outbidTile = (await screen.findByText('Przebito Cię', { selector: 'dt' })).closest('div');
    expect(outbidTile?.getAttribute('data-tone')).toBe('urgent');
    expect(text(outbidTile ?? document.body)).toBe('Przebito Cię3zalicytuj ponownie przed końcem');
    expect(text(screen.getByText('Licytujesz').closest('div') ?? document.body)).toContain('2');
    expect(text(screen.getByText('Kończą się').closest('div') ?? document.body)).toBe(
      'Kończą się2w ciągu doby',
    );

    const outbidRow = screen.getByRole('link', { name: 'Aukcja 2' }).closest('li') as HTMLElement;
    expect(outbidRow.getAttribute('data-tone')).toBe('urgent');
    expect(within(outbidRow).getByText('Przebito Cię')).toBeDefined();
    expect(amount(outbidRow, 'Twoje maksimum')).toBe('25 zł');
    expect(
      within(outbidRow).getByRole('link', { name: 'Zalicytuj ponownie: Aukcja 2' }).className,
    ).toContain('bg-primary');
    expect(outbidRow.querySelector('[data-tone="soon"]')?.textContent).toMatch(/godz\./u);

    const leadingRow = screen.getByRole('link', { name: 'Aukcja 1' }).closest('li') as HTMLElement;
    expect(leadingRow.getAttribute('data-tone')).toBe('default');
    expect(within(leadingRow).getByText('Prowadzisz')).toBeDefined();
    expect(amount(leadingRow, 'Twoje maksimum')).toBe('50 zł');

    await user.click(screen.getByRole('radio', { name: 'Przebito Cię' }));
    expect(screen.queryByText('Aukcja 1')).toBeNull();
    expect(screen.getByText('Aukcja 2')).toBeDefined();
    await user.click(screen.getByRole('radio', { name: 'Wszystkie' }));

    await waitFor(() => {
      expect(realtime.subscribers(card(1).id)).toBe(1);
    });
    act(() => {
      realtime.update(
        auctionUpdated(
          { ...publicAuction(), id: card(1).id, version: 1 },
          { currentPrice: 4_200, bidCount: 3 },
        ),
      );
    });
    await waitFor(() => {
      const row = screen.getByRole('link', { name: 'Aukcja 1' }).closest('li') as HTMLElement;
      expect(amount(row, 'Aktualna cena')).toBe('42 zł');
      expect(within(row).getByText(/^3 oferty/u)).toBeDefined();
    });
  });

  it('filtr bez wyników: komunikat zamiast pustej listy; bez przebitych spokojny kafelek', async () => {
    mockApi({
      '/v1/me/bids': {
        ...ACTIVE,
        items: [ACTIVE.items[0]],
        total: 1,
        summary: { leading: 1, outbid: 0, endingSoon: 0 },
      },
    });
    const user = userEvent.setup();
    render(<MyBids status="ACTIVE" />, { wrapper: AppWrapper });
    const tile = (await screen.findByText('Przebito Cię', { selector: 'dt' })).closest('div');
    expect(tile?.getAttribute('data-tone')).toBe('neutral');
    expect(text(tile ?? document.body)).toContain('nikt Cię nie przebił');
    await user.click(screen.getByRole('radio', { name: 'Przebito Cię' }));
    expect(screen.getByText('Brak aukcji, w których ktoś Cię przebił.')).toBeDefined();
  });

  it('przegrane: zwarte wiersze z ceną końcową albo powodem, maksimum i „Szukaj podobnych”', async () => {
    const ended = (index: number, status: 'ENDED_SOLD' | 'ENDED_UNSOLD' | 'CANCELLED') =>
      card(index, { status, price: 6_000, currentPrice: 6_000, endsAt: endsIn(-HOUR) });
    mockApi({
      '/v1/me/bids': {
        items: [
          {
            auction: ended(3, 'ENDED_SOLD'),
            maxAmount: 5_000,
            leading: false,
            outcome: 'LOST',
            order: null,
          },
          {
            auction: ended(4, 'ENDED_UNSOLD'),
            maxAmount: 5_500,
            leading: true,
            outcome: 'RESERVE_NOT_MET',
            order: null,
          },
          {
            auction: ended(5, 'CANCELLED'),
            maxAmount: 2_000,
            leading: true,
            outcome: 'NONE',
            order: null,
          },
        ],
        total: 3,
        page: 1,
        totalPages: 1,
        summary: null,
      },
    });
    render(<MyBids status="LOST" heading="Nie udało się wygrać" />, { wrapper: AppWrapper });
    const section = await screen.findByRole('region', { name: 'Nie udało się wygrać' });
    const rows = within(section).getAllByRole('listitem');
    expect(rows.map((row) => text(row.querySelector('.text-body-sm') ?? row))).toEqual([
      'Cena końcowa 60 zł · Twoje maksimum 50 zł',
      'Cena minimalna nieosiągnięta · Twoje maksimum 55 zł',
      'Aukcja anulowana · Twoje maksimum 20 zł',
    ]);
    expect(
      within(section)
        .getByRole('link', { name: 'Szukaj podobnych: Aukcja 3' })
        .getAttribute('href'),
    ).toBe('/szukaj?q=Aukcja+3');
  });

  it('pusta lista: zachęta do przeglądania', async () => {
    mockApi({
      '/v1/me/bids': { items: [], total: 0, page: 1, totalPages: 0, summary: null },
    });
    render(<MyBids status="WON" />, { wrapper: AppWrapper });
    expect(await screen.findByText('Nie masz jeszcze wygranych aukcji.')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Przeglądaj aukcje' }).getAttribute('href')).toBe(
      '/szukaj',
    );
  });
});

function summary(index: number, overrides: Partial<AuctionSummaryDto> = {}): AuctionSummaryDto {
  return {
    id: `01960000-0000-7000-8000-0000000000c${String(index)}`,
    publicId: `p7q2m4n${String(index)}`,
    status: 'ACTIVE',
    editable: false,
    title: `Wazon ${String(index)}`,
    coverUrl: null,
    currency: 'PLN',
    startPrice: 2_000,
    currentPrice: 3_000,
    bidCount: 6,
    endsAt: endsIn(5 * HOUR),
    updatedAt: new Date().toISOString(),
    order: null,
    completedSteps: null,
    ...overrides,
  };
}

describe('gorąca aukcja sprzedawcy', () => {
  it('najwięcej ofert wśród gorących; przy remisie najbliższy koniec; zimne i zakończone pomijane', () => {
    const now = Date.now();
    const many = summary(1, { bidCount: 9, endsAt: endsIn(20 * HOUR) });
    const soonTie = summary(2, { bidCount: 9, endsAt: endsIn(2 * HOUR) });
    const cold = summary(3, { bidCount: 30, endsAt: endsIn(48 * HOUR) });
    const few = summary(4, { bidCount: 4, endsAt: endsIn(HOUR) });
    const sold = summary(5, { status: 'ENDED_SOLD', bidCount: 40 });
    expect(hottestAuction([many, cold, few, sold, soonTie], now)?.id).toBe(soonTie.id);
    expect(hottestAuction([cold, few, sold], now)).toBeUndefined();
  });

  it('ciemna karta z ceną, przyrostem od startu i licznikiem; cena na żywo z kanału aukcji', async () => {
    const hot = summary(1, { endsAt: endsIn(30 * 60_000) });
    mockApi({ '/v1/me/auctions': [hot] });
    const { realtime, wrapper } = realtimeWrapper();
    render(<HotAuction auctions={[hot, summary(2, { bidCount: 1 })]} />, { wrapper });

    const card = await screen.findByRole('region', { name: 'Wazon 1' });
    expect(within(card).getByText('Twoja aukcja jest gorąca')).toBeDefined();
    expect(within(card).getByText('Live')).toBeDefined();
    expect(text(within(card).getByTestId('hot-price'))).toBe('30 zł');
    expect(text(card)).toContain('+10 zł od startu');
    expect(card.querySelector('[data-tone="urgent"]')).not.toBeNull();
    expect(within(card).getByRole('link', { name: 'Pokaż licytację' }).getAttribute('href')).toBe(
      '/a/wazon-1-p7q2m4n1',
    );

    await waitFor(() => {
      expect(realtime.subscribers(hot.id)).toBe(1);
    });
  });
});

describe('Sales: sprzedane', () => {
  it('zwarte wiersze: stan zamówienia po polsku w tonie, „Nadaj paczkę” przy opłaconym', async () => {
    const sold = (index: number, status: string) =>
      summary(index, {
        status: 'ENDED_SOLD',
        endsAt: endsIn(-HOUR),
        order: {
          id: `01960000-0000-7000-8000-0000000001${String(index)}0`,
          publicId: `B-47${String(index)}0`,
          status: status as 'PAID',
          paymentDueAt: endsIn(24 * HOUR),
        },
      });
    mockApi({
      '/v1/me/auctions': [sold(1, 'PAID'), sold(2, 'SHIPPED'), sold(3, 'AWAITING_PAYMENT')],
    });
    render(<Sales />, { wrapper: AppWrapper });

    expect(await screen.findByText('Opłacone · zamówienie B-4710')).toBeDefined();
    expect(screen.getByText('W drodze · zamówienie B-4720').className).toContain('text-sky-700');
    expect(
      screen.getByText(/^Czeka na płatność kupującego do .* · zamówienie B-4730$/u).className,
    ).toContain('text-amber-700');
    expect(screen.getByRole('link', { name: 'Nadaj paczkę: Wazon 1' }).getAttribute('href')).toBe(
      '/zamowienia/B-4710/nadaj',
    );
    expect(screen.getAllByRole('link', { name: /^Nadaj paczkę/u })).toHaveLength(1);
  });
});

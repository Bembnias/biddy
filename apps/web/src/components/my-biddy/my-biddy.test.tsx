import type { MyBidsDto } from '@biddy/api-client';
import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { RealtimeProvider } from '@/lib/realtime/realtime-provider';
import { mockApi } from '@/test/api';
import { auctionUpdated, publicAuction } from '@/test/auctions';
import { AppWrapper } from '@/test/providers';
import { fakeRealtimeClient } from '@/test/realtime';

import { MyBids } from './my-bids';

const text = (element: Element) => element.textContent.replaceAll(' ', ' ');

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
    endsAt: '2026-10-20T18:00:00.000Z',
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
};

describe('MyBids', () => {
  it('prowadzę / przebito: filtr i następna akcja; cena na żywo z kanału aukcji', async () => {
    mockApi({ '/v1/me/bids': ACTIVE });
    const realtime = fakeRealtimeClient();
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <AppWrapper>
        <RealtimeProvider createClient={() => Promise.resolve(realtime.client)}>
          {children}
        </RealtimeProvider>
      </AppWrapper>
    );
    const user = userEvent.setup();
    render(<MyBids status="ACTIVE" />, { wrapper });

    expect(await screen.findByText(/^Prowadzisz · Twoje maksimum 50,00/u)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Zalicytuj ponownie: Aukcja 2' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Przebito Cię' }));
    expect(screen.queryByText('Aukcja 1')).toBeNull();
    expect(screen.getByText('Aukcja 2')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Wszystkie' }));

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
      const price = screen.getByText(/Aktualna cena 42/u);
      expect(text(price.closest('p') ?? price)).toContain('Aktualna cena 42 zł · 3 oferty');
    });
  });

  it('pusta lista: zachęta do przeglądania', async () => {
    mockApi({ '/v1/me/bids': { items: [], total: 0, page: 1, totalPages: 0 } });
    render(<MyBids status="WON" />, { wrapper: AppWrapper });
    expect(await screen.findByText('Nie masz jeszcze wygranych aukcji.')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Przeglądaj aukcje' }).getAttribute('href')).toBe(
      '/szukaj',
    );
  });
});

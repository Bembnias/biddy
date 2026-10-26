import type { NotificationListDto } from '@biddy/api-client';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { FollowSellerButton } from '@/components/profile/follow-seller-button';
import { RealtimeProvider } from '@/lib/realtime/realtime-provider';
import { apiCalls, mockApi } from '@/test/api';
import { AUCTION_ID, publicAuction } from '@/test/auctions';
import { AppWrapper } from '@/test/providers';
import { fakeRealtimeClient } from '@/test/realtime';

import { WatchButton } from '../auction/watch-button';
import { NotificationBell } from './notification-bell';
import { NotificationList } from './notification-list';
import { NotificationSettings } from './notification-settings';
import { UnsubscribeForm } from './unsubscribe-form';

const USER = {
  id: '01960000-0000-7000-8000-0000000000e1',
  name: 'Kasia',
  avatarUrl: null,
  emailVerified: true,
  termsAccepted: true,
  phoneVerified: true,
};

function notification(index: number, read = false): NotificationListDto['items'][number] {
  return {
    id: `01960000-0000-7000-8000-00000000f${String(100 + index)}`,
    type: 'OUTBID',
    title: `Przebito Twoją ofertę ${String(index)}`,
    body: '„Wazon”: aktualna cena 25 zł.',
    url: '/a/wazon-k3x9qa7m',
    read,
    createdAt: new Date(Date.now() - index * 60_000).toISOString(),
  };
}

describe('NotificationBell', () => {
  it('liczba nieprzeczytanych i aktualizacja na żywo (notification.new)', async () => {
    mockApi({
      '/v1/session': { user: USER },
      '/v1/me/notifications/summary': { unreadCount: 2 },
    });
    const realtime = fakeRealtimeClient();
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <AppWrapper>
        <RealtimeProvider createClient={() => Promise.resolve(realtime.client)}>
          {children}
        </RealtimeProvider>
      </AppWrapper>
    );
    render(<NotificationBell />, { wrapper });
    const bell = await screen.findByRole('link', { name: 'Powiadomienia, 2 nieprzeczytane' });
    expect(bell.getAttribute('href')).toBe('/powiadomienia');
    await waitFor(() => {
      expect(realtime.userSubscribers()).toBe(1);
    });
    act(() => {
      realtime.notification({
        id: 'n1',
        type: 'OUTBID',
        title: 'Przebito Twoją ofertę',
        body: '',
        url: '/a/x-k3x9qa7m',
        createdAt: new Date().toISOString(),
        unreadCount: 12,
      });
    });
    await screen.findByRole('link', { name: 'Powiadomienia, 12 nieprzeczytanych' });
    expect(screen.getByText('9+')).toBeDefined();
  });

  it('gość: bez dzwonka', async () => {
    const fetchMock = mockApi({ '/v1/session': { user: null } });
    render(<NotificationBell />, { wrapper: AppWrapper });
    await waitFor(() => {
      expect(apiCalls(fetchMock, '/v1/session')).toHaveLength(1);
    });
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('NotificationList', () => {
  it('nieprzeczytane wyróżnione, kliknięcie oznacza jako przeczytane, „oznacz wszystkie”', async () => {
    const fetchMock = mockApi({
      '/v1/me/notifications': {
        items: [notification(1), notification(2, true)],
        unreadCount: 1,
        nextBefore: null,
      },
      '/v1/me/notifications/read': { unreadCount: 0 },
    });
    const user = userEvent.setup();
    render(<NotificationList />, { wrapper: AppWrapper });
    const first = await screen.findByRole('link', {
      name: /Nieprzeczytane: Przebito Twoją ofertę 1/u,
    });
    expect(first.getAttribute('href')).toBe('/a/wazon-k3x9qa7m');
    expect(first.getAttribute('data-unread')).toBe('true');
    const read = screen.getByRole('link', { name: /^Przebito Twoją ofertę 2/u });
    expect(read.getAttribute('data-unread')).toBeNull();
    expect(screen.getByText('1 nowe')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Ustawienia powiadomień' }).getAttribute('href')).toBe(
      '/konto/powiadomienia',
    );

    await user.click(screen.getByRole('button', { name: 'Oznacz wszystkie jako przeczytane' }));
    await waitFor(() => {
      expect(apiCalls(fetchMock, '/v1/me/notifications/read').map((call) => call.body)).toEqual([
        { all: true },
      ]);
    });
  });

  it('grupy „Dzisiaj” i „Wcześniej”, ikona w tonie typu', async () => {
    const DAY = 24 * 60 * 60 * 1000;
    mockApi({
      '/v1/me/notifications': {
        items: [
          notification(1),
          {
            ...notification(2, true),
            type: 'WON',
            title: 'Wygrana: Wazon',
            createdAt: new Date(Date.now() - 3 * DAY).toISOString(),
          },
        ],
        unreadCount: 1,
        nextBefore: null,
      },
    });
    render(<NotificationList />, { wrapper: AppWrapper });
    const today = await screen.findByRole('region', { name: 'Dzisiaj' });
    expect(within(today).getByRole('link', { name: /Przebito Twoją ofertę 1/u })).toBeDefined();
    expect(today.querySelector('[data-slot="icon-tile"]')?.className).toContain('bg-urgent');
    const earlier = screen.getByRole('region', { name: 'Wcześniej' });
    expect(within(earlier).getByRole('link', { name: /Wygrana: Wazon/u })).toBeDefined();
    expect(earlier.querySelector('[data-slot="icon-tile"]')?.className).toContain('bg-violet-700');
  });

  it('pusta lista', async () => {
    mockApi({ '/v1/me/notifications': { items: [], unreadCount: 0, nextBefore: null } });
    render(<NotificationList />, { wrapper: AppWrapper });
    expect(await screen.findByText(/Nie masz jeszcze powiadomień/u)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Oznacz wszystkie jako przeczytane' })).toBeNull();
  });
});

describe('NotificationSettings', () => {
  it('przełączniki per typ: zmiana zapisuje się od razu; transakcyjne z kłódką', async () => {
    const items = (enabled: boolean) => [
      { type: 'OUTBID', channel: 'IN_APP', enabled: true, configurable: false },
      { type: 'OUTBID', channel: 'EMAIL', enabled, configurable: true },
      { type: 'WON', channel: 'EMAIL', enabled: true, configurable: false },
    ];
    const fetchMock = mockApi({
      '/v1/me/notification-preferences': (method: string) => ({
        items: items(method === 'GET'),
      }),
    });
    const user = userEvent.setup();
    render(<NotificationSettings />, { wrapper: AppWrapper });
    const outbid = await screen.findByRole('switch', { name: 'Ktoś przebił Twoją ofertę' });
    expect(outbid.getAttribute('aria-checked')).toBe('true');
    expect(outbid.getAttribute('aria-describedby')).not.toBeNull();
    expect(screen.getByText('Najwyżej raz na 15 minut na aukcję')).toBeDefined();

    const bidding = screen.getByRole('region', { name: 'Licytacje' });
    const won = within(bidding).getByText('Wygrana aukcja').closest('li') as HTMLElement;
    expect(within(won).queryByRole('switch')).toBeNull();
    expect(within(won).getByText('Zawsze wysyłamy')).toBeDefined();

    await user.click(outbid);
    expect(within(screen.getByRole('status')).getByText('Zapisano')).toBeDefined();
    expect(outbid.getAttribute('aria-checked')).toBe('false');
    expect(
      apiCalls(fetchMock, '/v1/me/notification-preferences').find((call) => call.body !== undefined)
        ?.body,
    ).toEqual({ items: [{ type: 'OUTBID', channel: 'EMAIL', enabled: false }] });
  });
});

describe('obserwowanie', () => {
  it('aukcja: „Obserwuj” → PUT, „Obserwujesz” → DELETE', async () => {
    const fetchMock = mockApi({
      [`/v1/me/watchlist/${AUCTION_ID}`]: () => new Response(null, { status: 204 }),
    });
    const user = userEvent.setup();
    const auction = publicAuction();
    const bidding = {
      auctionId: AUCTION_ID,
      isSeller: false,
      watching: false,
      hasBid: false,
      leading: false,
      maxAmount: null,
      outcome: 'NONE' as const,
      order: null,
    };
    render(<WatchButton auction={auction} user={USER} bidding={bidding} />, {
      wrapper: AppWrapper,
    });
    await user.click(screen.getByRole('button', { name: 'Obserwuj aukcję' }));
    await waitFor(() => {
      expect(apiCalls(fetchMock, `/v1/me/watchlist/${AUCTION_ID}`)).toHaveLength(1);
    });
    expect(
      fetchMock.mock.calls.map(([, init]) => init?.method).filter((method) => method === 'PUT'),
    ).toHaveLength(1);
  });

  it('aukcja: gość widzi link do logowania, sprzedający nic', () => {
    const auction = publicAuction();
    const { unmount } = render(<WatchButton auction={auction} user={null} bidding={undefined} />, {
      wrapper: AppWrapper,
    });
    expect(screen.getByRole('link', { name: 'Zaloguj się, aby obserwować' })).toBeDefined();
    unmount();
    const { container } = render(
      <WatchButton
        auction={auction}
        user={{ ...USER, id: auction.seller.id }}
        bidding={undefined}
      />,
      { wrapper: AppWrapper },
    );
    expect(container.textContent).toBe('');
  });

  it('sprzedawca: przełącza obserwowanie', async () => {
    const sellerId = '01960000-0000-7000-8000-0000000000b1';
    const fetchMock = mockApi({
      '/v1/session': { user: USER },
      [`/v1/me/followed-sellers/${sellerId}`]: (method: string) =>
        method === 'GET' ? { following: false } : new Response(null, { status: 204 }),
    });
    const user = userEvent.setup();
    render(<FollowSellerButton sellerId={sellerId} sellerName="Ania" />, { wrapper: AppWrapper });
    await user.click(await screen.findByRole('button', { name: 'Obserwuj sprzedawcę' }));
    expect(
      await screen.findByRole('button', { name: 'Przestań obserwować sprzedawcę Ania' }),
    ).toBeDefined();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          (typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url
          ).endsWith(`/followed-sellers/${sellerId}`) && init?.method === 'PUT',
      ),
    ).toBe(true);
  });
});

describe('UnsubscribeForm', () => {
  it('pokazuje typ i wypisuje jednym przyciskiem', async () => {
    const fetchMock = mockApi({
      '/v1/notifications/unsubscribe': (method: string) => ({
        scope: 'OUTBID',
        types: ['OUTBID'],
        ...(method === 'POST' ? {} : {}),
      }),
    });
    const user = userEvent.setup();
    render(<UnsubscribeForm token="abc.def-ghi-jkl" />, { wrapper: AppWrapper });
    expect(
      await screen.findByText(/Nie będziemy wysyłać e-maili tego typu: Ktoś przebił/u),
    ).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Wypisz mnie' }));
    const status = await screen.findByRole('status');
    expect(within(status).getByText('Gotowe: wypisaliśmy Cię z tych e-maili.')).toBeDefined();
    expect(
      apiCalls(fetchMock, '/v1/notifications/unsubscribe').find((call) => call.body !== undefined)
        ?.body,
    ).toEqual({ token: 'abc.def-ghi-jkl' });
  });

  it('zły token: komunikat i link do ustawień', async () => {
    mockApi({
      '/v1/notifications/unsubscribe': () =>
        Response.json(
          {
            type: 'https://biddy.pl/problems/validation-failed',
            title: 'Błąd',
            status: 400,
            detail: 'Link wypisania jest nieprawidłowy.',
            instance: '/v1/notifications/unsubscribe',
            code: 'VALIDATION_FAILED',
            requestId: 'test',
          },
          { status: 400, headers: { 'content-type': 'application/problem+json' } },
        ),
    });
    render(<UnsubscribeForm token="zly-token-0123" />, { wrapper: AppWrapper });
    expect(await screen.findByText(/Link wypisania jest nieprawidłowy/u)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Ustawienia powiadomień' })).toBeDefined();
  });
});

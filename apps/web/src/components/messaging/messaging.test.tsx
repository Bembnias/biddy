import type { ConversationDto, ConversationStartDto, MessageDto } from '@biddy/api-client';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { RealtimeProvider } from '@/lib/realtime/realtime-provider';
import { apiCalls, mockApi } from '@/test/api';
import { AppWrapper } from '@/test/providers';
import { fakeRealtimeClient } from '@/test/realtime';

import { AskSellerButton } from './ask-seller-button';
import { ConversationList } from './conversation-list';
import { ConversationThread } from './conversation-thread';
import { MessagesLink } from './messages-link';
import { NewConversation } from './new-conversation';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace }) }));

const USER = {
  id: '01960000-0000-7000-8000-0000000000e1',
  name: 'Kasia',
  avatarUrl: null,
  emailVerified: true,
  termsAccepted: true,
  phoneVerified: true,
};
const SELLER_ID = '01960000-0000-7000-8000-0000000000e2';
const AUCTION_ID = '01960000-0000-7000-8000-0000000000a1';
const ID = '01960000-0000-7000-8000-0000000000c1';
const PATH = `/v1/conversations/${ID}`;

function conversation(overrides: Partial<ConversationDto> = {}): ConversationDto {
  return {
    id: ID,
    role: 'BUYER',
    counterpart: { id: SELLER_ID, name: 'Anna', avatarUrl: null, available: true },
    auction: {
      id: AUCTION_ID,
      publicId: 'k3x9qa7p',
      slug: 'lampa-biurkowa-lata-60',
      title: 'Lampa biurkowa, lata 60.',
      coverUrl: null,
      status: 'ACTIVE',
    },
    order: null,
    lastMessage: {
      preview: 'Nie ma rys.',
      senderRole: 'SELLER',
      hasPhotos: false,
      createdAt: '2026-11-03T10:05:00.000Z',
    },
    unreadCount: 1,
    lastMessageAt: '2026-11-03T10:05:00.000Z',
    canSend: true,
    blockedByMe: false,
    ...overrides,
  };
}

function message(overrides: Partial<MessageDto> & Pick<MessageDto, 'id'>): MessageDto {
  return {
    senderRole: 'BUYER',
    body: 'Czy klosz ma rysy?',
    photos: [],
    contactFlags: [],
    createdAt: '2026-11-03T10:00:00.000Z',
    readAt: '2026-11-03T10:01:00.000Z',
    ...overrides,
  };
}

/** Wiadomości najnowsze pierwsze, jak z API. */
const MESSAGES: MessageDto[] = [
  message({
    id: '01960000-0000-7000-8000-0000000000m3',
    senderRole: 'SELLER',
    body: 'Zadzwoń: 600 700 800',
    contactFlags: ['PHONE'],
    createdAt: '2026-11-03T10:05:00.000Z',
    readAt: null,
  }),
  message({ id: '01960000-0000-7000-8000-0000000000m1' }),
];

function withRealtime(realtime: ReturnType<typeof fakeRealtimeClient>) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <AppWrapper>
        <RealtimeProvider createClient={() => Promise.resolve(realtime.client)}>
          {children}
        </RealtimeProvider>
      </AppWrapper>
    );
  };
}

describe('MessagesLink', () => {
  it('liczba rozmów z nieprzeczytanymi i aktualizacja na żywo', async () => {
    mockApi({ '/v1/session': { user: USER }, '/v1/conversations/summary': { unreadCount: 1 } });
    const realtime = fakeRealtimeClient();
    render(<MessagesLink />, { wrapper: withRealtime(realtime) });
    const link = await screen.findByRole('link', {
      name: 'Wiadomości: 1 rozmowa z nieprzeczytanymi',
    });
    expect(link.getAttribute('href')).toBe('/wiadomosci');
    await waitFor(() => {
      expect(realtime.userSubscribers()).toBe(1);
    });
    act(() => {
      realtime.message({
        conversationId: ID,
        messageId: 'm',
        senderId: SELLER_ID,
        createdAt: new Date().toISOString(),
        unreadCount: 3,
        serverTime: new Date().toISOString(),
      });
    });
    await screen.findByRole('link', { name: 'Wiadomości: 3 rozmowy z nieprzeczytanymi' });
  });
});

describe('ConversationList', () => {
  it('druga strona, aukcja, zamówienie, własna ostatnia wiadomość i nieprzeczytane', async () => {
    mockApi({
      '/v1/conversations': {
        items: [
          conversation(),
          conversation({
            id: '01960000-0000-7000-8000-0000000000c2',
            role: 'SELLER',
            counterpart: { id: USER.id, name: 'Jan', avatarUrl: null, available: true },
            order: { id: 'o', publicId: 'p7q2m4nx', status: 'PAID' },
            lastMessage: {
              preview: 'Wyślę jutro.',
              senderRole: 'SELLER',
              hasPhotos: false,
              createdAt: '2026-11-02T10:00:00.000Z',
            },
            unreadCount: 0,
          }),
        ],
        nextBefore: null,
      },
    });
    render(<ConversationList activeId={ID} />, { wrapper: AppWrapper });
    const first = await screen.findByRole('link', { name: /Anna/ });
    expect(first.getAttribute('aria-current')).toBe('page');
    expect(within(first).getByText('Nie ma rys.')).toBeDefined();
    expect(within(first).getByText('1 nieprzeczytana wiadomość')).toBeDefined();
    const second = screen.getByRole('link', { name: /Jan/ });
    expect(second.getAttribute('href')).toBe('/wiadomosci/01960000-0000-7000-8000-0000000000c2');
    expect(within(second).getByText('Ty: Wyślę jutro.')).toBeDefined();
    expect(within(second).getByText(/zamówienie: Opłacone/)).toBeDefined();
  });

  it('pusty stan z podpowiedzią', async () => {
    mockApi({ '/v1/conversations': { items: [], nextBefore: null } });
    render(<ConversationList />, { wrapper: AppWrapper });
    expect(await screen.findByText('Nie masz jeszcze wiadomości')).toBeDefined();
  });
});

describe('ConversationThread', () => {
  it('wiadomości z ostrzeżeniem, odczyt, podpowiedź i wysyłka', async () => {
    const fetchMock = mockApi({
      [PATH]: conversation(),
      [`${PATH}/messages`]: (method: string) =>
        method === 'POST'
          ? new Response(
              JSON.stringify(message({ id: '01960000-0000-7000-8000-0000000000m4', body: 'Ok' })),
              { status: 201, headers: { 'content-type': 'application/json' } },
            )
          : { items: MESSAGES, nextBefore: null },
      [`${PATH}/read`]: { unreadCount: 0 },
    });
    render(<ConversationThread conversationId={ID} />, { wrapper: AppWrapper });

    expect(await screen.findByRole('heading', { name: 'Anna' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Lampa biurkowa, lata 60.' })).toBeDefined();
    const flagged = await screen.findByText('Zadzwoń: 600 700 800');
    const bubble = flagged.closest('li');
    expect(bubble).not.toBeNull();
    expect(within(bubble as HTMLElement).getByRole('note').textContent).toContain(
      'Ta wiadomość zawiera numer telefonu',
    );
    // Własna wiadomość przeczytana przez drugą stronę.
    expect(screen.getByText(/Przeczytano/)).toBeDefined();
    // Nieprzeczytana wiadomość drugiej strony: odczyt po otwarciu.
    await waitFor(() => {
      expect(apiCalls(fetchMock, `${PATH}/read`)).toHaveLength(1);
    });

    const field = screen.getByLabelText('Wiadomość');
    await userEvent.type(field, 'pisz na jan@wp.pl');
    expect(screen.getByText(/Wygląda na adres e-mail/)).toBeDefined();
    await userEvent.clear(field);
    await userEvent.type(field, 'Dziękuję, biorę.{Enter}');
    await waitFor(() => {
      expect(
        apiCalls(fetchMock, `${PATH}/messages`).find((call) => call.body !== undefined)?.body,
      ).toEqual({ body: 'Dziękuję, biorę.', mediaIds: [] });
    });
    await waitFor(() => {
      expect((field as HTMLTextAreaElement).value).toBe('');
    });
  });

  it('blokada: zamiast pola komunikat i „Odblokuj” dla blokującego', async () => {
    const fetchMock = mockApi({
      [PATH]: conversation({ canSend: false, blockedByMe: true, unreadCount: 0 }),
      [`${PATH}/messages`]: { items: [MESSAGES[1]], nextBefore: null },
      [`/v1/me/blocks/${SELLER_ID}`]: (method: string) =>
        method === 'DELETE' ? new Response(null, { status: 204 }) : undefined,
    });
    render(<ConversationThread conversationId={ID} />, { wrapper: AppWrapper });
    expect(
      await screen.findByText('Zablokowano tę osobę. Odblokuj ją, żeby napisać.'),
    ).toBeDefined();
    expect(screen.queryByLabelText('Wiadomość')).toBeNull();
    const [unblock] = screen.getAllByRole('button', { name: 'Odblokuj' });
    await userEvent.click(unblock as HTMLElement);
    await waitFor(() => {
      expect(apiCalls(fetchMock, `/v1/me/blocks/${SELLER_ID}`)).toHaveLength(1);
    });
  });

  it('zgłoszenie wiadomości z blokadą: powód wymagany, potem potwierdzenie', async () => {
    const reportPath = `${PATH}/report`;
    const fetchMock = mockApi({
      [PATH]: conversation({ unreadCount: 0 }),
      [`${PATH}/messages`]: { items: MESSAGES, nextBefore: null },
      [`${PATH}/read`]: { unreadCount: 0 },
      [reportPath]: new Response(JSON.stringify({ id: 'r1', blocked: true }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    });
    render(<ConversationThread conversationId={ID} />, { wrapper: AppWrapper });
    await userEvent.click(await screen.findByRole('button', { name: 'Zgłoś wiadomość' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Zgłoś wiadomość' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wyślij zgłoszenie' }));
    expect(within(dialog).getByText('Wybierz powód zgłoszenia.')).toBeDefined();
    await userEvent.click(
      within(dialog).getByRole('radio', { name: 'Namawia do płatności lub kontaktu poza Biddy' }),
    );
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Zablokuj też tę osobę' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wyślij zgłoszenie' }));
    expect(await screen.findByText('Dziękujemy. Zespół Biddy sprawdzi zgłoszenie.')).toBeDefined();
    expect(apiCalls(fetchMock, reportPath)[0]?.body).toEqual({
      reason: 'OFF_PLATFORM',
      messageId: '01960000-0000-7000-8000-0000000000m3',
      block: true,
    });
  });

  it('obca albo nieistniejąca rozmowa: komunikat', async () => {
    mockApi({});
    render(<ConversationThread conversationId={ID} />, { wrapper: AppWrapper });
    expect(await screen.findByRole('heading', { name: 'Nie znaleziono rozmowy' })).toBeDefined();
  });
});

function start(overrides: Partial<ConversationStartDto> = {}): ConversationStartDto {
  const base = conversation();
  return {
    conversationId: null,
    role: 'BUYER',
    counterpart: base.counterpart,
    auction: base.auction,
    order: null,
    unavailableReason: null,
    canSend: true,
    blockedByMe: false,
    ...overrides,
  };
}

describe('NewConversation', () => {
  it('pierwsza wiadomość tworzy rozmowę i prowadzi do niej', async () => {
    const fetchMock = mockApi({
      '/v1/conversations/start': start(),
      '/v1/conversations': new Response(JSON.stringify(conversation()), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    });
    render(<NewConversation subject={{ auctionId: AUCTION_ID }} />, { wrapper: AppWrapper });
    expect(await screen.findByText('Do: Anna')).toBeDefined();
    expect(screen.getByText(/Nie podawaj telefonu ani numeru konta/)).toBeDefined();
    await userEvent.type(screen.getByLabelText('Wiadomość'), 'Czy klosz ma rysy?');
    await userEvent.click(screen.getByRole('button', { name: 'Wyślij' }));
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(`/wiadomosci/${ID}`);
    });
    expect(apiCalls(fetchMock, '/v1/conversations')[0]?.body).toEqual({
      auctionId: AUCTION_ID,
      body: 'Czy klosz ma rysy?',
      mediaIds: [],
    });
  });

  it('zakończona aukcja: powód bez pola wiadomości; istniejąca rozmowa: przekierowanie', async () => {
    mockApi({
      '/v1/conversations/start': start({ unavailableReason: 'AUCTION_CLOSED', canSend: false }),
    });
    const { unmount } = render(<NewConversation subject={{ auctionId: AUCTION_ID }} />, {
      wrapper: AppWrapper,
    });
    expect(
      await screen.findByText('Aukcja się zakończyła, więc nie można już o nią zapytać.'),
    ).toBeDefined();
    expect(screen.queryByLabelText('Wiadomość')).toBeNull();
    unmount();

    replace.mockClear();
    mockApi({ '/v1/conversations/start': start({ conversationId: ID }) });
    render(<NewConversation subject={{ orderId: 'p7q2m4nx' }} />, { wrapper: AppWrapper });
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(`/wiadomosci/${ID}`);
    });
  });
});

describe('AskSellerButton', () => {
  it('gość: logowanie z powrotem; sprzedający: bez przycisku', async () => {
    mockApi({ '/v1/session': { user: null } });
    const { unmount } = render(<AskSellerButton auctionId={AUCTION_ID} sellerId={SELLER_ID} />, {
      wrapper: AppWrapper,
    });
    const link = await screen.findByRole('link', { name: 'Zapytaj sprzedającego' });
    expect(decodeURIComponent(link.getAttribute('href') ?? '')).toBe(
      `/logowanie?next=/wiadomosci/nowa?aukcja=${AUCTION_ID}`,
    );
    unmount();

    const fetchMock = mockApi({ '/v1/session': { user: { ...USER, id: SELLER_ID } } });
    render(<AskSellerButton auctionId={AUCTION_ID} sellerId={SELLER_ID} />, {
      wrapper: AppWrapper,
    });
    await waitFor(() => {
      expect(apiCalls(fetchMock, '/v1/session')).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.queryByRole('link')).toBeNull();
    });
  });
});

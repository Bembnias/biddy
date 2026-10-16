// Moje Biddy (F-21) na `next start`: zakładki, licytacje z następną akcją i aktualizacją przez
// WebSocket, wygrane (nieaktywne „Zapłać”), obserwowane (przestań obserwować), sprzedane
// i przekierowanie dawnego adresu Moich aukcji.
import AxeBuilder from '@axe-core/playwright';

import { type Page, expect, test } from '@playwright/test';

import { MEMBER, SESSIONS } from './mock-api';
import {
  type Responder,
  gotoHydrated,
  mockBrowserApi,
  mockRealtime,
  ok,
  settle,
  signInAs,
} from './support';

async function expectNoAxeViolations(page: Page) {
  await settle(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
}

const USER = {
  id: MEMBER.id,
  name: MEMBER.name,
  avatarUrl: null,
  emailVerified: true,
  termsAccepted: true,
  phoneVerified: true,
};

function card(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `01960000-0000-7000-8000-0000000000a${String(index)}`,
    publicId: `k3x9qa7${'mn'[index % 2] ?? 'm'}`,
    slug: `aukcja-${String(index)}`,
    title: `Aukcja ${String(index)}`,
    status: 'ACTIVE',
    currency: 'PLN',
    price: 3_000,
    currentPrice: 3_000,
    bidCount: 2,
    endsAt: '2026-12-20T18:00:00.000Z',
    coverUrl: null,
    coverThumbUrl: null,
    ...overrides,
  };
}

const page1 = (items: unknown[]) => ({ items, total: items.length, page: 1, totalPages: 1 });

const BIDS: Record<string, unknown> = {
  ACTIVE: page1([
    { auction: card(1), maxAmount: 5_000, leading: true, outcome: 'NONE', order: null },
    { auction: card(2), maxAmount: 2_500, leading: false, outcome: 'NONE', order: null },
  ]),
  LOST: page1([
    {
      auction: card(3, { status: 'ENDED_SOLD' }),
      maxAmount: 2_000,
      leading: false,
      outcome: 'LOST',
      order: null,
    },
  ]),
  WON: page1([
    {
      auction: card(4, { status: 'ENDED_SOLD', price: 10_000 }),
      maxAmount: 10_000,
      leading: true,
      outcome: 'WON',
      order: {
        id: '01960000-0000-7000-8000-000000000101',
        publicId: 'p7q2m4nx',
        status: 'AWAITING_PAYMENT',
        currency: 'PLN',
        total: 10_999,
        paymentDueAt: '2026-12-21T18:00:00.000Z',
      },
    },
  ]),
};

const bidsResponder: Responder = (request) =>
  ok(BIDS[new URL(request.url()).searchParams.get('status') ?? ''] ?? page1([]));

async function signedIn(page: Page, extra: Record<string, Responder> = {}) {
  return mockBrowserApi(page, {
    'GET /v1/session': ok({ user: USER }),
    'GET /v1/me/notifications/summary': ok({ unreadCount: 0 }),
    'GET /v1/me/bids': bidsResponder,
    ...extra,
  });
}

test('Licytuję: prowadzę / przebito z akcjami, przegrane, cena na żywo', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, SESSIONS.phoneVerified, baseURL);
  await signedIn(page);
  const realtime = await mockRealtime(page);
  await gotoHydrated(page, '/moje-biddy');
  const tabs = page.getByRole('navigation', { name: 'Sekcje Moje Biddy' });
  await expect(tabs.getByRole('link', { name: 'Licytuję' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByText(/^Prowadzisz · Twoje maksimum 50,00/u)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Zalicytuj ponownie: Aukcja 2' })).toHaveAttribute(
    'href',
    '/a/aukcja-2-k3x9qa7m',
  );
  await expect(page.getByRole('region', { name: 'Nie udało się wygrać' })).toContainText(
    'Aukcja 3',
  );
  await expectNoAxeViolations(page);

  await page.getByRole('button', { name: 'Przebito Cię' }).click();
  await expect(page.getByText('Aukcja 1')).toHaveCount(0);
  await page.getByRole('button', { name: 'Wszystkie' }).click();

  await realtime.subscribed(card(1).id);
  realtime.send('auction.updated', {
    auctionId: card(1).id,
    version: 7,
    status: 'ACTIVE',
    currency: 'PLN',
    currentPrice: 4_200,
    bidCount: 3,
    leader: { publicName: 'k***a' },
    endsAt: '2026-12-20T18:00:00.000Z',
    reserveStatus: 'NONE',
    minimumNextBid: 4_300,
    buyNowAvailable: false,
    serverTime: new Date().toISOString(),
  });
  await expect(page.getByText(/Aktualna cena 42\s+zł/u)).toBeVisible();
});

test('Wygrane, obserwowane i sprzedane: następne kroki', async ({ page, context, baseURL }) => {
  await signInAs(context, SESSIONS.phoneVerified, baseURL);
  let watchlist = [card(5), card(6, { status: 'ENDED_UNSOLD' })];
  const api = await signedIn(page, {
    'GET /v1/me/watchlist': () => ok({ items: watchlist }),
    [`DELETE /v1/me/watchlist/${card(6).id}`]: () => {
      watchlist = [card(5)];
      return { status: 204 };
    },
    'GET /v1/me/auctions': ok([
      {
        id: card(7).id,
        publicId: 'k3x9qa7p',
        status: 'ENDED_SOLD',
        editable: false,
        title: 'Sprzedany wazon',
        coverUrl: null,
        currency: 'PLN',
        startPrice: 2_000,
        currentPrice: 6_000,
        bidCount: 4,
        endsAt: '2026-10-10T18:00:00.000Z',
        updatedAt: '2026-10-10T18:00:00.000Z',
        order: {
          id: '01960000-0000-7000-8000-000000000102',
          publicId: 'q8r3m5py',
          status: 'AWAITING_PAYMENT',
          paymentDueAt: '2026-10-11T18:00:00.000Z',
        },
      },
    ]),
  });
  await mockRealtime(page);

  await gotoHydrated(page, '/moje-biddy/wygrane');
  await expect(page.getByText(/Do zapłaty 109,99\s+zł \(bez dostawy\)/u)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zapłać' })).toBeDisabled();
  await expect(page.getByText('Płatność online uruchomimy wkrótce.')).toBeVisible();

  await page.getByRole('link', { name: 'Obserwowane' }).click();
  await expect(page).toHaveURL('/moje-biddy/obserwowane');
  await expect(page.getByRole('link', { name: 'Licytuj: Aukcja 5' })).toBeVisible();
  await page.getByRole('button', { name: 'Przestań obserwować: Aukcja 6' }).click();
  await expect(page.getByText('Aukcja 6')).toHaveCount(0);
  expect(api.requests(`DELETE /v1/me/watchlist/${card(6).id}`)).toHaveLength(1);
  await expectNoAxeViolations(page);

  await page.getByRole('link', { name: 'Sprzedane' }).click();
  await expect(
    page.getByText(/Czeka na płatność kupującego do .* · zamówienie q8r3m5py/u),
  ).toBeVisible();
});

test('dawny adres Moich aukcji przekierowuje do Moje Biddy z parametrami', async ({ request }) => {
  const response = await request.get('/konto/aukcje?opublikowano=abc', { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(new Set(response.headers()['location']?.split(', '))).toEqual(
    new Set(['/moje-biddy/aukcje?opublikowano=abc']),
  );
});

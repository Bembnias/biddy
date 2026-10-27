// Moje Biddy (F-21, układ F-63) na `next start`: zakładki, podsumowanie licytacji, wyróżnione
// przebite z następną akcją i aktualizacją przez WebSocket, wygrane („Zapłać” do checkoutu, F-25),
// obserwowane (przestań obserwować), sprzedane, Moje aukcje z gorącą aukcją (także na telefonie)
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
  setSsrAuctions,
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

const page1 = (items: unknown[], summary: unknown = null) => ({
  items,
  total: items.length,
  page: 1,
  totalPages: 1,
  summary,
});

const BIDS: Record<string, unknown> = {
  ACTIVE: page1(
    [
      { auction: card(1), maxAmount: 5_000, leading: true, outcome: 'NONE', order: null },
      { auction: card(2), maxAmount: 2_500, leading: false, outcome: 'NONE', order: null },
    ],
    { leading: 1, outbid: 1, endingSoon: 0 },
  ),
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
  const summary = page.getByRole('main').locator('dl').first();
  await expect(summary.locator('[data-tone="urgent"]')).toContainText('Przebito Cię1');
  const leading = page.getByRole('listitem').filter({ hasText: 'Aukcja 1' });
  await expect(leading.getByText('Prowadzisz', { exact: true })).toBeVisible();
  await expect(leading.getByText(/^50\s+zł$/u)).toBeVisible();
  const outbid = page.getByRole('listitem').filter({ hasText: 'Aukcja 2' });
  await expect(outbid).toHaveAttribute('data-tone', 'urgent');
  await expect(outbid.getByRole('link', { name: 'Zalicytuj ponownie: Aukcja 2' })).toHaveAttribute(
    'href',
    '/a/aukcja-2-k3x9qa7m',
  );
  await expect(page.getByRole('region', { name: 'Nie udało się wygrać' })).toContainText(
    'Aukcja 3',
  );
  await expectNoAxeViolations(page);

  await page.getByRole('radio', { name: 'Przebito Cię' }).click();
  await expect(page.getByText('Aukcja 1')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Wszystkie' }).click();

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
  await expect(leading.getByText(/^42\s+zł$/u)).toBeVisible();
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
  await expect(page.getByRole('link', { name: /^Zapłać: / })).toHaveAttribute(
    'href',
    '/zamowienia/p7q2m4nx/zaplac',
  );

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

test('Moje aukcje: gorąca aukcja, filtry z liczbą pozycji; telefon 390 px bez przewijania w poziomie', async ({
  page,
  context,
  baseURL,
}) => {
  const session = `${SESSIONS.phoneVerified}-hot`;
  await signInAs(context, session, baseURL);
  const listing = (index: number, overrides: Record<string, unknown>) => ({
    id: `01960000-0000-7000-8000-0000000000d${String(index)}`,
    publicId: `h0t9qa7${String(index)}`,
    status: 'ACTIVE',
    editable: false,
    title: `Lampa ${String(index)}`,
    currency: 'PLN',
    startPrice: 12_000,
    bidCount: 0,
    endsAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    updatedAt: new Date().toISOString(),
    photos: [],
    ...overrides,
  });
  const auctions = [
    listing(1, { bidCount: 7 }),
    listing(2, { editable: true, endsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() }),
    listing(3, { status: 'DRAFT', editable: true, endsAt: null }),
  ];
  await setSsrAuctions(session, auctions);
  await signedIn(page, {
    'GET /v1/me/auctions': ok(
      auctions.map(({ photos: _photos, ...auction }) => ({
        ...auction,
        coverUrl: null,
        currentPrice: null,
        order: null,
      })),
    ),
  });
  await mockRealtime(page);
  await gotoHydrated(page, '/moje-biddy/aukcje');

  const hot = page.getByRole('region', { name: 'Lampa 1' });
  await expect(hot).toContainText('Twoja aukcja jest gorąca');
  await expect(hot.getByText('Live')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aktywne 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Szkice 1' })).toBeVisible();
  const bidding = page.getByRole('listitem').filter({ hasText: 'Trwa licytacja' });
  await expect(bidding.getByRole('link', { name: 'Pokaż licytację: Lampa 1' })).toBeVisible();
  const noBids = page.getByRole('listitem').filter({ hasText: 'Lampa 2' });
  await expect(noBids).toContainText('Bez ofert · możesz jeszcze edytować');
  await expect(noBids.getByRole('button', { name: 'Anuluj aukcję' })).toBeVisible();
  await expectNoAxeViolations(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: 'Szybka nawigacja' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'Wystaw przedmiot' })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expectNoAxeViolations(page);
});

test('dawny adres Moich aukcji przekierowuje do Moje Biddy z parametrami', async ({ request }) => {
  const response = await request.get('/konto/aukcje?opublikowano=abc', { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(new Set(response.headers()['location']?.split(', '))).toEqual(
    new Set(['/moje-biddy/aukcje?opublikowano=abc']),
  );
});

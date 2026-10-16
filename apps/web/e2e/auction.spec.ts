// Strona aukcji (F-18) na `next start`: HTML bez JavaScriptu (cena, JSON-LD, OG) z ISR
// i rewalidacją na żądanie, przekierowanie sluga, 404, bramki licytowania, oferta z ceną łączną
// i potwierdzeniem oraz aktualizacja na żywo przez WebSocket (atrapa Socket.IO).
import AxeBuilder from '@axe-core/playwright';
import { randomInt, randomUUID } from 'node:crypto';

import { type Page, expect, test } from '@playwright/test';

import { FEE_SCHEDULE, REVALIDATE_SECRET } from './mock-api';
import {
  gotoHydrated,
  mockBrowserApi,
  mockRealtime,
  ok,
  setSsrPublicAuction,
  settle,
} from './support';

const PUBLIC_ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Aukcja z unikalnym identyfikatorem: strony ISR z różnych testów nie dzielą cache. */
function auctionFixture(overrides: Record<string, unknown> = {}) {
  const publicId = Array.from(
    { length: 8 },
    () => PUBLIC_ID_ALPHABET[randomInt(PUBLIC_ID_ALPHABET.length)],
  ).join('');
  return {
    id: randomUUID(),
    publicId,
    slug: 'wazon-ceramiczny-lata-70',
    status: 'ACTIVE',
    currency: 'PLN',
    title: 'Wazon ceramiczny, lata 70.',
    description: 'Ręcznie malowany wazon, bez pęknięć i odprysków. Wysokość 30 cm.',
    condition: 'VERY_GOOD',
    brand: null,
    category: [
      { id: randomUUID(), slug: 'dom-i-ogrod', name: 'Dom i ogród' },
      { id: randomUUID(), slug: 'dekoracje', name: 'Dekoracje' },
    ],
    attributes: [],
    photos: [
      {
        id: randomUUID(),
        urls: {
          thumb: 'https://media.example/wazon-thumb.webp',
          medium: 'https://media.example/wazon-medium.webp',
          large: 'https://media.example/wazon-large.webp',
        },
      },
    ],
    packageSize: 'M',
    carriers: [{ id: 'inpost-paczkomat', name: 'InPost Paczkomat 24/7', kind: 'LOCKER' }],
    seller: {
      id: '01960000-0000-7000-8000-0000000000b1',
      name: 'Sprzedawca Testowy',
      avatarUrl: null,
      memberSince: '2026-01-10T10:00:00.000Z',
      phoneVerified: true,
      kind: 'PRIVATE',
    },
    startPrice: 2_000,
    currentPrice: null,
    bidCount: 0,
    leader: null,
    minimumNextBid: 2_000,
    reserveStatus: 'NONE',
    buyNowPrice: null,
    buyNowAvailable: false,
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    endsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    version: 1,
    extensionWindowSeconds: 120,
    serverTime: new Date().toISOString(),
    ...overrides,
  };
}

type Auction = ReturnType<typeof auctionFixture>;

const pathOf = (auction: Auction) => `/a/${auction.slug}-${auction.publicId}`;

const BUYER = {
  id: '01960000-0000-7000-8000-0000000000e1',
  name: 'Kasia Kupująca',
  avatarUrl: null,
  emailVerified: true,
  termsAccepted: true,
  phoneVerified: true,
};

function myBidding(auction: Auction) {
  return {
    auctionId: auction.id,
    isSeller: false,
    watching: false,
    hasBid: false,
    leading: false,
    maxAmount: null,
    outcome: 'NONE',
    order: null,
  };
}

/** API przeglądarki dla strony aukcji (sesja, aukcja, stan użytkownika, cennik, historia). */
function browserApi(auction: Auction, user: typeof BUYER | null) {
  return {
    'GET /v1/session': ok({ user }),
    [`GET /v1/auctions/${auction.publicId}`]: ok(auction),
    [`GET /v1/me/bids/${auction.publicId}`]: ok(myBidding(auction)),
    'GET /v1/fee-schedules/current': ok(FEE_SCHEDULE),
    [`GET /v1/auctions/${auction.id}/bids`]: ok({ currency: 'PLN', items: [], nextBefore: null }),
  };
}

async function expectNoAxeViolations(page: Page) {
  await settle(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
}

test('HTML bez JavaScriptu: cena, JSON-LD i OG; stary slug przekierowuje, nieznana aukcja 404', async ({
  request,
}) => {
  const auction = auctionFixture();
  await setSsrPublicAuction(auction);

  const response = await request.get(pathOf(auction));
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain('<h1');
  expect(html).toContain('Wazon ceramiczny, lata 70.');
  expect(html).toContain('20 zł');
  expect(html).toMatch(/<script type="application\/ld\+json">[^<]*"@type":"Product"/u);
  expect(html).toContain('"price":"20.00"');
  expect(html).toContain(
    '<meta property="og:image" content="https://media.example/wazon-large.webp"/>',
  );
  expect(html).toMatch(new RegExp(`<link rel="canonical" href="[^"]*${pathOf(auction)}"/>`, 'u'));

  const old = await request.get(`/a/stary-tytul-${auction.publicId}`, { maxRedirects: 0 });
  expect(old.status()).toBe(308);
  // Next.js przy chybieniu cache ISR wysyła nagłówek Location dwa razy (z tą samą wartością).
  expect(new Set(old.headers()['location']?.split(', '))).toEqual(new Set([pathOf(auction)]));

  expect((await request.get('/a/nie-ma-takiej-aukcji-zzzzzzzz')).status()).toBe(404);
  expect((await request.get('/a/bez-identyfikatora')).status()).toBe(404);
});

test('rewalidacja: po POST /api/revalidate HTML pokazuje nową cenę', async ({ request }) => {
  const auction = auctionFixture();
  await setSsrPublicAuction(auction);
  expect(await (await request.get(pathOf(auction))).text()).toContain('20 zł');

  await setSsrPublicAuction({ ...auction, currentPrice: 4_500, bidCount: 3, version: 2 });
  // Bez rewalidacji strona przychodzi z cache ISR (60 s).
  expect(await (await request.get(pathOf(auction))).text()).not.toContain('45 zł');

  const tags = [`auction:${auction.publicId}`];
  const denied = await request.post('/api/revalidate', {
    headers: { authorization: 'Bearer zly-sekret' },
    data: { tags },
  });
  expect(denied.status()).toBe(401);
  const invalid = await request.post('/api/revalidate', {
    headers: { authorization: `Bearer ${REVALIDATE_SECRET}` },
    data: { tags: ['profile:abc'] },
  });
  expect(invalid.status()).toBe(400);
  const revalidated = await request.post('/api/revalidate', {
    headers: { authorization: `Bearer ${REVALIDATE_SECRET}` },
    data: { tags },
  });
  expect(revalidated.status()).toBe(200);

  const fresh = await (await request.get(pathOf(auction))).text();
  expect(fresh).toContain('45 zł');
  expect(fresh).toContain('3 oferty');
});

test('gość: logowanie z powrotem na aukcję; bez telefonu: zachęta do weryfikacji', async ({
  page,
}) => {
  const auction = auctionFixture();
  await setSsrPublicAuction(auction);
  await mockBrowserApi(page, browserApi(auction, null));
  await mockRealtime(page);
  // Stary slug: przeglądarka trafia na adres kanoniczny.
  await gotoHydrated(page, `/a/stary-tytul-${auction.publicId}`);
  await expect(page).toHaveURL(pathOf(auction));
  const login = page.getByRole('link', { name: 'Zaloguj się, aby licytować' });
  await expect(login).toHaveAttribute(
    'href',
    `/logowanie?next=${encodeURIComponent(pathOf(auction))}`,
  );
  await expect(page.getByRole('button', { name: 'Licytuj' })).toHaveCount(0);
  await expectNoAxeViolations(page);

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await mockBrowserApi(page, browserApi(auction, { ...BUYER, phoneVerified: false }));
  await mockRealtime(page);
  await gotoHydrated(page, pathOf(auction));
  await expect(
    page.getByRole('link', { name: 'Zweryfikuj telefon, aby licytować' }),
  ).toHaveAttribute('href', `/weryfikacja-telefonu?next=${encodeURIComponent(pathOf(auction))}`);
  await expect(page.getByRole('button', { name: 'Licytuj' })).toHaveCount(0);
});

test('oferta: cena łączna, potwierdzenie, Idempotency-Key; cena na żywo bez odświeżania', async ({
  page,
}) => {
  const auction = auctionFixture();
  await setSsrPublicAuction(auction);
  const api = await mockBrowserApi(page, {
    ...browserApi(auction, BUYER),
    [`POST /v1/auctions/${auction.id}/bids`]: {
      status: 201,
      json: {
        bid: {
          id: randomUUID(),
          amount: 2_000,
          maxAmount: 50_000,
          kind: 'MANUAL',
          createdAt: new Date().toISOString(),
        },
        leading: true,
        auction: {
          id: auction.id,
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
    },
  });
  const realtime = await mockRealtime(page);
  await gotoHydrated(page, pathOf(auction));
  await realtime.subscribed(auction.id);

  await page.getByLabel('Twoje maksimum').fill('500');
  await expect(
    page.getByText(/Licytujesz do 500\s+zł · zapłacisz najwyżej 537,99\s+zł/u).first(),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole('button', { name: 'Licytuj' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Potwierdź ofertę' });
  await expect(dialog).toContainText(/zapłacisz najwyżej 537,99\s+zł/u);
  await dialog.getByRole('button', { name: 'Potwierdź ofertę' }).click();
  await expect(page.getByRole('status')).toHaveText(/Prowadzisz\. Twoje maksimum: 500\s+zł/u);
  const [bid] = api.requests(`POST /v1/auctions/${auction.id}/bids`);
  expect(bid?.postDataJSON()).toEqual({ maxAmount: 50_000 });
  expect(bid?.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/u);

  realtime.send('auction.updated', {
    auctionId: auction.id,
    version: 9,
    status: 'ACTIVE',
    currency: 'PLN',
    currentPrice: 60_000,
    bidCount: 4,
    leader: { publicName: 'b***k' },
    endsAt: auction.endsAt,
    reserveStatus: 'NONE',
    minimumNextBid: 61_000,
    buyNowAvailable: false,
    serverTime: new Date().toISOString(),
  });
  await expect(page.getByTestId('auction-price')).toHaveText(/^600\s+zł$/u);
  await expect(page.getByText('Prowadzi: b***k')).toBeVisible();
});

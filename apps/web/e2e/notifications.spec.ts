// Obserwowane i powiadomienia (F-20) na `next start`: dzwonek z licznikiem i aktualizacją na żywo,
// centrum powiadomień, ustawienia e-maili, wypisanie z e-maila (strona i POST One-Click z klienta
// poczty) oraz obserwowanie sprzedawcy.
import AxeBuilder from '@axe-core/playwright';

import { type Page, expect, test } from '@playwright/test';

import { MEMBER, MOCK_API_PORT, SESSIONS, UNSUBSCRIBE_TOKEN } from './mock-api';
import { gotoHydrated, mockBrowserApi, mockRealtime, ok, settle, signInAs } from './support';

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

const NOTIFICATIONS = {
  items: [
    {
      id: '01960000-0000-7000-8000-00000000f101',
      type: 'OUTBID',
      title: 'Przebito Twoją ofertę',
      body: '„Wazon ceramiczny”: aktualna cena 31 zł.',
      url: '/a/wazon-ceramiczny-k3x9qa7m',
      read: false,
      createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    },
    {
      id: '01960000-0000-7000-8000-00000000f102',
      type: 'ENDING_SOON',
      title: 'Aukcja kończy się za godzinę',
      body: '„Aparat Zenit”: aktualna cena 120 zł.',
      url: '/a/aparat-zenit-k3x9qa7n',
      read: true,
      createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    },
  ],
  unreadCount: 1,
  nextBefore: null,
};

test('centrum powiadomień: dzwonek na żywo, lista, oznaczanie wszystkich', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, SESSIONS.phoneVerified, baseURL);
  const api = await mockBrowserApi(page, {
    'GET /v1/session': ok({ user: USER }),
    'GET /v1/me/notifications/summary': ok({ unreadCount: 1 }),
    'GET /v1/me/notifications': ok(NOTIFICATIONS),
    'POST /v1/me/notifications/read': ok({ unreadCount: 0 }),
  });
  const realtime = await mockRealtime(page);
  await gotoHydrated(page, '/powiadomienia');
  await expect(page.getByRole('link', { name: 'Powiadomienia, 1 nieprzeczytane' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Nieprzeczytane: Przebito Twoją ofertę/u }),
  ).toHaveAttribute('href', '/a/wazon-ceramiczny-k3x9qa7m');
  await expectNoAxeViolations(page);

  // Nowe powiadomienie przez WebSocket podbija licznik w dzwonku.
  await expect
    .poll(() => api.requests('GET /v1/me/notifications/summary').length)
    .toBeGreaterThan(0);
  await page.waitForTimeout(300);
  realtime.send('notification.new', {
    id: '01960000-0000-7000-8000-00000000f103',
    type: 'OUTBID',
    title: 'Przebito Twoją ofertę',
    body: '',
    url: '/a/wazon-ceramiczny-k3x9qa7m',
    createdAt: new Date().toISOString(),
    unreadCount: 3,
  });
  await expect(page.getByRole('link', { name: 'Powiadomienia, 3 nieprzeczytane' })).toBeVisible();

  await page.getByRole('button', { name: 'Oznacz wszystkie jako przeczytane' }).click();
  await expect(page.getByRole('link', { name: 'Powiadomienia', exact: true })).toBeVisible();
  expect(api.requests('POST /v1/me/notifications/read')[0]?.postDataJSON()).toEqual({ all: true });
});

test('ustawienia powiadomień: przełączniki per typ, transakcyjne z kłódką', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, SESSIONS.phoneVerified, baseURL);
  const preferences = (outbid: boolean) => ({
    items: [
      { type: 'OUTBID', channel: 'EMAIL', enabled: outbid, configurable: true },
      { type: 'ENDING_SOON', channel: 'EMAIL', enabled: true, configurable: true },
      { type: 'WON', channel: 'EMAIL', enabled: true, configurable: false },
      { type: 'SOLD', channel: 'EMAIL', enabled: true, configurable: false },
      { type: 'UNSOLD', channel: 'EMAIL', enabled: true, configurable: true },
      { type: 'AUCTION_CANCELLED', channel: 'EMAIL', enabled: true, configurable: true },
      { type: 'FOLLOWED_SELLER_NEW_AUCTION', channel: 'EMAIL', enabled: false, configurable: true },
    ],
  });
  const api = await mockBrowserApi(page, {
    'GET /v1/session': ok({ user: USER }),
    'GET /v1/me/notifications/summary': ok({ unreadCount: 0 }),
    'GET /v1/me/notification-preferences': ok(preferences(true)),
    'PUT /v1/me/notification-preferences': ok(preferences(false)),
  });
  await mockRealtime(page);
  await gotoHydrated(page, '/konto/powiadomienia');
  const bidding = page.getByRole('region', { name: 'Licytacje' });
  const won = bidding.getByRole('listitem').filter({ hasText: 'Wygrana aukcja' });
  await expect(won.getByText('Zawsze wysyłamy')).toBeVisible();
  await expect(won.getByRole('switch')).toHaveCount(0);
  await expectNoAxeViolations(page);
  const outbid = page.getByRole('switch', { name: 'Ktoś przebił Twoją ofertę' });
  await expect(outbid).toHaveAttribute('aria-checked', 'true');
  await outbid.click();
  await expect(page.getByRole('status').getByText('Zapisano')).toBeVisible();
  await expect(outbid).toHaveAttribute('aria-checked', 'false');
  expect(api.requests('PUT /v1/me/notification-preferences')[0]?.postDataJSON()).toEqual({
    items: [{ type: 'OUTBID', channel: 'EMAIL', enabled: false }],
  });
});

test('wypisanie z e-maila: strona z jednym przyciskiem i POST One-Click z klienta poczty', async ({
  page,
  request,
}) => {
  const api = await mockBrowserApi(page, {
    'GET /v1/notifications/unsubscribe': ok({ scope: 'OUTBID', types: ['OUTBID'] }),
    'POST /v1/notifications/unsubscribe': ok({ scope: 'OUTBID', types: ['OUTBID'] }),
  });
  await mockRealtime(page);
  await gotoHydrated(page, `/wypisz?token=${UNSUBSCRIBE_TOKEN}`);
  await expect(
    page.getByText(/Nie będziemy wysyłać e-maili tego typu: Ktoś przebił/u),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole('button', { name: 'Wypisz mnie' }).click();
  await expect(page.getByText('Gotowe: wypisaliśmy Cię z tych e-maili.')).toBeVisible();
  expect(api.requests('POST /v1/notifications/unsubscribe')[0]?.postDataJSON()).toEqual({
    token: UNSUBSCRIBE_TOKEN,
  });

  // RFC 8058: klient poczty wysyła formularz bez ciasteczek na adres z List-Unsubscribe.
  const oneClick = await request.post(`/api/wypisz?token=${UNSUBSCRIBE_TOKEN}`, {
    form: { 'List-Unsubscribe': 'One-Click' },
  });
  expect(oneClick.status()).toBe(200);
  const unsubscribed = (await (
    await fetch(`http://127.0.0.1:${String(MOCK_API_PORT)}/__e2e/unsubscribed`)
  ).json()) as string[];
  expect(unsubscribed).toContain(UNSUBSCRIBE_TOKEN);
  const invalid = await request.post('/api/wypisz?token=zly', {
    form: { 'List-Unsubscribe': 'One-Click' },
  });
  expect(invalid.status()).toBe(400);
});

test('obserwowanie sprzedawcy z profilu publicznego', async ({ page }) => {
  const viewer = { ...USER, id: '01960000-0000-7000-8000-0000000000e9', name: 'Ola' };
  const api = await mockBrowserApi(page, {
    'GET /v1/session': ok({ user: viewer }),
    'GET /v1/me/notifications/summary': ok({ unreadCount: 0 }),
    [`GET /v1/me/followed-sellers/${MEMBER.id}`]: ok({ following: false }),
    [`PUT /v1/me/followed-sellers/${MEMBER.id}`]: { status: 204 },
    'GET /v1/auctions': ok({
      items: [],
      total: 0,
      totalPages: 0,
      page: 1,
      pageSize: 12,
      sort: 'ending',
      facets: { categories: [], conditions: [], price: null, attributes: [] },
    }),
  });
  await mockRealtime(page);
  await gotoHydrated(page, `/u/${MEMBER.id}`);
  await page.getByRole('button', { name: 'Obserwuj sprzedawcę' }).click();
  await expect(
    page.getByRole('button', { name: `Przestań obserwować sprzedawcę ${MEMBER.name}` }),
  ).toBeVisible();
  expect(api.requests(`PUT /v1/me/followed-sellers/${MEMBER.id}`)).toHaveLength(1);
  await expectNoAxeViolations(page);
});

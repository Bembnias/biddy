import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

import { MEMBER, SESSIONS } from './mock-api';
import { gotoHydrated, mockBrowserApi, ok, settle, signInAs } from './support';

// Oceny (F-30) na `next start`: kupujący ocenia sprzedającego ze strony zakończonego zamówienia
// (gwiazdki z klawiatury, komentarz, ocena ukryta do ujawnienia), a profil publiczny pokazuje
// średnią, oceny według ról, listę i informację o weryfikacji ocen. Zamówienie i oceny zamówienia
// pobiera przeglądarka; profil renderuje serwer z atrapy API (stałe oceny konta MEMBER).

type Json = Record<string, unknown>;

const PUBLIC_ID = 'r5v8k2qa';
const ORDER = `/v1/orders/${PUBLIC_ID}`;
const SELLER_ID = '01960000-0000-7000-8000-0000000000e2';

const COMPLETED_ORDER: Json = {
  id: '01960000-0000-7000-8000-000000000201',
  publicId: PUBLIC_ID,
  status: 'COMPLETED',
  role: 'BUYER',
  title: 'Wazon ceramiczny, lata 70.',
  photoUrl: null,
  auction: {
    id: '01960000-0000-7000-8000-0000000000a1',
    publicId: 'k3x9qa7p',
    slug: 'wazon-ceramiczny-lata-70',
  },
  counterpart: { name: 'Anna' },
  currency: 'PLN',
  itemsTotal: 10_000,
  pokFee: 999,
  shippingFee: 1_399,
  total: 12_398,
  paymentDueAt: '2026-10-28T18:00:00.000Z',
  paidAt: '2026-10-28T10:00:00.000Z',
  shipBy: '2026-11-04T22:59:59.999Z',
  shippedAt: '2026-10-29T09:00:00.000Z',
  deliveredAt: '2026-10-30T12:00:00.000Z',
  inspectionEndsAt: '2026-11-01T00:00:00.000Z',
  buyerConfirmedAt: '2026-10-31T10:00:00.000Z',
  completedAt: '2026-10-31T10:00:00.000Z',
  cancelledAt: null,
  notPickedUpAt: null,
  lostAt: null,
  refundedAt: null,
  compensation: null,
  onHold: false,
  fromSecondChance: false,
  shipment: null,
  refund: null,
  actions: { confirmReceipt: false, reportNotReceived: null },
  secondChance: null,
};

function reviews(overrides: Json = {}): Json {
  return {
    orderPublicId: PUBLIC_ID,
    role: 'BUYER',
    counterpart: { id: SELLER_ID, name: 'Anna' },
    blocker: null,
    rateUntil: new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString(),
    mine: null,
    theirs: null,
    counterpartReviewed: false,
    ...overrides,
  };
}

async function expectNoAxeViolations(page: Page) {
  await settle(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
}

test('kupujący ocenia sprzedającego ze strony zamówienia; axe i 390 px', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, SESSIONS.phoneVerified, baseURL);
  let state = reviews();
  const api = await mockBrowserApi(page, {
    [`GET ${ORDER}`]: ok(COMPLETED_ORDER),
    [`GET ${ORDER}/reviews`]: () => ok(state),
    [`POST ${ORDER}/review`]: (request) => {
      const body = request.postDataJSON() as { rating: number; comment: string };
      state = reviews({
        blocker: 'ALREADY_REVIEWED',
        mine: {
          id: '01960000-0000-7000-8000-0000000002b1',
          rating: body.rating,
          comment: body.comment,
          authorRole: 'BUYER',
          createdAt: new Date().toISOString(),
          visibleAt: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
          visible: false,
        },
      });
      return { status: 201, json: state };
    },
  });
  await gotoHydrated(page, `/zamowienia/${PUBLIC_ID}`);
  const card = page.getByRole('region', { name: 'Ocena transakcji' });

  await expect(card.getByText('Jak oceniasz Anna?')).toBeVisible();
  await expectNoAxeViolations(page);

  const group = card.getByRole('group', { name: 'Ocena' });
  // Klik w gwiazdkę (etykietę pola radio), potem strzałka w prawo z klawiatury.
  await group.locator('label').nth(3).click();
  await expect(group.getByRole('radio', { name: '4 z 5: Dobrze' })).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: '5 z 5: Świetnie' })).toBeChecked();
  await card
    .getByRole('textbox', { name: 'Komentarz (opcjonalnie)' })
    .fill('Wazon dokładnie jak na zdjęciach.');
  await card.getByRole('button', { name: 'Wystaw ocenę' }).click();

  await expect(card.getByText('Dziękujemy za ocenę.')).toBeVisible();
  await expect(card.getByText('Twoja ocena')).toBeVisible();
  await expect(card.getByRole('img', { name: '5 z 5' })).toBeVisible();
  await expect(card.getByText(/^Widoczna od /u)).toBeVisible();
  expect(api.requests(`POST ${ORDER}/review`)[0]?.postDataJSON()).toEqual({
    rating: 5,
    comment: 'Wazon dokładnie jak na zdjęciach.',
  });
  await expectNoAxeViolations(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('profil publiczny: średnia, oceny według ról, lista i weryfikacja ocen; axe', async ({
  page,
}) => {
  await mockBrowserApi(page);
  await gotoHydrated(page, `/u/${MEMBER.id}`);
  const main = page.getByRole('main');

  const stats = main.getByRole('definition').filter({ hasText: '3 oceny' });
  await expect(stats.getByText('4,7')).toBeVisible();
  const section = main.getByRole('region', { name: 'Oceny' });
  await expect(section.getByRole('img', { name: 'Średnia ocen: 4,7 z 5' })).toBeVisible();
  await expect(section.getByText('5,0 · 2 oceny')).toBeVisible();
  await expect(section.getByText('4,0 · 1 ocena')).toBeVisible();

  const list = section.getByRole('list', { name: 'Lista ocen' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await expect(
    list.getByText('Wazon dokładnie jak na zdjęciach, świetnie zapakowany.'),
  ).toBeVisible();
  await expect(list.getByText(/Od sprzedającego · e\*\*\*a/u)).toBeVisible();

  await section.getByText('Jak weryfikujemy oceny').click();
  await expect(section.getByText(/Ocenę wystawia tylko strona zamówienia/u)).toBeVisible();
  await expectNoAxeViolations(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

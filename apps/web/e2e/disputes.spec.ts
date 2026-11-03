import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

import { SESSIONS } from './mock-api';
import {
  BROWSER_API_URL,
  gotoHydrated,
  mockBrowserApi,
  ok,
  problem,
  settle,
  signInAs,
} from './support';

// Spory (F-28) na `next start`: kupujący zgłasza problem ze zdjęciem (presigned PUT do atrapy
// magazynu), sprzedający proponuje zwrot części ceny, a kupujący ją przyjmuje i widzi
// rozstrzygnięcie z uzasadnieniem. Spór pobiera przeglądarka, więc wystarcza atrapa API ze stanem.

type Json = Record<string, unknown>;

const PUBLIC_ID = 'p7q2m4nx';
const ORDER = `/v1/orders/${PUBLIC_ID}`;
const DISPUTE_ID = '01960000-0000-7000-8000-0000000000d1';
const MEDIA_ID = '01960000-0000-7000-8000-0000000000c1';
const UPLOAD_URL = `https://s3.biddy.test/biddy-uploads/incoming/user/${MEDIA_ID}`;

/** Najmniejszy poprawny PNG 1×1 (przezroczysty). */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

async function expectNoAxeViolations(page: Page) {
  await settle(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
}

function order(overrides: Json = {}): Json {
  return {
    id: '01960000-0000-7000-8000-000000000101',
    publicId: PUBLIC_ID,
    status: 'DELIVERED',
    role: 'BUYER',
    title: 'Lampa biurkowa, lata 60.',
    photoUrl: null,
    auction: {
      id: '01960000-0000-7000-8000-0000000000a1',
      publicId: 'k3x9qa7p',
      slug: 'lampa-biurkowa-lata-60',
    },
    counterpart: { name: 'Anna' },
    currency: 'PLN',
    itemsTotal: 12_000,
    pokFee: 999,
    shippingFee: 1_399,
    total: 14_398,
    paymentDueAt: '2026-10-28T18:00:00.000Z',
    paidAt: '2026-10-28T10:00:00.000Z',
    shipBy: '2026-11-04T23:00:00.000Z',
    shippedAt: '2026-10-29T09:00:00.000Z',
    deliveredAt: '2026-10-30T12:00:00.000Z',
    inspectionEndsAt: new Date(Date.now() + 30 * 60 * 60_000).toISOString(),
    buyerConfirmedAt: null,
    completedAt: null,
    cancelledAt: null,
    notPickedUpAt: null,
    lostAt: null,
    disputedAt: null,
    refundedAt: null,
    compensation: null,
    onHold: false,
    fromSecondChance: false,
    shipment: null,
    refund: null,
    actions: {
      confirmReceipt: true,
      reportNotReceived: null,
      openDispute: {
        until: new Date(Date.now() + 30 * 60 * 60_000).toISOString(),
        allowed: true,
      },
    },
    secondChance: null,
    ...overrides,
  };
}

const NO_ACTIONS = {
  respond: false,
  answerOffer: false,
  shipReturn: false,
  reviewReturn: false,
  comment: true,
};

function dispute(overrides: Json = {}): Json {
  return {
    id: DISPUTE_ID,
    orderId: '01960000-0000-7000-8000-000000000101',
    orderPublicId: PUBLIC_ID,
    title: 'Lampa biurkowa, lata 60.',
    status: 'AWAITING_SELLER',
    role: 'BUYER',
    reason: 'DAMAGED',
    description: 'Klosz jest pęknięty w dwóch miejscach.',
    currency: 'PLN',
    itemsTotal: 12_000,
    shippingFee: 1_399,
    orderTotal: 14_398,
    createdAt: new Date().toISOString(),
    responseDueAt: new Date(Date.now() + 48 * 60 * 60_000).toISOString(),
    escalatedAt: null,
    decisionDueAt: null,
    partialOffer: null,
    resolution: null,
    return: null,
    returnQuote: null,
    events: [
      {
        id: '01960000-0000-7000-8000-0000000000e1',
        type: 'OPENED',
        actor: 'BUYER',
        note: 'Klosz jest pęknięty w dwóch miejscach.',
        amount: null,
        photos: [
          {
            id: MEDIA_ID,
            thumbUrl: `${BROWSER_API_URL}/v1/disputes/${DISPUTE_ID}/photos/${MEDIA_ID}/thumb`,
            largeUrl: `${BROWSER_API_URL}/v1/disputes/${DISPUTE_ID}/photos/${MEDIA_ID}/large`,
          },
        ],
        createdAt: new Date().toISOString(),
      },
    ],
    actions: NO_ACTIONS,
    ...overrides,
  };
}

function media(status: string): Json {
  return {
    id: MEDIA_ID,
    purpose: 'DISPUTE_EVIDENCE',
    status,
    width: status === 'READY' ? 1600 : null,
    height: status === 'READY' ? 1200 : null,
    urls: null,
    rejectionReason: null,
    createdAt: new Date().toISOString(),
  };
}

/** Magazyn (presigned PUT) i zdjęcia ze sporu z API (po atrapie API, więc mają pierwszeństwo). */
async function mockFiles(page: Page) {
  await page.route('https://s3.biddy.test/**', async (route, request) => {
    await route.fulfill({
      status: 200,
      headers: {
        'access-control-allow-origin': request.headers()['origin'] ?? '*',
        'access-control-allow-methods': 'PUT',
        'access-control-allow-headers': 'content-type',
      },
    });
  });
  await page.route(`${BROWSER_API_URL}/v1/disputes/*/photos/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }),
  );
}

test('kupujący zgłasza problem ze zdjęciem i przyjmuje propozycję zwrotu; axe i 390 px', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, SESSIONS.phoneVerified, baseURL);
  let current: Json | undefined;
  let orderState = order();
  const api = await mockBrowserApi(page, {
    [`GET ${ORDER}`]: () => ok(orderState),
    [`GET ${ORDER}/dispute`]: () =>
      current === undefined ? problem(404, 'NOT_FOUND', 'Nie znaleziono sporu.') : ok(current),
    [`POST ${ORDER}/dispute`]: () => {
      current = dispute();
      orderState = order({
        status: 'DISPUTED',
        disputedAt: new Date().toISOString(),
        actions: { confirmReceipt: false, reportNotReceived: null, openDispute: null },
      });
      return { status: 201, json: current };
    },
    'POST /v1/media/uploads': ok({
      media: media('PENDING_UPLOAD'),
      upload: {
        url: UPLOAD_URL,
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg' },
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      },
    }),
    [`POST /v1/media/${MEDIA_ID}/complete`]: { status: 202, json: media('PROCESSING') },
    [`GET /v1/media/${MEDIA_ID}`]: () => ok(media('READY')),
    [`POST /v1/disputes/${DISPUTE_ID}/offer-response`]: () => {
      current = dispute({
        status: 'RESOLVED',
        partialOffer: 3_000,
        actions: { ...NO_ACTIONS, comment: false },
        resolution: {
          outcome: 'PARTIAL_REFUND',
          fault: null,
          refundAmount: 3_000,
          decidedBy: 'PARTIES',
          statement:
            'Kupujący przyjął propozycję sprzedającego: zwrot 30 zł, przedmiot zostaje u kupującego.',
          decidedAt: new Date().toISOString(),
          resolvedAt: new Date().toISOString(),
          sellerCosts: null,
          refund: { status: 'PENDING', succeededAt: null },
        },
      });
      return ok(current);
    },
  });
  await mockFiles(page);

  await gotoHydrated(page, `/zamowienia/${PUBLIC_ID}`);
  const main = page.getByRole('main');
  await main.getByRole('link', { name: 'Zgłoś problem' }).click();
  await expect(page).toHaveURL(new RegExp(`/zamowienia/${PUBLIC_ID}/spor$`, 'u'));
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Problem z zamówieniem');
  await expectNoAxeViolations(page);

  await main.getByRole('radio', { name: 'Przedmiot jest uszkodzony' }).check();
  await main.getByLabel('Opisz problem').fill('Klosz jest pęknięty w dwóch miejscach.');
  await main.getByRole('button', { name: 'Zgłoś problem' }).click();
  await expect(main.getByText('Dodaj co najmniej jedno zdjęcie problemu.').last()).toBeVisible();
  await main.getByLabel('Dodaj zdjęcia').setInputFiles({
    name: 'klosz.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.alloc(4096, 1),
  });
  await expect(main.getByRole('img', { name: 'Zdjęcie 1' })).toBeVisible({ timeout: 10_000 });
  await main.getByRole('button', { name: 'Zgłoś problem' }).click();

  await expect(main.getByText('Czeka na sprzedającego')).toBeVisible();
  expect(api.requests(`POST ${ORDER}/dispute`)[0]?.postDataJSON()).toEqual({
    reason: 'DAMAGED',
    description: 'Klosz jest pęknięty w dwóch miejscach.',
    mediaIds: [MEDIA_ID],
  });
  expect(api.requests('POST /v1/media/uploads')[0]?.postDataJSON()).toMatchObject({
    purpose: 'DISPUTE_EVIDENCE',
  });
  await expectNoAxeViolations(page);

  // Sprzedający proponuje zwrot części ceny (stan atrapy), kupujący odświeża stronę.
  current = dispute({
    status: 'PARTIAL_OFFERED',
    partialOffer: 3_000,
    actions: { ...NO_ACTIONS, answerOffer: true },
  });
  await gotoHydrated(page, `/zamowienia/${PUBLIC_ID}/spor`);
  await expect(main.getByText(/Sprzedający proponuje zwrot 30\s+zł/u)).toBeVisible();
  await main.getByRole('button', { name: /^Przyjmij 30\s+zł$/u }).click();
  await expect(main.getByText('Rozstrzygnięty', { exact: true })).toBeVisible();
  await expect(main.getByText(/Zwracamy Ci 30\s+zł\. Przedmiot zostaje u Ciebie\./u)).toBeVisible();
  await expect(main.getByText(/Kupujący przyjął propozycję sprzedającego/u)).toBeVisible();
  expect(api.requests(`POST /v1/disputes/${DISPUTE_ID}/offer-response`)[0]?.postDataJSON()).toEqual(
    { accept: true },
  );
  await expectNoAxeViolations(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('sprzedający proponuje zwrot części ceny; axe', async ({ page, context, baseURL }) => {
  await signInAs(context, SESSIONS.phoneVerified, baseURL);
  let current = dispute({
    role: 'SELLER',
    actions: { ...NO_ACTIONS, respond: true },
    returnQuote: {
      carrierId: 'inpost-kurier',
      name: 'InPost Kurier',
      kind: 'COURIER',
      price: 1_699,
      currency: 'PLN',
      requiresPickupPoint: false,
    },
  });
  const api = await mockBrowserApi(page, {
    [`GET ${ORDER}`]: () =>
      ok(
        order({
          status: 'DISPUTED',
          role: 'SELLER',
          disputedAt: new Date().toISOString(),
          actions: { confirmReceipt: false, reportNotReceived: null, openDispute: null },
        }),
      ),
    [`GET ${ORDER}/dispute`]: () => ok(current),
    [`POST /v1/disputes/${DISPUTE_ID}/seller-response`]: () => {
      current = dispute({
        role: 'SELLER',
        status: 'PARTIAL_OFFERED',
        partialOffer: 3_000,
        actions: NO_ACTIONS,
      });
      return ok(current);
    },
  });
  await mockFiles(page);

  await gotoHydrated(page, `/zamowienia/${PUBLIC_ID}/spor`);
  const main = page.getByRole('main');
  await expect(main.getByText(/Kupujący zgłosił problem\. Odpowiedz do/u)).toBeVisible();
  await expectNoAxeViolations(page);
  await main.getByRole('radio', { name: /Zaproponuj zwrot części ceny/u }).check();
  await main.getByLabel('Kwota zwrotu w zł').fill('30');
  await main.getByRole('button', { name: 'Wyślij propozycję' }).click();
  await expect(main.getByText(/Czekamy na odpowiedź kupującego/u)).toBeVisible();
  expect(
    api.requests(`POST /v1/disputes/${DISPUTE_ID}/seller-response`)[0]?.postDataJSON(),
  ).toEqual({ action: 'OFFER_PARTIAL', amount: 3_000 });
  await expectNoAxeViolations(page);
});

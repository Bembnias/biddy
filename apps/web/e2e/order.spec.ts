import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

import { SESSIONS } from './mock-api';
import { gotoHydrated, mockBrowserApi, ok, settle, signInAs } from './support';

// Zamówienie (F-26) na `next start`: kupujący potwierdza odbiór („Wszystko OK”), sprzedający po
// braku płatności wysyła ofertę drugiej szansy, a licytujący ją przyjmuje i trafia do checkoutu.
// Zamówienie i oferty pobiera przeglądarka, więc wystarcza atrapa API ze stanem jak w API.

const PUBLIC_ID = 'p7q2m4nx';
const ORDER = `/v1/orders/${PUBLIC_ID}`;
const OFFER_ID = '01960000-0000-7000-8000-0000000000c1';
const OFFER = `/v1/second-chance-offers/${OFFER_ID}`;

type Json = Record<string, unknown>;

function baseOrder(overrides: Json = {}): Json {
  return {
    id: '01960000-0000-7000-8000-000000000101',
    publicId: PUBLIC_ID,
    status: 'DELIVERED',
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
    inspectionEndsAt: new Date(Date.now() + 30 * 60 * 60_000).toISOString(),
    buyerConfirmedAt: null,
    completedAt: null,
    cancelledAt: null,
    notPickedUpAt: null,
    lostAt: null,
    refundedAt: null,
    compensation: null,
    onHold: false,
    fromSecondChance: false,
    shipment: {
      id: '01960000-0000-7000-8000-0000000000d1',
      direction: 'OUTBOUND',
      status: 'DELIVERED',
      carrier: { id: 'inpost-paczkomat', name: 'InPost Paczkomat 24/7', kind: 'LOCKER' },
      provider: 'fake',
      price: 1_399,
      currency: 'PLN',
      pickupPoint: null,
      recipient: { name: 'Jan Kupujący', phone: '600700800', address: null },
      sender: null,
      dispatchMethod: 'DROP_OFF',
      trackingNumber: 'FAKE000123',
      dropoffCode: null,
      labelAvailable: false,
      createdAt: '2026-10-29T08:00:00.000Z',
      deliveredAt: '2026-10-30T12:00:00.000Z',
      events: [
        {
          status: 'DROPPED_OFF',
          description: 'Przesyłka nadana',
          occurredAt: '2026-10-29T09:00:00.000Z',
        },
        {
          status: 'DELIVERED',
          description: 'Przesyłka odebrana',
          occurredAt: '2026-10-30T12:00:00.000Z',
        },
      ],
    },
    refund: null,
    actions: { confirmReceipt: true, reportNotReceived: null },
    secondChance: null,
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

test('kupujący: odbiór, „Wszystko OK” z potwierdzeniem, zamówienie zakończone; axe i 390 px', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, SESSIONS.phoneVerified, baseURL);
  let order = baseOrder();
  const api = await mockBrowserApi(page, {
    [`GET ${ORDER}`]: () => ok(order),
    [`POST ${ORDER}/confirm-receipt`]: () => {
      order = baseOrder({
        status: 'COMPLETED',
        completedAt: new Date().toISOString(),
        buyerConfirmedAt: new Date().toISOString(),
        actions: { confirmReceipt: false, reportNotReceived: null },
      });
      return ok(order);
    },
  });
  await gotoHydrated(page, `/zamowienia/${PUBLIC_ID}`);
  const main = page.getByRole('main');

  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Wazon ceramiczny, lata 70.');
  await expect(main.getByText(/^Masz czas na sprawdzenie przedmiotu do /u)).toBeVisible();
  await expect(main.getByText('FAKE000123')).toBeVisible();
  await expectNoAxeViolations(page);

  await main.getByRole('button', { name: 'Wszystko OK' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Potwierdzić odbiór?' });
  await expectNoAxeViolations(page);
  await dialog.getByRole('button', { name: 'Wszystko OK' }).click();
  await expect(main.getByText('Zamówienie zakończone. Dziękujemy!')).toBeVisible();
  expect(api.requests(`POST ${ORDER}/confirm-receipt`)).toHaveLength(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('druga szansa: sprzedający wysyła ofertę, licytujący ją przyjmuje i trafia do płatności', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, SESSIONS.phoneVerified, baseURL);
  const cancelled = baseOrder({
    status: 'CANCELLED_UNPAID',
    role: 'SELLER',
    counterpart: { name: 'Jan' },
    shippingFee: null,
    total: 10_999,
    paidAt: null,
    shipBy: null,
    shippedAt: null,
    deliveredAt: null,
    inspectionEndsAt: null,
    cancelledAt: '2026-10-29T18:00:00.000Z',
    shipment: null,
    actions: { confirmReceipt: false, reportNotReceived: null },
    secondChance: {
      next: { bidder: 'k***a', amount: 4_500 },
      offers: [],
      unavailableReason: null,
      sendBy: new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString(),
    },
  });
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  let order = cancelled;
  let offer: Json = {
    id: OFFER_ID,
    status: 'PENDING',
    title: 'Wazon ceramiczny, lata 70.',
    photoUrl: null,
    auction: { publicId: 'k3x9qa7p', slug: 'wazon-ceramiczny-lata-70' },
    currency: 'PLN',
    amount: 4_500,
    pokFee: 599,
    total: 5_099,
    expiresAt,
    respondedAt: null,
    orderPublicId: null,
  };
  const api = await mockBrowserApi(page, {
    [`GET ${ORDER}`]: () => ok(order),
    [`POST ${ORDER}/second-chance-offers`]: () => {
      order = {
        ...cancelled,
        secondChance: {
          next: { bidder: 't***i', amount: 3_000 },
          offers: [
            {
              id: OFFER_ID,
              bidder: 'k***a',
              amount: 4_500,
              status: 'PENDING',
              expiresAt,
              respondedAt: null,
              orderPublicId: null,
            },
          ],
          unavailableReason: 'OFFER_PENDING',
          sendBy: (cancelled['secondChance'] as Json)['sendBy'],
        },
      };
      return ok(order);
    },
    [`GET ${OFFER}`]: () => ok(offer),
    [`POST ${OFFER}/accept`]: () => {
      offer = { ...offer, status: 'ACCEPTED', orderPublicId: 'q8r3n5py' };
      return ok(offer);
    },
  });
  await gotoHydrated(page, `/zamowienia/${PUBLIC_ID}`);
  const main = page.getByRole('main');

  const card = main.getByRole('region', { name: 'Druga szansa' });
  await expect(
    card.getByText(/Następna osoba: k\*\*\*a, najwyższa oferta 45,00\s+zł/u),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  await card.getByRole('button', { name: 'Wyślij ofertę' }).click();
  await expect(card.getByText(/czeka na odpowiedź do /u)).toBeVisible();
  expect(api.requests(`POST ${ORDER}/second-chance-offers`)).toHaveLength(1);

  await gotoHydrated(page, `/druga-szansa/${OFFER_ID}`);
  await expect(main.getByRole('heading', { name: 'Druga szansa' })).toBeVisible();
  await expectNoAxeViolations(page);
  await main.getByRole('button', { name: /^Kup za 45,00\s+zł$/u }).click();
  await expect(page).toHaveURL(/\/zamowienia\/q8r3n5py\/zaplac$/u);
  expect(api.requests(`POST ${OFFER}/accept`)).toHaveLength(1);
});

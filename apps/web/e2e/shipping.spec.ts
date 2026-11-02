import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

import { SESSIONS } from './mock-api';
import { gotoHydrated, mockBrowserApi, ok, settle, signInAs } from './support';

// Nadanie paczki (F-24, układ F-63): formularz obok karty zamówienia, po „Nadaj” ciemna karta
// z kodem nadania. Zamówienie i adresy pobiera przeglądarka, więc wystarcza atrapa API.

const PUBLIC_ID = 'k3x9qa7m';
const SHIPMENT = `/v1/orders/${PUBLIC_ID}/shipment`;

const PENDING = {
  id: '01960000-0000-7000-8000-0000000000a1',
  direction: 'OUTBOUND',
  status: 'PENDING',
  carrier: { id: 'inpost-paczkomat', name: 'InPost Paczkomat 24/7', kind: 'LOCKER' },
  packageSize: 'M',
  pickupPoint: {
    id: 'WAW01M',
    name: 'Paczkomat WAW01M',
    address: 'ul. Prosta 1, 00-001 Warszawa',
  },
  recipient: { name: 'Jan K.', city: null },
  sender: null,
  dispatchMethod: null,
  dispatchMethods: ['DROP_OFF', 'COURIER_PICKUP'],
  currency: 'PLN',
  price: 1_399,
  trackingNumber: null,
  dropoffCode: null,
  labelAvailable: false,
  lastError: null,
  events: [],
  requestedAt: null,
  deliveredAt: null,
  createdAt: '2026-10-22T10:00:00.000Z',
};

const CREATED = {
  ...PENDING,
  status: 'CREATED',
  dispatchMethod: 'DROP_OFF',
  trackingNumber: 'FS123456789012',
  dropoffCode: '482913',
  labelAvailable: true,
  events: [
    {
      status: 'CREATED',
      description: 'Przesyłka przygotowana przez nadawcę',
      occurredAt: '2026-10-22T10:05:00.000Z',
    },
  ],
};

const SENDER = {
  id: '01960000-0000-7000-8000-0000000000c1',
  recipientName: 'Anna Sprzedająca',
  street: 'ul. Długa 5',
  postalCode: '30-001',
  city: 'Kraków',
  country: 'PL',
  phone: '+48500600700',
  isDefault: false,
  isSenderDefault: true,
};

function view(shipment: Record<string, unknown>) {
  return {
    order: {
      id: '01960000-0000-7000-8000-0000000000b1',
      publicId: PUBLIC_ID,
      status: 'PAID',
      role: 'SELLER',
      title: 'Wazon ceramiczny, lata 70.',
    },
    shipment,
  };
}

async function expectNoAxeViolations(page: Page) {
  await settle(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
}

async function mockOrder(page: Page) {
  let created = false;
  return mockBrowserApi(page, {
    [`GET ${SHIPMENT}`]: () => ok(view(created ? CREATED : PENDING)),
    [`POST ${SHIPMENT}`]: () => {
      created = true;
      return ok(view(CREATED));
    },
    'GET /v1/me/addresses': ok([SENDER]),
  });
}

test('nadanie paczki: dane nadawcy obok zamówienia, „Nadaj” i kod nadania, axe-core', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, SESSIONS.member, baseURL);
  const api = await mockOrder(page);
  await gotoHydrated(page, `/zamowienia/${PUBLIC_ID}/nadaj`);
  const main = page.getByRole('main');

  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Nadaj paczkę');
  await expect(main.getByText(`Zamówienie nr ${PUBLIC_ID}`)).toBeVisible();
  await expect(main.getByText('Paczkomat WAW01M')).toBeVisible();
  await expect(main.getByLabel('Imię i nazwisko')).toHaveValue('Anna Sprzedająca');
  await expect(main.getByRole('radio', { name: /^Nadam w paczkomacie/u })).toBeChecked();
  await expectNoAxeViolations(page);

  await main.getByRole('button', { name: 'Nadaj', exact: true }).click();
  await expect(main.getByTestId('dropoff-code')).toHaveText('482913');
  await expect(main.getByRole('button', { name: 'Kopiuj kod' })).toBeVisible();
  await expect(main.getByText('FS123456789012')).toBeVisible();
  await expectNoAxeViolations(page);
  expect(api.requests(`POST ${SHIPMENT}`)[0]?.postDataJSON()).toMatchObject({
    dispatchMethod: 'DROP_OFF',
    sender: { name: 'Anna Sprzedająca' },
  });
});

test('nadanie paczki na telefonie (390 px): bez przewijania w poziomie, axe-core', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, SESSIONS.member, baseURL);
  await mockOrder(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHydrated(page, `/zamowienia/${PUBLIC_ID}/nadaj`);
  await expect(page.getByRole('main').getByLabel('Imię i nazwisko')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);
});

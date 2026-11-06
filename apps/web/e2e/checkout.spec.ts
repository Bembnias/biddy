import AxeBuilder from '@axe-core/playwright';
import { type Page, type Request, expect, test } from '@playwright/test';

import { SESSIONS } from './mock-api';
import { type MockResponse, gotoHydrated, mockBrowserApi, ok, settle, signInAs } from './support';

// Checkout (F-25) na `next start`: wybór paczkomatu, BLIK odrzucony i ponowiony w tym samym
// zamówieniu, oczekiwanie i sukces; przekierowanie do operatora z powrotem na checkout; termin
// minął. Zamówienie, punkty i płatności pobiera przeglądarka, więc wystarcza atrapa API, która
// liczy stan jak API (kwoty, płatność w toku, opłacenie po webhooku).

const PUBLIC_ID = 'p7q2m4nx';
const CHECKOUT = `/v1/orders/${PUBLIC_ID}/checkout`;
const DELIVERY = `/v1/orders/${PUBLIC_ID}/delivery`;
const PAYMENTS = `/v1/orders/${PUBLIC_ID}/payments`;
const URL_PATH = `/zamowienia/${PUBLIC_ID}/zaplac`;

const LOCKER = {
  carrierId: 'inpost-paczkomat',
  name: 'InPost Paczkomat 24/7',
  kind: 'LOCKER',
  price: 1_399,
  currency: 'PLN',
  requiresPickupPoint: true,
  pointMap: null,
};
const COURIER = {
  carrierId: 'inpost-kurier',
  name: 'Kurier InPost',
  kind: 'COURIER',
  price: 1_799,
  currency: 'PLN',
  requiresPickupPoint: false,
  pointMap: null,
};
const POINT = {
  id: 'WAW01M',
  name: 'Paczkomat WAW01M',
  address: 'ul. Marszałkowska 10, 00-001 Warszawa',
  location: null,
  distanceMeters: null,
  openingHours: '24/7',
};
const ADDRESS = {
  id: '01960000-0000-7000-8000-0000000000c1',
  recipientName: 'Jan Kupujący',
  street: 'ul. Długa 5/12',
  postalCode: '00-238',
  city: 'Warszawa',
  country: 'PL',
  phone: '+48600700800',
  isDefault: true,
  isSenderDefault: false,
};

type Json = Record<string, unknown>;

/** Atrapa API checkoutu: stan zamówienia i płatności zmienia się jak w API. */
function checkoutApi(baseURL: string) {
  const dueAt = new Date(Date.now() + 20 * 60 * 60_000).toISOString();
  const order: Json = {
    id: '01960000-0000-7000-8000-000000000101',
    publicId: PUBLIC_ID,
    status: 'AWAITING_PAYMENT',
    title: 'Wazon ceramiczny, lata 70.',
    photoUrl: null,
    auction: { publicId: 'k3x9qa7p', slug: 'wazon-ceramiczny-lata-70' },
    currency: 'PLN',
    itemsTotal: 10_000,
    pokFee: 999,
    shippingFee: null,
    total: 10_999,
    paymentDueAt: dueAt,
    effectiveDueAt: dueAt,
    paidAt: null,
    shipBy: null,
  };
  let delivery: Json | null = null;
  let payment: Json | null = null;
  let blocker: string | null = null;
  // Wynik płatności po pierwszym odświeżeniu (jak webhook operatora).
  let settle: (() => void) | undefined;
  let gatewayAmount: number | undefined;

  const view = () => ({
    order,
    blocker,
    options: [LOCKER, COURIER],
    delivery,
    payment,
    paymentMethods: ['BLIK', 'CARD', 'PAY_BY_LINK'],
  });

  return {
    view,
    expire() {
      order['status'] = 'CANCELLED_UNPAID';
      blocker = 'ORDER_NOT_AWAITING_PAYMENT';
    },
    gatewayAmount: () => gatewayAmount,
    responders: {
      'GET /v1/me/addresses': ok([ADDRESS]),
      'GET /v1/shipping/points': ok([POINT]),
      [`GET ${CHECKOUT}`]: (): MockResponse => {
        const current = ok(view());
        settle?.();
        settle = undefined;
        return current;
      },
      [`PUT ${DELIVERY}`]: (request: Request): MockResponse => {
        const body = request.postDataJSON() as { carrierId: string; pickupPointId: string | null };
        const option = [LOCKER, COURIER].find((item) => item.carrierId === body.carrierId);
        delivery = {
          carrierId: option?.carrierId,
          name: option?.name,
          kind: option?.kind,
          price: option?.price,
          pickupPoint: body.pickupPointId === null ? null : POINT,
          recipient: { name: 'Jan Kupujący', phone: '+48600700800', address: null },
        };
        order['shippingFee'] = option?.price ?? 0;
        order['total'] = 10_000 + 999 + (option?.price ?? 0);
        return ok(view());
      },
      [`POST ${PAYMENTS}`]: (request: Request): MockResponse => {
        const body = request.postDataJSON() as {
          method: string;
          blikCode: string | null;
          expectedTotal: number;
        };
        if (body.expectedTotal !== order['total']) {
          return { status: 409, json: { code: 'CHECKOUT_TOTAL_CHANGED' } };
        }
        // Kwota w żądaniu do operatora to suma zamówienia (API: PaymentService.createPayment).
        gatewayAmount = order['total'];
        const redirect = body.method === 'BLIK' ? null : `${baseURL}${URL_PATH}`;
        payment = {
          id: `01960000-0000-7000-8000-00000000${String(Math.floor(Math.random() * 9_000) + 1_000)}`,
          status: 'PENDING',
          method: body.method,
          failureReason: null,
          redirectUrl: redirect,
          amount: order['total'],
          createdAt: new Date().toISOString(),
        };
        blocker = 'PAYMENT_IN_PROGRESS';
        if (body.blikCode === '111111') {
          settle = () => {
            payment = { ...payment, status: 'FAILED', failureReason: 'DECLINED' };
            blocker = null;
          };
        } else if (body.blikCode === '777123') {
          settle = () => {
            payment = { ...payment, status: 'SUCCEEDED' };
            order['status'] = 'PAID';
            order['paidAt'] = new Date().toISOString();
            order['shipBy'] = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
            blocker = 'ORDER_NOT_AWAITING_PAYMENT';
          };
        }
        return { status: 201, json: view() };
      },
    },
  };
}

async function expectNoAxeViolations(page: Page) {
  await settle(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
}

test('paczkomat i BLIK: odrzucony kod, ponowienie w tym samym zamówieniu, sukces; kwoty zgodne; axe-core', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, SESSIONS.phoneVerified, baseURL);
  const checkout = checkoutApi(baseURL ?? '');
  const api = await mockBrowserApi(page, checkout.responders);
  await gotoHydrated(page, URL_PATH);
  const main = page.getByRole('main');

  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Zapłać za zamówienie');
  await expect(main.getByText(`Zamówienie nr ${PUBLIC_ID}`)).toBeVisible();
  await expect(main.getByText(/^Zapłać do /u)).toBeVisible();
  await expect(main.getByLabel('Imię i nazwisko', { exact: true })).toHaveValue('Jan Kupujący');
  await expectNoAxeViolations(page);

  await main.getByLabel('Miasto, adres albo kod punktu').fill('Warszawa');
  await main.getByRole('button', { name: 'Szukaj' }).click();
  await main.getByRole('radio', { name: /Paczkomat WAW01M/u }).click();
  await expect(main.getByText('Wybrany punkt')).toBeVisible();

  const pay = main.getByRole('button', { name: /^Zapłać 123,98\s+zł$/u });
  await expect(main.getByTestId('checkout-total')).toHaveText(/^123,98\s+zł$/u);
  await main.getByLabel('Kod BLIK').fill('111111');
  await pay.click();
  await expect(main.getByText('Potwierdź płatność w aplikacji banku')).toBeVisible();
  await expect(main.getByText('Płatność nie przeszła')).toBeVisible({ timeout: 10_000 });
  await expect(main.getByText(/Bank odrzucił płatność/u)).toBeVisible();
  await expectNoAxeViolations(page);

  await main.getByLabel('Kod BLIK').fill('777123');
  await main.getByRole('button', { name: /^Zapłać ponownie 123,98\s+zł$/u }).click();
  await expect(main.getByRole('heading', { name: 'Zapłacone!' })).toBeVisible({ timeout: 10_000 });
  await expect(main.getByText(/Zapłacono 123,98\s+zł za zamówienie nr p7q2m4nx/u)).toBeVisible();
  await expectNoAxeViolations(page);

  // Kwota na ekranie = kwota w zamówieniu = kwota w żądaniu do operatora.
  const payments = api.requests(`POST ${PAYMENTS}`);
  expect(payments.map((request) => (request.postDataJSON() as Json)['expectedTotal'])).toEqual([
    12_398, 12_398,
  ]);
  expect(checkout.view().order['total']).toBe(12_398);
  expect(checkout.gatewayAmount()).toBe(12_398);
  const keys = payments.map((request) => request.headers()['idempotency-key']);
  expect(new Set(keys).size).toBe(2);
  expect(api.requests(`PUT ${DELIVERY}`)[0]?.postDataJSON()).toMatchObject({
    carrierId: 'inpost-paczkomat',
    pickupPointId: 'WAW01M',
  });
});

test('karta: przejście na stronę operatora i powrót na checkout, który czeka na wynik', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, SESSIONS.phoneVerified, baseURL);
  const checkout = checkoutApi(baseURL ?? '');
  await mockBrowserApi(page, checkout.responders);
  await gotoHydrated(page, URL_PATH);
  const main = page.getByRole('main');

  await main.getByRole('radio', { name: /Kurier InPost/u }).check();
  await expect(main.getByLabel('Ulica i numer')).toHaveValue('ul. Długa 5/12');
  await main.getByRole('radio', { name: /Karta płatnicza/u }).check();
  await expect(main.getByLabel('Kod BLIK')).toHaveCount(0);
  await main.getByRole('button', { name: /^Zapłać 127,98\s+zł$/u }).click();

  // Atrapa „operatora” odsyła od razu na adres powrotu: checkout czeka na webhook.
  await expect(main.getByText('Sprawdzamy płatność…')).toBeVisible();
  await expect(main.getByRole('link', { name: 'Wróć do strony płatności' })).toBeVisible();
  await expectNoAxeViolations(page);
});

test('termin minął i telefon (390 px): karta zamiast formularza, bez przewijania w poziomie', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, SESSIONS.phoneVerified, baseURL);
  await page.setViewportSize({ width: 390, height: 844 });
  const checkout = checkoutApi(baseURL ?? '');
  await mockBrowserApi(page, checkout.responders);
  await gotoHydrated(page, URL_PATH);
  const main = page.getByRole('main');
  await expect(main.getByRole('button', { name: /^Zapłać 123,98/u })).toBeVisible();
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  expect(await overflow()).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);

  checkout.expire();
  await page.reload();
  await expect(main.getByRole('heading', { name: 'Termin płatności minął' })).toBeVisible();
  await expect(main.getByRole('button', { name: /^Zapłać/u })).toHaveCount(0);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);
});

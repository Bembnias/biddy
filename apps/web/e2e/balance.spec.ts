import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

import { SESSIONS } from './mock-api';
import { gotoHydrated, mockBrowserApi, ok, settle, signInAs } from './support';

// Saldo i wypłaty (F-27) na `next start`: sprzedający uzupełnia dane do wypłat (dane osobowe
// i rachunek), wypłaca saldo i widzi historię. Dane pobiera przeglądarka, więc wystarcza atrapa
// API ze stanem jak w API.

type Json = Record<string, unknown>;

const PROFILE = '/v1/me/payout-profile';

async function expectNoAxeViolations(page: Page) {
  await settle(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
}

function profile(overrides: Json = {}): Json {
  return {
    personalData: null,
    bankAccount: null,
    weeklyPayouts: false,
    payoutsBlockedUntil: null,
    complete: false,
    ...overrides,
  };
}

const PERSONAL = {
  firstName: 'Anna',
  lastName: 'Kowalska',
  birthDate: '1944-05-14',
  street: 'ul. Długa 5/2',
  postalCode: '00-950',
  city: 'Warszawa',
  taxIdKind: 'PESEL',
  taxIdMasked: '•••••••1359',
};

function balance(complete: boolean, available: number): Json {
  return {
    currency: 'PLN',
    available,
    inProgress: 4_500,
    receivable: 0,
    payoutsInTransit: complete && available === 0 ? 5_000 : 0,
    minimumPayout: 2_000,
    payout: {
      blocker: complete
        ? available === 0
          ? { code: 'INSUFFICIENT_BALANCE', until: null, amount: 0 }
          : null
        : { code: 'PAYOUT_PROFILE_INCOMPLETE', until: null, amount: null },
      profileComplete: complete,
      bankAccountMasked: complete ? '•••• 2874' : null,
      weeklyPayouts: false,
    },
    inProgressOrders: [
      {
        publicId: 'p7q2m4nx',
        title: 'Wazon ceramiczny, lata 70.',
        photoUrl: null,
        status: 'SHIPPED',
        amount: 4_500,
      },
    ],
  };
}

const sale = {
  id: '01960000-0000-7000-8000-0000000000f1',
  type: 'ORDER_COMPLETED',
  occurredAt: '2026-11-01T10:00:00.000Z',
  available: 5_000,
  receivable: 0,
  order: { publicId: 'k3x9qa7p', title: 'Lampa biurkowa', photoUrl: null },
  payout: null,
};

const payout = {
  id: '01960000-0000-7000-8000-0000000000e1',
  currency: 'PLN',
  amount: 5_000,
  trigger: 'MANUAL',
  status: 'PENDING',
  failureReason: null,
  bankAccountMasked: '•••• 2874',
  createdAt: new Date().toISOString(),
  paidAt: null,
  failedAt: null,
};

test('dane do wypłat, wypłata salda i historia; axe i 390 px', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, SESSIONS.phoneVerified, baseURL);
  let state = profile();
  let available = 5_000;
  let history: Json[] = [sale];
  const api = await mockBrowserApi(page, {
    [`GET ${PROFILE}`]: () => ok(state),
    [`PUT ${PROFILE}/personal-data`]: () => {
      state = { ...state, personalData: PERSONAL };
      return ok(state);
    },
    [`PUT ${PROFILE}/bank-account`]: () => {
      state = {
        ...state,
        bankAccount: {
          masked: '•••• 2874',
          holderName: 'Anna Kowalska',
          changedAt: new Date().toISOString(),
        },
        complete: true,
      };
      return ok(state);
    },
    'GET /v1/me/balance': () => ok(balance(state['complete'] === true, available)),
    'GET /v1/me/balance/history': () => ok({ items: history, nextCursor: null }),
    'POST /v1/me/payouts': () => {
      available = 0;
      history = [
        {
          id: '01960000-0000-7000-8000-0000000000f2',
          type: 'PAYOUT_REQUESTED',
          occurredAt: payout.createdAt,
          available: -5_000,
          receivable: 0,
          order: null,
          payout,
        },
        sale,
      ];
      return { status: 201, json: payout };
    },
  });

  await gotoHydrated(page, '/konto/saldo');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Saldo i wypłaty');
  await expect(main.getByText(/podaj dane do wypłat/u)).toBeVisible();
  await expectNoAxeViolations(page);
  await main.getByRole('link', { name: 'Uzupełnij dane' }).click();

  await expect(page).toHaveURL(/\/konto\/saldo\/dane$/u);
  const personal = main.getByRole('region', { name: 'Dane osobowe' });
  await personal.getByLabel('Imię').fill('Anna');
  await personal.getByLabel('Nazwisko').fill('Kowalska');
  await personal.getByLabel('Data urodzenia').fill('1944-05-14');
  await personal.getByLabel('PESEL').fill('44051401359');
  await personal.getByLabel('Ulica i numer').fill('ul. Długa 5/2');
  await personal.getByLabel('Kod pocztowy').fill('00-950');
  await personal.getByLabel('Miejscowość').fill('Warszawa');
  await personal.getByRole('button', { name: 'Zapisz dane' }).click();
  await expect(personal.getByText('Zapisano.')).toBeVisible();

  const bank = main.getByRole('region', { name: 'Rachunek do wypłat' });
  await bank.getByLabel('Numer rachunku').fill('PL61 1090 1014 0000 0712 1981 2874');
  await bank.getByLabel('Właściciel rachunku').fill('Anna Kowalska');
  await bank.getByRole('button', { name: 'Zapisz rachunek' }).click();
  await expect(bank.getByText(/Obecny rachunek: •••• 2874/u)).toBeVisible();
  await expectNoAxeViolations(page);
  expect(api.requests(`PUT ${PROFILE}/bank-account`)).toHaveLength(1);

  await gotoHydrated(page, '/konto/saldo');
  await main.getByRole('button', { name: /^Wypłać 50\s+zł$/u }).click();
  await expect(main.getByText(/^Zleciliśmy wypłatę 50\s+zł\./u)).toBeVisible();
  const request = api.requests('POST /v1/me/payouts')[0];
  expect(request?.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/u);
  const historySection = main.getByRole('region', { name: 'Historia' });
  await expect(historySection.getByText(/Wypłata na •••• 2874/u)).toBeVisible();
  await expect(historySection.getByText('W drodze')).toBeVisible();
  await expectNoAxeViolations(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

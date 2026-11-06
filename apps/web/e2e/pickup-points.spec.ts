import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

import { SESSIONS } from './mock-api';
import {
  gotoHydrated,
  mockBrowserApi,
  ok,
  settle,
  setSsrAddresses,
  setSsrPickupPoints,
  signInAs,
} from './support';

// Punkty odbioru w koncie (F-64) na `next start`: pusty stan, nowy punkt z wyszukiwarki
// (FakeShipping nie ma mapy), zapis jako domyślny punkt usługi i usunięcie. Listę renderuje
// serwer z atrapy API; wyszukiwarkę i zapis obsługuje przeglądarka.

const WAW = {
  id: 'inpost-paczkomat-01',
  name: 'Paczkomat testowy 01',
  address: 'ul. Marszałkowska 1, 00-001 Warszawa',
  location: null,
  distanceMeters: null,
  openingHours: '24/7',
};

const SAVED = {
  id: '01960000-0000-7000-8000-0000000003a1',
  carrierId: 'inpost-paczkomat',
  pointId: WAW.id,
  name: WAW.name,
  address: WAW.address,
  openingHours: '24/7',
  isDefault: true,
  createdAt: '2026-11-06T10:00:00.000Z',
};

async function axe(page: Page) {
  await settle(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
}

test('punkty odbioru: dodanie z wyszukiwarki, domyślny i usunięcie; axe i 390 px', async ({
  page,
  context,
  baseURL,
}) => {
  const session = `${SESSIONS.phoneVerified}-pickup-points`;
  await signInAs(context, session, baseURL);
  await setSsrAddresses(session, []);
  await setSsrPickupPoints(session, []);
  const api = await mockBrowserApi(page, {
    'GET /v1/shipping/points': ok([WAW]),
    'POST /v1/me/pickup-points': async () => {
      await setSsrPickupPoints(session, [SAVED]);
      return { status: 201, json: SAVED };
    },
    [`DELETE /v1/me/pickup-points/${SAVED.id}`]: async () => {
      await setSsrPickupPoints(session, []);
      return { status: 204 };
    },
  });

  await gotoHydrated(page, '/konto/adresy');
  const main = page.getByRole('main');
  const section = main.getByRole('region', { name: 'Punkty odbioru' });
  await expect(section.getByText('Nie masz zapisanych punktów odbioru')).toBeVisible();
  await axe(page);

  await section.getByRole('link', { name: 'Dodaj punkt odbioru' }).click();
  await expect(main.getByRole('heading', { name: 'Nowy punkt odbioru' })).toBeVisible();
  // Bez klucza mapy (lokalnie i w e2e) od razu widać wyszukiwarkę.
  await expect(main.getByRole('button', { name: 'Wybierz na mapie' })).toHaveCount(0);
  await expect(
    main.getByRole('checkbox', { name: 'Ustaw jako domyślny dla tej usługi' }),
  ).toBeDisabled();
  await main.getByLabel('Miasto, adres albo kod punktu').fill('Warszawa');
  await main.getByRole('button', { name: 'Szukaj' }).click();
  await main.getByRole('radio', { name: /Paczkomat testowy 01/u }).click();
  await expect(main.getByText('Wybrany punkt')).toBeVisible();
  await axe(page);
  await main.getByRole('button', { name: 'Zapisz punkt' }).click();

  await expect(page).toHaveURL(/\/konto\/adresy\?punkt=zapisany$/u);
  await expect(section.getByText('Punkt odbioru zapisany.')).toBeVisible();
  await expect(section.getByText('Domyślny dla: InPost Paczkomat 24/7')).toBeVisible();
  expect(api.requests('POST /v1/me/pickup-points')[0]?.postDataJSON()).toEqual({
    carrierId: 'inpost-paczkomat',
    pointId: WAW.id,
    isDefault: true,
  });
  await axe(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await section.getByRole('button', { name: /^Usuń/u }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Usuń punkt' }).click();
  await expect(section.getByText('Nie masz zapisanych punktów odbioru')).toBeVisible();
});

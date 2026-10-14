import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

import { MEMBER, MEMBER_PHONE, SESSIONS } from './mock-api';
import { gotoHydrated, mockBrowserApi, ok, settle, setSsrAddresses, signInAs } from './support';

// Kryteria F-10 w przeglądarce: profil publiczny bez danych kontaktowych (SSR), edycja imienia,
// adresy (dodanie, domyślny, usunięcie z potwierdzeniem) i axe-core. Strony konta renderuje
// serwer z atrapą e2e/mock-api.ts; zmiany z przeglądarki trafiają do niej przez setSsrAddresses.

async function axe(page: Page) {
  await settle(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
}

function address(
  id: string,
  street: string,
  flags: { isDefault: boolean; isSenderDefault: boolean },
) {
  return {
    id,
    recipientName: MEMBER.name,
    street,
    postalCode: '00-950',
    city: 'Warszawa',
    country: 'PL',
    phone: MEMBER_PHONE,
    createdAt: '2026-10-02T10:00:00.000Z',
    ...flags,
  };
}

test('profil publiczny: imię, data dołączenia i znaczek telefonu, bez e-maila i telefonu', async ({
  page,
}) => {
  await mockBrowserApi(page);
  await gotoHydrated(page, `/u/${MEMBER.id}`);

  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1 })).toHaveText(MEMBER.name);
  await expect(main.getByText('Na Biddy od października 2026')).toBeVisible();
  await expect(main.getByText('Zweryfikowany telefon')).toBeVisible();
  await expect(main.getByRole('img', { name: `Zdjęcie profilowe: ${MEMBER.name}` })).toBeVisible();
  await expect(page).toHaveTitle(new RegExp(MEMBER.name));
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    new RegExp(`/u/${MEMBER.id}$`),
  );
  const html = await page.content();
  // Numer w formacie E.164 i e-mail; „500 600 700” występuje w tekstach jako przykład w podpowiedzi.
  for (const secret of [MEMBER.email, MEMBER_PHONE]) {
    expect(html).not.toContain(secret);
  }
  await axe(page);
});

test('profil publiczny nieznanego konta: 404 dla przeglądarki i robota', async ({
  page,
  request,
}) => {
  await mockBrowserApi(page);
  const unknown = '/u/01960000-0000-7000-8000-000000000999';
  const response = await page.goto(unknown);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nie znaleźliśmy tej strony');
  const bot = await request.get(unknown, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    },
  });
  expect(bot.status()).toBe(404);
});

test('edycja profilu: zapis imienia i błąd reguł imienia', async ({ page, context, baseURL }) => {
  await signInAs(context, `${SESSIONS.phoneVerified}-profile`, baseURL);
  const api = await mockBrowserApi(page, {
    'PATCH /v1/me': ok({ ...MEMBER, name: 'Kasia Nowa' }),
  });
  await gotoHydrated(page, '/konto/profil');
  const main = page.getByRole('main');
  const name = main.getByLabel('Imię wyświetlane');
  await expect(name).toHaveValue(MEMBER.name);

  await name.fill('Kasia www.sklep');
  await main.getByRole('button', { name: 'Zapisz' }).click();
  await expect(
    main.getByText('Imię wyświetlane nie może zawierać numeru telefonu ani adresu strony.'),
  ).toBeVisible();

  await name.fill('Kasia Nowa');
  await main.getByRole('button', { name: 'Zapisz' }).click();
  await expect(main.getByRole('status')).toHaveText('Zapisano.');
  expect(api.requests('PATCH /v1/me')[0]?.postDataJSON()).toEqual({ name: 'Kasia Nowa' });
  await axe(page);
});

test('adresy: dodanie, ustawienie domyślnego i usunięcie z potwierdzeniem', async ({
  page,
  context,
  baseURL,
}) => {
  const session = `${SESSIONS.phoneVerified}-addresses`;
  await signInAs(context, session, baseURL);
  await setSsrAddresses(session, []);
  const home = address('01960000-0000-7000-8000-0000000000a1', 'ul. Długa 5/12', {
    isDefault: true,
    isSenderDefault: true,
  });
  const work = address('01960000-0000-7000-8000-0000000000a2', 'ul. Krótka 1', {
    isDefault: false,
    isSenderDefault: false,
  });
  const api = await mockBrowserApi(page, {
    'POST /v1/me/addresses': async () => {
      await setSsrAddresses(session, [home, work]);
      return { status: 201, json: home };
    },
    [`PATCH /v1/me/addresses/${work.id}`]: async () => {
      const updated = { ...work, isDefault: true };
      await setSsrAddresses(session, [updated, { ...home, isDefault: false }]);
      return ok(updated);
    },
    [`DELETE /v1/me/addresses/${home.id}`]: async () => {
      await setSsrAddresses(session, [{ ...work, isDefault: true }]);
      return { status: 204 };
    },
  });

  await gotoHydrated(page, '/konto/adresy');
  const main = page.getByRole('main');
  await expect(main.getByText('Nie masz jeszcze adresów.')).toBeVisible();
  await axe(page);

  await main.getByRole('link', { name: 'Dodaj adres' }).click();
  await expect(main.getByLabel('Telefon')).toHaveValue('+48 500 600 700');
  await main.getByLabel('Imię i nazwisko albo firma').fill(MEMBER.name);
  await main.getByLabel('Ulica i numer').fill('ul. Długa 5/12');
  await main.getByLabel('Kod pocztowy').fill('00950');
  await main.getByLabel('Miasto').fill('Warszawa');
  await main.getByRole('button', { name: 'Zapisz adres' }).click();

  await expect(page).toHaveURL(/\/konto\/adresy$/);
  expect(api.requests('POST /v1/me/addresses')[0]?.postDataJSON()).toMatchObject({
    postalCode: '00950',
    phone: '+48 500 600 700',
  });
  const cards = main.getByRole('listitem');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).getByText('Domyślny adres dostawy')).toBeVisible();

  await cards.nth(1).getByRole('button', { name: 'Ustaw jako domyślny do dostawy' }).click();
  await expect(cards.nth(0)).toContainText('ul. Krótka 1');
  await expect(cards.nth(0).getByText('Domyślny adres dostawy')).toBeVisible();

  await cards.nth(1).getByRole('button', { name: 'Usuń' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('ul. Długa 5/12, 00-950 Warszawa');
  await axe(page);
  await dialog.getByRole('button', { name: 'Usuń adres' }).click();
  await expect(cards).toHaveCount(1);
  expect(api.requests(`DELETE /v1/me/addresses/${home.id}`)).toHaveLength(1);
});

test('konto: linki do profilu, adresów i profilu publicznego', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, `${SESSIONS.phoneVerified}-links`, baseURL);
  await mockBrowserApi(page);
  await gotoHydrated(page, '/konto');
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: 'Edytuj profil' })).toHaveAttribute(
    'href',
    '/konto/profil',
  );
  await expect(main.getByRole('link', { name: 'Adresy' })).toHaveAttribute('href', '/konto/adresy');
  await main.getByRole('link', { name: 'Zobacz swój profil publiczny' }).click();
  await expect(page).toHaveURL(new RegExp(`/u/${MEMBER.id}$`));
});

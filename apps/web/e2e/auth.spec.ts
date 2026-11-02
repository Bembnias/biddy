import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { MEMBER, SESSIONS } from './mock-api';
import {
  TURNSTILE_TOKEN,
  checkWhenHydrated,
  gotoHydrated,
  mockBrowserApi,
  ok,
  problem,
  settle,
  signInAs,
  stubTurnstile,
} from './support';

// Kryteria F-07 w przeglądarce: logowanie (z Turnstile po CAPTCHA_REQUIRED), rejestracja,
// konto renderowane na serwerze z ciasteczkiem sesji, akceptacja regulaminu i axe-core.
// Przeglądarka rozmawia z API przez page.route, a SSR z atrapą e2e/mock-api.ts.

const AUTH_PAGES = [
  { path: '/logowanie', heading: 'Zaloguj się' },
  { path: '/rejestracja', heading: 'Załóż konto' },
  { path: '/reset-hasla', heading: 'Nie pamiętasz hasła?' },
  { path: '/nowe-haslo?token=e2e-token', heading: 'Ustaw nowe hasło' },
  { path: '/weryfikacja-email', heading: 'Adres e-mail potwierdzony' },
  { path: '/akceptacja-regulaminu', heading: 'Zanim zaczniesz' },
  { path: '/wypisz', heading: 'Wypisanie z e-maili' },
] as const;

test.beforeEach(async ({ page }) => {
  await stubTurnstile(page);
});

for (const { path, heading } of AUTH_PAGES) {
  test(`${path}: nagłówek, noindex i brak naruszeń WCAG 2.1 A i AA`, async ({ page }) => {
    await mockBrowserApi(page);
    await gotoHydrated(page, path);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await settle(page);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
  });
}

test('logowanie: po CAPTCHA_REQUIRED Turnstile, kolejna próba z tokenem, potem konto z SSR', async ({
  page,
  context,
  baseURL,
}) => {
  let attempts = 0;
  const api = await mockBrowserApi(page, {
    'POST /v1/auth/sign-in/email': async (request) => {
      attempts += 1;
      if (request.headers()['x-turnstile-token'] !== TURNSTILE_TOKEN) {
        return problem(
          403,
          'CAPTCHA_REQUIRED',
          'Potwierdź, że nie jesteś robotem, i spróbuj ponownie.',
        );
      }
      await signInAs(context, SESSIONS.member, baseURL);
      return ok({ redirect: false, token: 'e2e', user: { id: MEMBER.id } });
    },
  });
  await gotoHydrated(page, '/logowanie?next=/konto');

  await page.getByRole('main').getByLabel('E-mail').fill(MEMBER.email);
  await page.getByRole('main').getByLabel('Hasło', { exact: true }).fill('Biddy-test-2026');
  await page.getByRole('main').getByRole('button', { name: 'Zaloguj się' }).click();

  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Potwierdź, że nie jesteś robotem',
  );
  await expect(
    page.getByRole('main').getByRole('group', { name: 'Weryfikacja, że nie jesteś robotem' }),
  ).toBeVisible();
  await page.getByRole('main').getByRole('button', { name: 'Zaloguj się' }).click();

  await expect(page).toHaveURL(/\/konto$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Moje konto');
  await expect(page.getByRole('main').getByText(MEMBER.name)).toBeVisible();
  await expect(page.getByRole('main').getByText(MEMBER.email)).toBeVisible();
  expect(attempts).toBe(2);
  expect(api.requests('POST /v1/auth/sign-in/email')[1]?.postDataJSON()).toEqual({
    email: MEMBER.email,
    password: 'Biddy-test-2026',
  });
});

test('logowanie: złe hasło daje komunikat po polsku przy formularzu', async ({ page }) => {
  await mockBrowserApi(page, {
    'POST /v1/auth/sign-in/email': problem(
      401,
      'INVALID_EMAIL_OR_PASSWORD',
      'Nieprawidłowy e-mail lub hasło.',
    ),
  });
  await gotoHydrated(page, '/logowanie');

  await page.getByRole('main').getByLabel('E-mail').fill(MEMBER.email);
  await page.getByRole('main').getByLabel('Hasło', { exact: true }).fill('zle-haslo-123');
  await page.getByRole('main').getByRole('button', { name: 'Zaloguj się' }).click();

  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    'Nieprawidłowy e-mail lub hasło.',
  );
  await expect(page).toHaveURL(/\/logowanie$/);
});

test('rejestracja: walidacja, zgody i token Turnstile w żądaniu, potem „Sprawdź skrzynkę”', async ({
  page,
}) => {
  const api = await mockBrowserApi(page, {
    'POST /v1/auth/sign-up/email': ok({ token: null, user: { id: MEMBER.id } }),
  });
  await gotoHydrated(page, '/rejestracja');

  await page.getByRole('main').getByRole('button', { name: 'Załóż konto', exact: true }).click();
  await expect(page.getByText('Zaakceptuj regulamin i politykę prywatności.')).toBeVisible();
  await expect(page.getByText('Konto mogą założyć tylko osoby pełnoletnie.')).toBeVisible();
  expect(api.requests('POST /v1/auth/sign-up/email')).toHaveLength(0);

  await page.getByRole('main').getByLabel('Imię wyświetlane').fill('Jan');
  await page.getByRole('main').getByLabel('E-mail').fill('jan@example.com');
  await page.getByRole('main').getByLabel('Hasło', { exact: true }).fill('bardzo-tajne-1');
  await checkWhenHydrated(
    page.getByRole('main').getByRole('checkbox', { name: /Akceptuję regulamin/ }),
  );
  await checkWhenHydrated(
    page.getByRole('main').getByRole('checkbox', { name: 'Mam ukończone 18 lat.' }),
  );
  await page.getByRole('main').getByRole('button', { name: 'Załóż konto', exact: true }).click();

  await expect(page.getByRole('main').getByRole('status')).toContainText('jan@example.com');
  const [request] = api.requests('POST /v1/auth/sign-up/email');
  expect(request?.headers()['x-turnstile-token']).toBe(TURNSTILE_TOKEN);
  expect(request?.postDataJSON()).toMatchObject({
    name: 'Jan',
    email: 'jan@example.com',
    acceptTerms: true,
    adultDeclaration: true,
  });
});

test('/konto bez sesji przekierowuje na logowanie z powrotem na konto', async ({ page }) => {
  await mockBrowserApi(page);
  await gotoHydrated(page, '/konto');

  await expect(page).toHaveURL(/\/logowanie\?next=%2Fkonto$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Zaloguj się');
});

test('/konto: konto bez akceptacji regulaminu przechodzi przez akceptację', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, SESSIONS.withoutTerms, baseURL);
  const api = await mockBrowserApi(page, {
    'GET /v1/session': ok({
      user: { id: MEMBER.id, name: MEMBER.name, emailVerified: false, termsAccepted: false },
    }),
    'POST /v1/me/terms-acceptances': async () => {
      await signInAs(context, SESSIONS.member, baseURL);
      return { status: 204 };
    },
  });
  await gotoHydrated(page, '/konto');

  await expect(page).toHaveURL(/\/akceptacja-regulaminu\?next=%2Fkonto$/);
  await checkWhenHydrated(
    page.getByRole('main').getByRole('checkbox', { name: /Akceptuję regulamin/ }),
  );
  await checkWhenHydrated(
    page.getByRole('main').getByRole('checkbox', { name: 'Mam ukończone 18 lat.' }),
  );
  await page.getByRole('main').getByRole('button', { name: 'Akceptuję' }).click();

  await expect(page).toHaveURL(/\/konto$/);
  await expect(page.getByRole('main').getByText(MEMBER.name)).toBeVisible();
  expect(api.requests('POST /v1/me/terms-acceptances')).toHaveLength(1);
});

test('/konto: niepotwierdzony e-mail, ponowna wysyłka linku i nagłówek z „Moje konto”', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, SESSIONS.member, baseURL);
  const api = await mockBrowserApi(page, {
    'GET /v1/session': ok({
      user: { id: MEMBER.id, name: MEMBER.name, emailVerified: false, termsAccepted: true },
    }),
    'POST /v1/auth/send-verification-email': ok({ status: true }),
  });
  await gotoHydrated(page, '/konto');

  await expect(page.getByRole('banner').getByRole('link', { name: 'Moje konto' })).toBeVisible();
  await expect(page.getByRole('main').getByText(/niepotwierdzony/)).toBeVisible();
  await page.getByRole('main').getByRole('button', { name: 'Wyślij link ponownie' }).click();
  await expect(
    page.getByRole('main').getByText('Wysłaliśmy nowy link. Sprawdź skrzynkę.'),
  ).toBeVisible();
  expect(api.requests('POST /v1/auth/send-verification-email')[0]?.postDataJSON()).toMatchObject({
    email: MEMBER.email,
  });
});

test.describe('formularz wysłany przed hydratacją (bez JavaScriptu)', () => {
  test.use({ javaScriptEnabled: false });

  test('logowanie nie wstawia e-maila ani hasła do adresu (POST zamiast GET)', async ({ page }) => {
    await page.goto('/logowanie');
    await page.getByLabel('E-mail').fill(MEMBER.email);
    await page.getByLabel('Hasło', { exact: true }).fill('Biddy-test-2026');
    await page.getByRole('button', { name: 'Zaloguj się' }).click();
    await page.waitForLoadState();

    expect(new URL(page.url()).pathname).toBe('/logowanie');
    expect(new URL(page.url()).search).toBe('');
  });
});

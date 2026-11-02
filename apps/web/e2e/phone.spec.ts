import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { MEMBER_PHONE, SESSIONS } from './mock-api';
import { gotoHydrated, mockBrowserApi, ok, problem, settle, signInAs } from './support';

// Kryteria F-08 w przeglądarce: weryfikacja telefonu (numer → kod → konto), wymagany
// potwierdzony e-mail, sekcja telefonu na koncie i axe-core. SSR rozmawia z atrapą
// e2e/mock-api.ts, przeglądarka z API podmienionym przez page.route.

const SENT = {
  phoneNumber: MEMBER_PHONE,
  expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
};

test('weryfikacja telefonu: numer, zły i dobry kod, potem konto ze zweryfikowanym numerem', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, SESSIONS.emailVerified, baseURL);
  let attempts = 0;
  const api = await mockBrowserApi(page, {
    'POST /v1/me/phone-verification': ok(SENT),
    'POST /v1/me/phone-verification/confirm': async () => {
      attempts += 1;
      if (attempts === 1) {
        return problem(400, 'PHONE_CODE_INVALID', 'Nieprawidłowy kod. Pozostałe próby: 4.');
      }
      await signInAs(context, SESSIONS.phoneVerified, baseURL);
      return ok({ phoneNumber: MEMBER_PHONE, verifiedAt: new Date().toISOString() });
    },
  });
  await gotoHydrated(page, '/weryfikacja-telefonu?next=/konto');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Zweryfikuj numer telefonu');
  await page.getByRole('main').getByLabel('Numer telefonu', { exact: true }).fill('500 600 700');
  await page.getByRole('main').getByRole('button', { name: 'Wyślij kod' }).click();

  await expect(page.getByRole('main').getByRole('status')).toContainText('+48 500 600 700');
  await expect(
    page.getByRole('main').getByRole('button', { name: /Wyślij ponownie za \d+ s/ }),
  ).toBeDisabled();
  expect(api.requests('POST /v1/me/phone-verification')[0]?.postDataJSON()).toEqual({
    phoneNumber: '+48500600700',
  });

  await page.getByRole('main').getByLabel('Kod z SMS-a').fill('111111');
  await page.getByRole('main').getByRole('button', { name: 'Potwierdź' }).click();
  await expect(page.getByText('Nieprawidłowy kod. Pozostałe próby: 4.')).toBeVisible();

  await page.getByRole('main').getByLabel('Kod z SMS-a').fill('123456');
  await page.getByRole('main').getByRole('button', { name: 'Potwierdź' }).click();
  await expect(page).toHaveURL(/\/konto$/);
  await expect(page.getByRole('main').getByText('+48 500 600 700')).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'Zmień numer' })).toBeVisible();
});

test('weryfikacja telefonu: brak naruszeń WCAG 2.1 A i AA na obu krokach', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, SESSIONS.emailVerified, baseURL);
  await mockBrowserApi(page, { 'POST /v1/me/phone-verification': ok(SENT) });
  await gotoHydrated(page, '/weryfikacja-telefonu');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

  const axe = async () => {
    await settle(page);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
  };
  await axe();
  await page.getByRole('main').getByLabel('Numer telefonu', { exact: true }).fill('500600700');
  await page.getByRole('main').getByRole('button', { name: 'Wyślij kod' }).click();
  await expect(page.getByRole('main').getByLabel('Kod z SMS-a')).toBeVisible();
  await axe();
});

test('weryfikacja telefonu wymaga potwierdzonego e-maila i sesji', async ({
  page,
  context,
  baseURL,
}) => {
  await mockBrowserApi(page);
  await gotoHydrated(page, '/weryfikacja-telefonu');
  await expect(page).toHaveURL(/\/logowanie\?next=%2Fweryfikacja-telefonu/);

  await signInAs(context, SESSIONS.member, baseURL);
  await gotoHydrated(page, '/weryfikacja-telefonu');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Najpierw potwierdź adres e-mail',
  );
  await expect(page.getByRole('main').getByLabel('Numer telefonu', { exact: true })).toHaveCount(0);
});

test('konto bez telefonu: „Zweryfikuj numer” prowadzi do weryfikacji z powrotem na konto', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, SESSIONS.emailVerified, baseURL);
  await mockBrowserApi(page, {
    'POST /v1/me/phone-verification': problem(
      429,
      'RATE_LIMITED',
      'Kolejny SMS możesz wysłać za 42 s.',
    ),
  });
  await gotoHydrated(page, '/konto');

  await expect(
    page.getByRole('main').getByText(/niezweryfikowany: zweryfikuj numer/),
  ).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'Zweryfikuj numer' }).click();
  await expect(page).toHaveURL(/\/weryfikacja-telefonu\?next=%2Fkonto$/);

  await page.getByRole('main').getByLabel('Numer telefonu', { exact: true }).fill('500 600 700');
  await page.getByRole('main').getByRole('button', { name: 'Wyślij kod' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    'Kolejny SMS możesz wysłać za 42 s.',
  );
});

import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

// Kryteria F-06 w przeglądarce: układ 360–1440 px bez przewijania w poziomie, dostępność
// (WCAG 2.1 A/AA według axe-core), klawiatura, 404, robots.txt i nagłówki bezpieczeństwa.

const PAGES = [
  { name: 'strona główna', path: '/' },
  { name: 'strona 404', path: '/nie-ma-takiej-strony' },
] as const;

const WIDTHS = [360, 768, 1024, 1440] as const;

/** API podmienione: synchronizacja zegara dostaje stały czas serwera. */
async function mockApi(page: Page): Promise<string[]> {
  const requests: string[] = [];
  await page.route('**/v1/time', async (route) => {
    requests.push(route.request().url());
    await route.fulfill({ json: { serverTime: new Date().toISOString() } });
  });
  return requests;
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

for (const { name, path } of PAGES) {
  for (const width of WIDTHS) {
    test(`${name}, ${width} px: bez poziomego przewijania, nagłówek i stopka widoczne`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      await expect(page.getByRole('searchbox', { name: 'Szukaj na Biddy' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Wystaw przedmiot' }).first()).toBeVisible();
      await expect(page.getByRole('contentinfo', { name: 'Stopka' })).toBeVisible();
    });
  }

  test(`${name}: brak naruszeń WCAG 2.1 A i AA (axe-core)`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
  });
}

test('strona główna: tytuł, nagłówek h1, lang="pl" i wyszukiwanie przez formularz', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Biddy: licytacje z ochroną kupującego');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Licytuj. Wygrywaj. Kupuj bezpiecznie.',
  );

  await page.getByRole('searchbox', { name: 'Szukaj na Biddy' }).fill('karty Pokémon');
  await page.getByRole('searchbox', { name: 'Szukaj na Biddy' }).press('Enter');
  await expect(page).toHaveURL(/\/szukaj\?q=karty\+Pok%C3%A9mon$/);
});

test('klawiatura: pierwszy Tab pokazuje „Przejdź do treści”, Enter przenosi fokus do treści', async ({
  page,
}) => {
  await page.goto('/');
  await page.keyboard.press('Tab');

  const skipLink = page.getByRole('link', { name: 'Przejdź do treści' });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(page.locator('main#main')).toBeFocused();
});

test('404: status, treść po polsku i noindex', async ({ page }) => {
  const response = await page.goto('/nie-ma-takiej-strony');

  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nie znaleźliśmy tej strony');
  const robots = await page
    .locator('meta[name="robots"]')
    .evaluateAll((metas) => metas.map((meta) => meta.getAttribute('content') ?? ''));
  expect(robots.length).toBeGreaterThan(0);
  expect(robots.every((content) => content.includes('noindex'))).toBe(true);
  await page.getByRole('link', { name: 'Strona główna' }).first().click();
  await expect(page).toHaveURL(/\/$/);
});

test('robots.txt poza produkcją blokuje indeksowanie', async ({ request }) => {
  const response = await request.get('/robots.txt');
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('Disallow: /');
});

test('nagłówki bezpieczeństwa', async ({ request }) => {
  const response = await request.get('/');
  expect(response.headers()).toMatchObject({
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
  });
  expect(response.headers()['x-powered-by']).toBeUndefined();
});

test('klient API: synchronizacja zegara woła GET /v1/time pod adresem API z konfiguracji', async ({
  page,
}) => {
  const requests = await mockApi(page);
  await page.goto('/');
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(requests[0]).toBe('http://localhost:3001/v1/time');
});

test('bez zgody na analitykę nie ma żadnych żądań do PostHog', async ({ page }) => {
  const requests = await mockApi(page);
  const posthog: string[] = [];
  page.on('request', (request) => {
    if (/posthog/i.test(request.url())) {
      posthog.push(request.url());
    }
  });
  await page.goto('/');
  // Po hydratacji (synchronizacja zegara już poszła) analityka miałaby szansę wystartować.
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  await page.waitForTimeout(1_000);
  expect(posthog).toEqual([]);
});

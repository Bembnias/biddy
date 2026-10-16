// Wyszukiwarka i przeglądanie (F-19) na `next start`: strona główna z aukcjami i kategoriami,
// wyniki z filtrami w zwykłym formularzu GET (także bez JavaScriptu), paginacja, strona kategorii
// z atrybutami, brak wyników, niedostępna wyszukiwarka i sitemap.
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';

import { type APIRequestContext, type Page, expect, test } from '@playwright/test';

import { CATEGORIES, searchCard, searchResult } from './mock-api';
import { mockBrowserApi, setSsrSearch, settle, ssrSearchRequests } from './support';

async function expectNoAxeViolations(page: Page) {
  await settle(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
}

/**
 * Strona z cache ISR mogła powstać przy `next build` (bez atrapy API): pierwsze żądanie dostaje
 * starą wersję i uruchamia odświeżenie w tle. Czekamy na świeżą wersję z oczekiwaną treścią.
 */
async function warmUp(
  request: APIRequestContext,
  path: string,
  marker: string,
  timeout = 20_000,
): Promise<void> {
  await expect
    .poll(async () => (await request.get(path)).text(), { timeout, intervals: [1_000] })
    .toContain(marker);
}

/** Unikalne zapytanie: wyniki atrapy i cache Next.js nie mieszają się między testami. */
const uniqueQuery = (name: string) => `${name}-${randomUUID().slice(0, 8)}`;

test('strona główna: kończące się, nowe aukcje i kategorie', async ({ page, request }) => {
  // Strona główna z buildu (bez atrapy API) jest w cache ISR do 60 s po buildzie: czekamy na
  // odświeżoną. Adres karty jest tylko w wyrenderowanej liście (tytuły sekcji są też
  // w komunikatach next-intl).
  test.slow();
  await warmUp(request, '/', '/a/zegarek-casio-vintage-k3x9qa', 80_000);
  await mockBrowserApi(page);
  await page.goto('/');
  const ending = page.getByRole('region', { name: 'Kończą się wkrótce' });
  await expect(ending.getByRole('link', { name: /Zegarek Casio vintage/u })).toHaveAttribute(
    'href',
    /^\/a\/zegarek-casio-vintage-k3x9qa/u,
  );
  await expect(page.getByRole('region', { name: 'Nowe aukcje' })).toBeVisible();
  const categories = page.getByRole('region', { name: 'Kategorie' });
  await expect(categories.getByRole('link', { name: 'Moda' })).toHaveAttribute(
    'href',
    '/kategoria/moda',
  );
  await expectNoAxeViolations(page);
});

test.describe('bez JavaScriptu', () => {
  test.use({ javaScriptEnabled: false });

  test('wyniki, filtry w formularzu GET i paginacja', async ({ page }) => {
    const q = uniqueQuery('zegarek');
    await setSsrSearch(
      q,
      searchResult(
        [searchCard(1, 'Zegarek Atlantic'), searchCard(2, 'Zegarek Poljot')],
        {
          conditions: [
            { value: 'NEW', count: 1 },
            { value: 'GOOD', count: 1 },
          ],
          categories: [{ ...CATEGORIES[0], count: 2 }].map(({ id, slug, name, path, count }) => ({
            id,
            slug,
            name,
            path,
            count,
          })),
          price: { min: 3_000, max: 4_000 },
        },
        { total: 60, totalPages: 3, sort: 'relevance' },
      ),
    );
    await page.goto(`/szukaj?q=${q}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Wyniki dla „${q}”`);
    await expect(page.getByText('60 aukcji')).toBeVisible();
    await expect(page.getByRole('link', { name: /Zegarek Atlantic/u })).toBeVisible();

    // Filtry: natywny formularz GET (bez JavaScriptu).
    await page.getByText(/^Filtry/u).click();
    await page.getByLabel('Nowy').check();
    await page.getByLabel('Cena (zł) od').fill('25');
    await page.getByLabel('Sortuj').selectOption('cena_rosnaco');
    await page.getByRole('button', { name: 'Pokaż wyniki' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/szukaj\\?q=${q}&sort=cena_rosnaco&stan=NEW&cena_od=25&cena_do=$`, 'u'),
    );
    const sent = (await ssrSearchRequests()).filter(
      (params) => params.get('q') === q && params.has('condition'),
    );
    expect(sent.at(-1)?.toString()).toBe(
      `q=${q}&condition=NEW&priceMin=2500&sort=price_asc&page=1&pageSize=24`,
    );

    // Paginacja i link do kategorii z liczbą aukcji.
    const pagination = page.getByRole('navigation', { name: 'Strony wyników' });
    await expect(pagination.getByRole('link', { name: 'Strona 1' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await pagination.getByRole('link', { name: 'Następna' }).click();
    await expect(page).toHaveURL(/strona=2/u);
    await page.getByText(/^Filtry/u).click();
    await expect(page.getByRole('link', { name: 'Moda' })).toHaveAttribute(
      'href',
      new RegExp(`^/szukaj\\?q=${q}&kategoria=moda`, 'u'),
    );
  });
});

test('strona kategorii: okruszki, podkategorie, atrybuty kategorii i adres kanoniczny', async ({
  page,
  request,
}) => {
  await mockBrowserApi(page);
  await page.goto('/kategoria/moda');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Moda');
  await expect(
    page.getByRole('navigation', { name: 'Ścieżka kategorii' }).getByText('Moda'),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'Sneakersy' })).toHaveAttribute(
    'href',
    '/kategoria/moda/sneakersy',
  );
  await expect(page.getByRole('group', { name: 'Kolor' }).getByLabel(/Biały/u)).toBeVisible();
  await expect(page.getByRole('link', { name: /Nike Air Max 90/u })).toBeVisible();
  await expect(page.getByText('Jak ustalamy kolejność wyników?')).toBeVisible();
  await expectNoAxeViolations(page);

  const html = await (await request.get('/kategoria/moda')).text();
  expect(html).toMatch(/<link rel="canonical" href="[^"]*\/kategoria\/moda"\/>/u);
  expect((await request.get('/kategoria/nie-ma-takiej')).status()).toBe(404);
});

test('brak wyników, niedostępna wyszukiwarka i opis kolejności wyników', async ({ page }) => {
  await mockBrowserApi(page);
  await page.goto(`/szukaj?q=${uniqueQuery('nic')}`);
  await expect(
    page.getByText('Nic nie znaleźliśmy. Sprawdź pisownię albo usuń część filtrów.'),
  ).toBeVisible();
  await page.getByText('Jak ustalamy kolejność wyników?').click();
  await expect(page.getByText(/Nie sprzedajemy pozycji w wynikach/u)).toBeVisible();

  await page.goto('/szukaj?q=awaria');
  await expect(
    page.getByRole('alert').filter({ hasText: 'Wyszukiwarka jest chwilowo niedostępna.' }),
  ).toBeVisible();
});

test('sitemap: strona główna, kategorie i aktywne aukcje', async ({ request }) => {
  await warmUp(request, '/sitemap.xml', '/kategoria/moda/sneakersy');
  const response = await request.get('/sitemap.xml');
  expect(response.status()).toBe(200);
  const xml = await response.text();
  expect(xml).toMatch(/<loc>[^<]*\/kategoria\/moda\/sneakersy<\/loc>/u);
  expect(xml).toMatch(/<loc>[^<]*\/a\/zegarek-casio-vintage-k3x9qa7m<\/loc>/u);
  expect(xml).toMatch(/<loc>[^<]*\/<\/loc>/u);
});

import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';

import { type Page, expect, test } from '@playwright/test';

import { MEMBER, SESSIONS } from './mock-api';
import {
  checkWhenHydrated,
  gotoHydrated,
  mockBrowserApi,
  ok,
  settle,
  setSsrAuctions,
  signInAs,
} from './support';

// Kryteria F-14 w przeglądarce: nowy szkic, 6 kroków kreatora z autozapisem (atrapa API i magazynu
// zdjęć), potwierdzenie informacji o KYC, publikacja i Moje aukcje; axe-core i szerokość 360 px.

const ID = '01960000-0000-7000-8000-0000000000a1';
const CATEGORY = '01960000-0000-7000-8000-0000000000c1';
const MEDIA_ID = '01960000-0000-7000-8000-0000000000f1';
const THUMB = `https://media.biddy.test/items/${MEDIA_ID}/thumb.webp`;

/** Najmniejszy poprawny PNG 1×1 (przezroczysty). */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const EMPTY: Record<string, unknown> = {
  id: ID,
  publicId: 'k3x9qa7m',
  status: 'DRAFT',
  editable: true,
  bidCount: 0,
  currency: 'PLN',
  categoryId: null,
  attributes: {},
  title: null,
  description: null,
  condition: null,
  brand: null,
  packageSize: null,
  weightGrams: null,
  lengthCm: null,
  widthCm: null,
  heightCm: null,
  allowedCarriers: [],
  photos: [],
  startPrice: null,
  reservePrice: null,
  buyNowPrice: null,
  durationDays: null,
  reviewReasons: [],
  startsAt: null,
  endsAt: null,
  publishedAt: null,
  cancelledAt: null,
  createdAt: '2026-10-15T10:00:00.000Z',
  updatedAt: '2026-10-15T10:00:00.000Z',
};

const CATEGORIES = [
  {
    id: 'dom',
    parentId: null,
    slug: 'dom-i-ogrod',
    name: 'Dom i ogród',
    path: ['dom-i-ogrod'],
    depth: 0,
    isLeaf: false,
    isRestricted: false,
    isBrandSensitive: false,
  },
  {
    id: CATEGORY,
    parentId: 'dom',
    slug: 'dekoracje',
    name: 'Dekoracje',
    path: ['dom-i-ogrod', 'dekoracje'],
    depth: 1,
    isLeaf: true,
    isRestricted: false,
    isBrandSensitive: false,
  },
];

function mediaDto(status: string) {
  return {
    id: MEDIA_ID,
    purpose: 'ITEM_PHOTO',
    status,
    width: status === 'READY' ? 1600 : null,
    height: status === 'READY' ? 1200 : null,
    urls:
      status === 'READY'
        ? {
            thumb: THUMB,
            medium: `https://media.biddy.test/items/${MEDIA_ID}/medium.webp`,
            large: `https://media.biddy.test/items/${MEDIA_ID}/large.webp`,
          }
        : null,
    rejectionReason: null,
    createdAt: '2026-10-15T10:00:00.000Z',
  };
}

/** Wspólne atrapy: przewoźnicy, kategorie, limity, cennik POK, magazyn i CDN zdjęć. */
async function listingApis(page: Page) {
  await page.route('https://s3.biddy.test/**', (route, request) =>
    route.fulfill({
      status: 200,
      headers: {
        'access-control-allow-origin': request.headers()['origin'] ?? '*',
        'access-control-allow-methods': 'PUT',
        'access-control-allow-headers': 'content-type',
      },
    }),
  );
  await page.route('https://media.biddy.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }),
  );
  return {
    'GET /v1/shipping/carriers': ok([
      {
        id: 'inpost-paczkomat',
        name: 'InPost Paczkomat 24/7',
        kind: 'LOCKER',
        packageSizes: ['S', 'M', 'L'],
      },
      {
        id: 'dpd-kurier',
        name: 'DPD Kurier',
        kind: 'COURIER',
        packageSizes: ['S', 'M', 'L', 'XL'],
      },
    ]),
    'GET /v1/categories': ok(CATEGORIES),
    [`GET /v1/categories/${CATEGORY}/schema`]: ok({
      ...CATEGORIES[1],
      attributes: [],
      listingNotice: null,
      jsonSchema: {},
    }),
    'GET /v1/me/selling-limits': ok({
      level: 'NEW',
      maxActiveAuctions: 5,
      activeAuctions: 0,
      maxAuctionValue: 500_000,
      kycVerified: false,
      kycRequiredAbove: 500_000,
      listingBlockedUntil: null,
      kycNoticeAccepted: false,
    }),
    'GET /v1/fee-schedules/current': ok({
      id: '019b76da-a800-7473-8d63-395c20bf8898',
      currency: 'PLN',
      fixedFee: 299,
      tiers: [
        { upTo: 100_000, bp: 700 },
        { upTo: null, bp: 400 },
      ],
      vatRateBp: 2300,
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: null,
    }),
    'POST /v1/media/uploads': ok({
      media: mediaDto('PENDING_UPLOAD'),
      upload: {
        url: `https://s3.biddy.test/biddy-uploads/incoming/${MEMBER.id}/${MEDIA_ID}`,
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg' },
        expiresAt: '2026-10-15T10:15:00.000Z',
      },
    }),
    [`POST /v1/media/${MEDIA_ID}/complete`]: { status: 202, json: mediaDto('PROCESSING') },
    [`GET /v1/media/${MEDIA_ID}`]: ok(mediaDto('READY')),
  };
}

/** Sesja z własnym stanem atrapy SSR (równoległe przebiegi tego samego testu się nie mieszają). */
function uniqueSession(name: string): string {
  return `${SESSIONS.phoneVerified}-${name}-${randomUUID().slice(0, 8)}`;
}

async function expectNoAxeViolations(page: Page) {
  await settle(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
}

test('kreator: nowy szkic, 6 kroków z autozapisem, informacja o KYC, publikacja i Moje aukcje', async ({
  page,
  context,
  baseURL,
}) => {
  const session = uniqueSession('listing');
  await signInAs(context, session, baseURL);
  await setSsrAuctions(session, []);
  let listing = { ...EMPTY };
  const patches: Record<string, unknown>[] = [];
  const api = await mockBrowserApi(page, {
    ...(await listingApis(page)),
    'GET /v1/me/auctions': ok([]),
    'POST /v1/auctions': async () => {
      await setSsrAuctions(session, [listing]);
      return { status: 201, json: listing };
    },
    [`PATCH /v1/auctions/${ID}`]: async (request) => {
      const body = request.postDataJSON() as Record<string, unknown>;
      patches.push(body);
      const mediaIds = body['mediaIds'] as string[] | undefined;
      listing = {
        ...listing,
        ...body,
        ...(mediaIds === undefined
          ? {}
          : { photos: mediaIds.map(() => ({ ...mediaDto('READY'), status: 'READY' })) }),
      };
      await setSsrAuctions(session, [listing]);
      return ok(listing);
    },
    [`POST /v1/auctions/${ID}/publish`]: async () => {
      listing = {
        ...listing,
        status: 'ACTIVE',
        startsAt: '2026-10-15T10:00:00.000Z',
        endsAt: '2026-10-22T10:00:00.000Z',
        publishedAt: '2026-10-15T10:00:00.000Z',
      };
      await setSsrAuctions(session, [listing]);
      return ok(listing);
    },
  });

  await gotoHydrated(page, '/wystaw');
  const main = page.getByRole('main');
  await expect(main.getByText('Nie masz zapisanych szkiców.')).toBeVisible();
  await main.getByRole('button', { name: 'Nowa aukcja' }).click();
  await expect(page).toHaveURL(`/wystaw/${ID}`);

  // 1. Zdjęcia
  await expect(main.getByRole('heading', { name: 'Krok 1 z 6: Zdjęcia' })).toBeVisible();
  await main.getByLabel('Dodaj zdjęcia').setInputFiles({
    name: 'wazon.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.alloc(4096, 1),
  });
  await expect(main.getByRole('img', { name: 'Zdjęcie 1' })).toBeVisible({ timeout: 10_000 });
  await expectNoAxeViolations(page);
  await main.getByRole('button', { name: 'Dalej' }).click();

  // 2. Kategoria
  await expect(page).toHaveURL(`/wystaw/${ID}?krok=kategoria`);
  await expect(
    main.getByRole('heading', { name: 'Krok 2 z 6: Kategoria i szczegóły' }),
  ).toBeFocused();
  await main.getByLabel('Kategoria', { exact: true }).selectOption({ label: 'Dom i ogród' });
  await main.getByLabel('Podkategoria').selectOption({ label: 'Dekoracje' });
  await main.getByRole('button', { name: 'Dalej' }).click();

  // 3. Opis: braki zatrzymują na kroku
  await expect(page).toHaveURL(`/wystaw/${ID}?krok=opis`);
  await main.getByRole('button', { name: 'Dalej' }).click();
  await expect(main.getByRole('alert')).toHaveText('Popraw zaznaczone pola, żeby przejść dalej.');
  await expect(main.getByLabel('Tytuł')).toBeFocused();
  await main.getByLabel('Tytuł').fill('Wazon ceramiczny, lata 70.');
  await main
    .getByLabel('Opis', { exact: true })
    .fill('Ręcznie malowany wazon, bez pęknięć i odprysków. Wysokość 30 cm.');
  await main.getByRole('radio', { name: /^Bardzo dobry/u }).check();
  await main.getByRole('button', { name: 'Dalej' }).click();

  // 4. Dostawa
  await expect(page).toHaveURL(`/wystaw/${ID}?krok=dostawa`);
  await main.getByRole('radio', { name: 'M do 19 × 38 × 64 cm' }).check();
  await checkWhenHydrated(main.getByRole('checkbox', { name: 'InPost Paczkomat 24/7 paczkomat' }));
  await main.getByRole('button', { name: 'Dalej' }).click();

  // 5. Cena
  await expect(page).toHaveURL(`/wystaw/${ID}?krok=cena`);
  await main.getByLabel('Cena wywoławcza (zł)').fill('20');
  await main.getByRole('radio', { name: '7 dni' }).check();
  await expect(main.getByText(/zapłacisz/u)).toHaveText(/Licytujesz 20\szł · zapłacisz 24,39\szł/u);
  await expectNoAxeViolations(page);
  await main.getByRole('button', { name: 'Dalej' }).click();

  // 6. Podgląd i publikacja
  await expect(page).toHaveURL(`/wystaw/${ID}?krok=podglad`);
  await expect(main.getByText('Wszystko gotowe do publikacji.')).toBeVisible();
  await main.getByRole('button', { name: 'Opublikuj aukcję' }).click();
  await expect(
    main.getByText('Potwierdź, że znasz zasady weryfikacji tożsamości przed wypłatą środków.'),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  await checkWhenHydrated(
    main.getByRole('checkbox', {
      name: 'Rozumiem, że wypłata środków wymaga weryfikacji tożsamości',
    }),
  );
  await main.getByRole('button', { name: 'Opublikuj aukcję' }).click();

  await expect(page).toHaveURL(`/moje-biddy/aukcje?opublikowano=${ID}`);
  await expect(main.getByRole('status')).toContainText(
    'Aukcja „Wazon ceramiczny, lata 70.” jest aktywna do',
  );
  await expect(main.getByText('Aktywna', { exact: true })).toBeVisible();
  await expectNoAxeViolations(page);

  // Autozapis wysłał komplet pól; publikacja z potwierdzeniem informacji o KYC.
  expect(Object.assign({}, ...patches)).toMatchObject({
    mediaIds: [MEDIA_ID],
    categoryId: CATEGORY,
    title: 'Wazon ceramiczny, lata 70.',
    condition: 'VERY_GOOD',
    packageSize: 'M',
    allowedCarriers: ['inpost-paczkomat'],
    startPrice: 2_000,
    durationDays: 7,
  });
  expect(
    api
      .requests(`POST /v1/auctions/${ID}/publish`)
      .map((request) => request.postDataJSON() as unknown),
  ).toEqual([{ kycNoticeAccepted: true }]);
});

test('kreator na telefonie (360 px): bez przewijania w poziomie, axe-core', async ({
  page,
  context,
  baseURL,
}) => {
  const session = uniqueSession('listing-mobile');
  await signInAs(context, session, baseURL);
  await setSsrAuctions(session, [
    { ...EMPTY, packageSize: 'XL', title: 'Szafa dębowa, trzydrzwiowa' },
  ]);
  await mockBrowserApi(page, { ...(await listingApis(page)) });
  await page.setViewportSize({ width: 360, height: 740 });
  await gotoHydrated(page, `/wystaw/${ID}?krok=dostawa`);
  const main = page.getByRole('main');
  await expect(main.getByLabel('Długość (cm)')).toBeVisible();
  await expect(
    main.getByRole('checkbox', { name: 'InPost Paczkomat 24/7 nie obsługuje gabarytu XL' }),
  ).toBeDisabled();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);
});

test('cudzy albo nieistniejący szkic: 404', async ({ page, context, baseURL }) => {
  const session = uniqueSession('listing-404');
  await signInAs(context, session, baseURL);
  await setSsrAuctions(session, []);
  await mockBrowserApi(page);
  const response = await page.goto(`/wystaw/${ID}`);
  expect(response?.status()).toBe(404);
});

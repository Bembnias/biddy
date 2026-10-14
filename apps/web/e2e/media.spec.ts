import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { MEMBER, SESSIONS } from './mock-api';
import { gotoHydrated, mockBrowserApi, ok, settle, setSsrMe, signInAs } from './support';

// Kryteria F-12 w przeglądarce: zdjęcie profilowe przez presigned PUT (atrapa magazynu i CDN),
// przetwarzanie (odpytywanie o stan), zapis i odświeżenie strony z SSR, axe-core.

const MEDIA_ID = '01960000-0000-7000-8000-0000000000c1';
const UPLOAD_URL = `https://s3.biddy.test/biddy-uploads/incoming/${MEMBER.id}/${MEDIA_ID}`;
const AVATAR_URL = `https://media.biddy.test/avatars/${MEDIA_ID}/large.webp`;

/** Najmniejszy poprawny PNG 1×1 (przezroczysty). */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

function mediaDto(status: string) {
  return {
    id: MEDIA_ID,
    purpose: 'AVATAR',
    status,
    width: status === 'READY' ? 256 : null,
    height: status === 'READY' ? 256 : null,
    urls:
      status === 'READY'
        ? { small: `https://media.biddy.test/avatars/${MEDIA_ID}/small.webp`, large: AVATAR_URL }
        : null,
    rejectionReason: null,
    createdAt: '2026-10-14T10:00:00.000Z',
  };
}

test('zdjęcie profilowe: upload, przetwarzanie, zapis i widok po odświeżeniu', async ({
  page,
  context,
  baseURL,
}) => {
  const session = `${SESSIONS.phoneVerified}-avatar`;
  await signInAs(context, session, baseURL);
  await setSsrMe(session, { avatarUrl: null });
  const puts: string[] = [];
  await page.route('https://s3.biddy.test/**', async (route, request) => {
    const headers = {
      'access-control-allow-origin': request.headers()['origin'] ?? '*',
      'access-control-allow-methods': 'PUT',
      'access-control-allow-headers': 'content-type',
    };
    if (request.method() === 'PUT') {
      puts.push(request.headers()['content-type'] ?? '');
    }
    await route.fulfill({ status: 200, headers });
  });
  await page.route('https://media.biddy.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }),
  );
  let polls = 0;
  const api = await mockBrowserApi(page, {
    'POST /v1/media/uploads': ok({
      media: mediaDto('PENDING_UPLOAD'),
      upload: {
        url: UPLOAD_URL,
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg' },
        expiresAt: '2026-10-14T10:15:00.000Z',
      },
    }),
    [`POST /v1/media/${MEDIA_ID}/complete`]: { status: 202, json: mediaDto('PROCESSING') },
    [`GET /v1/media/${MEDIA_ID}`]: () => {
      polls += 1;
      return ok(mediaDto(polls < 2 ? 'PROCESSING' : 'READY'));
    },
    'PUT /v1/me/avatar': async () => {
      await setSsrMe(session, { avatarUrl: AVATAR_URL });
      return ok({ avatarUrl: AVATAR_URL });
    },
  });

  await gotoHydrated(page, '/konto/profil');
  const main = page.getByRole('main');
  const avatar = main.getByRole('img', { name: `Zdjęcie profilowe: ${MEMBER.name}` });
  await expect(avatar).toHaveText('KK');

  await main.getByLabel('Dodaj zdjęcie').setInputFiles({
    name: 'ja.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.alloc(4096, 1),
  });

  await expect(main.getByText('Zapisano zdjęcie profilowe.')).toBeVisible({ timeout: 10_000 });
  await expect(avatar).toHaveAttribute('src', AVATAR_URL);
  expect(puts).toEqual(['image/jpeg']);
  expect(api.requests('POST /v1/media/uploads')[0]?.postDataJSON()).toEqual({
    purpose: 'AVATAR',
    contentType: 'image/jpeg',
    sizeBytes: 4096,
  });
  expect(api.requests('PUT /v1/me/avatar')[0]?.postDataJSON()).toEqual({ mediaId: MEDIA_ID });

  await gotoHydrated(page, '/konto/profil');
  await expect(
    main.getByRole('img', { name: `Zdjęcie profilowe: ${MEMBER.name}` }),
  ).toHaveAttribute('src', AVATAR_URL);
  await expect(main.getByRole('button', { name: 'Usuń zdjęcie' })).toBeVisible();

  await settle(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
});

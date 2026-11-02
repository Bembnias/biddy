// Kryteria F-14 na prawdziwym Postgresie (Testcontainers): szkic z autozapisem i zdjęciami,
// publikacja (braki jako błędy pól, telefon, informacja o KYC, limity §4.1, blokada, filtr słów,
// kategoria z ograniczeniami), edycja przed pierwszą ofertą, anulowanie (§6.6), ponowne
// wystawienie, przewoźnicy z migracji i eventy w outboxie. Zdjęcia READY wstawiamy wprost do
// tabeli media (przetwarzanie testuje media.int.test.ts).
import type { LightMyRequestResponse } from 'fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId } from '../../src/infra/db/index.js';
import { type TestUser, createUser as createTestUser } from './support/accounts.js';
import { integrationConfig, problemOf, startTestApp, type TestApp } from './support/app.js';
import type { ScratchDatabase } from './support/database.js';
import { createMigratedDatabase, redisUrl, uniqueQueuePrefix } from './support/worker.js';

const WEB = 'http://localhost:3000';
const DAY = 24 * 60 * 60 * 1_000;

let database: ScratchDatabase;
let pool: Pool;
let api: TestApp;
let ipCounter = 10;

beforeAll(async () => {
  database = await createMigratedDatabase();
  pool = new Pool({ connectionString: database.url, max: 4 });
  api = await startTestApp(
    integrationConfig({
      DATABASE_URL: database.url,
      REDIS_QUEUE_URL: redisUrl(),
      QUEUE_PREFIX: uniqueQueuePrefix(),
      TRUST_PROXY: 'loopback',
    }),
  );
}, 120_000);

afterAll(async () => {
  await api.close();
  await pool.end();
  await database.drop();
});

interface Listing {
  id: string;
  publicId: string;
  status: string;
  editable: boolean;
  title: string | null;
  description: string | null;
  photos: { id: string; status: string; urls: Record<string, string> | null }[];
  startPrice: number | null;
  reservePrice: number | null;
  buyNowPrice: number | null;
  durationDays: number | null;
  reviewReasons: string[];
  startsAt: string | null;
  endsAt: string | null;
}

function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  user: TestUser,
  body?: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  ipCounter += 1;
  return api.http.inject({
    method,
    url,
    headers: {
      'x-forwarded-for': `192.0.2.${String(ipCounter % 250)}`,
      origin: WEB,
      cookie: user.cookie,
    },
    ...(body === undefined ? {} : { payload: body }),
  });
}

function createUser(options: { phone?: boolean } = {}): Promise<TestUser> {
  return createTestUser(api, pool, { ...options, name: 'Sprzedawca Testowy' });
}

/** Gotowe zdjęcie przedmiotu (jak po przetworzeniu w workerze). */
async function readyPhoto(user: TestUser, status = 'READY'): Promise<string> {
  const id = newId();
  await pool.query(
    `insert into media (id, owner_id, purpose, status, content_type, size_bytes, width, height)
     values ($1, $2, 'ITEM_PHOTO', $3, 'image/jpeg', 1000, 1600, 1200)`,
    [id, user.id, status],
  );
  return id;
}

async function categoryId(slug: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>('select id from categories where slug = $1', [
    slug,
  ]);
  return rows[0]?.id ?? '';
}

async function draft(user: TestUser): Promise<Listing> {
  const response = await call('POST', '/v1/auctions', user);
  expect(response.statusCode, response.body).toBe(201);
  return response.json<Listing>();
}

async function completeFields(user: TestUser): Promise<Record<string, unknown>> {
  return {
    mediaIds: [await readyPhoto(user), await readyPhoto(user)],
    categoryId: await categoryId('dekoracje'),
    title: 'Wazon ceramiczny, lata 70.',
    description: 'Ręcznie malowany wazon, bez pęknięć i odprysków. Wysokość 30 cm.',
    condition: 'VERY_GOOD',
    packageSize: 'M',
    allowedCarriers: ['inpost-paczkomat', 'dpd-kurier'],
    startPrice: 2_000,
    durationDays: 7,
  };
}

async function completeDraft(
  user: TestUser,
  overrides: Record<string, unknown> = {},
): Promise<Listing> {
  const created = await draft(user);
  const response = await call('PATCH', `/v1/auctions/${created.id}`, user, {
    ...(await completeFields(user)),
    ...overrides,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<Listing>();
}

function publish(user: TestUser, auctionId: string, kycNoticeAccepted = true) {
  return call('POST', `/v1/auctions/${auctionId}/publish`, user, { kycNoticeAccepted });
}

async function published(user: TestUser, overrides: Record<string, unknown> = {}) {
  const listing = await completeDraft(user, overrides);
  const response = await publish(user, listing.id);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<Listing>();
}

function errorPaths(response: LightMyRequestResponse): string[] {
  return (problemOf(response).errors ?? []).map((error) => error.path);
}

async function outbox(type: string, auctionId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
    'select payload from outbox where type = $1 and aggregate_id = $2 order by occurred_at',
    [type, auctionId],
  );
  return rows.map((row) => row.payload);
}

async function attachedAt(mediaId: string): Promise<Date | null> {
  const { rows } = await pool.query<{ attached_at: Date | null }>(
    'select attached_at from media where id = $1',
    [mediaId],
  );
  return rows[0]?.attached_at ?? null;
}

describe('przewoźnicy z migracji', () => {
  it('GET /v1/shipping/carriers: usługi z gabarytami, publiczne z cache', async () => {
    const response = await api.http.inject({ method: 'GET', url: '/v1/shipping/carriers' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=300');
    expect(response.json()).toEqual([
      {
        id: 'inpost-paczkomat',
        name: 'InPost Paczkomat 24/7',
        kind: 'LOCKER',
        packageSizes: ['S', 'M', 'L'],
      },
      {
        id: 'inpost-kurier',
        name: 'InPost Kurier',
        kind: 'COURIER',
        packageSizes: ['S', 'M', 'L', 'XL'],
      },
      {
        id: 'orlen-paczka',
        name: 'Orlen Paczka',
        kind: 'PICKUP_POINT',
        packageSizes: ['S', 'M', 'L'],
      },
      { id: 'dpd-pickup', name: 'DPD Pickup', kind: 'PICKUP_POINT', packageSizes: ['S', 'M', 'L'] },
      {
        id: 'dpd-kurier',
        name: 'DPD Kurier',
        kind: 'COURIER',
        packageSizes: ['S', 'M', 'L', 'XL'],
      },
    ]);
  });
});

describe('szkic', () => {
  it('tworzenie, autozapis częściowych danych, zdjęcia przypisane i zwolnione, usunięcie', async () => {
    const user = await createUser({ phone: false });
    const created = await draft(user);
    expect(created).toMatchObject({ status: 'DRAFT', editable: true, title: null, photos: [] });
    expect(created.publicId).toMatch(/^[a-z2-9]{8}$/u);

    const [first, second] = [await readyPhoto(user), await readyPhoto(user)];
    const saved = await call('PATCH', `/v1/auctions/${created.id}`, user, {
      title: '  Wazon   ceramiczny ',
      description: 'Krótko',
      startPrice: 99,
      mediaIds: [first, second],
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({
      title: 'Wazon ceramiczny',
      description: 'Krótko',
      startPrice: 99,
      photos: [
        {
          id: first,
          status: 'READY',
          urls: { thumb: expect.stringContaining(`/items/${first}/thumb.webp`) as string },
        },
        { id: second, status: 'READY' },
      ],
    });
    expect(await attachedAt(first)).not.toBeNull();

    const reordered = await call('PATCH', `/v1/auctions/${created.id}`, user, {
      mediaIds: [second],
      title: null,
    });
    expect(reordered.json()).toMatchObject({ title: null, photos: [{ id: second }] });
    expect(await attachedAt(first)).toBeNull();

    const list = await call('GET', '/v1/me/auctions?status=DRAFT', user);
    expect(list.json()).toEqual([
      expect.objectContaining({
        id: created.id,
        status: 'DRAFT',
        title: null,
        coverUrl: expect.stringContaining(`/items/${second}/thumb.webp`) as string,
        // Zdjęcie jest, kategorii brak: ukończony tylko pierwszy krok kreatora.
        completedSteps: 1,
      }),
    ]);
    expect(
      (await call('GET', '/v1/me/auctions?status=ACTIVE&status=CANCELLED', user)).json(),
    ).toEqual([]);

    expect((await call('DELETE', `/v1/auctions/${created.id}`, user)).statusCode).toBe(204);
    expect(await attachedAt(second)).toBeNull();
    expect((await call('GET', `/v1/me/auctions/${created.id}`, user)).statusCode).toBe(404);
  });

  it('postęp szkicu: kroki bez braków od pierwszego, null po publikacji (F-63)', async () => {
    const user = await createUser();
    const empty = await draft(user);
    const complete = await completeDraft(user);
    const noDescription = await completeDraft(user, { description: null });
    // Nowe konto: wartość aukcji do 5000 zł, więc brak jest w kroku ceny.
    const overLimit = await completeDraft(user, { startPrice: 600_000 });
    const progress = async () =>
      new Map(
        (await call('GET', '/v1/me/auctions', user))
          .json<{ id: string; completedSteps: number | null }[]>()
          .map((row) => [row.id, row.completedSteps]),
      );
    expect(await progress()).toEqual(
      new Map([
        [empty.id, 0],
        [complete.id, 5],
        [noDescription.id, 2],
        [overLimit.id, 4],
      ]),
    );

    expect((await publish(user, complete.id)).statusCode).toBe(200);
    expect((await progress()).get(complete.id)).toBeNull();
  });

  it('zdjęcie niegotowe albo cudze i nieistniejąca kategoria: 400, nic się nie zapisuje', async () => {
    const user = await createUser({ phone: false });
    const other = await createUser({ phone: false });
    const created = await draft(user);
    for (const mediaId of [await readyPhoto(user, 'PROCESSING'), await readyPhoto(other)]) {
      const response = await call('PATCH', `/v1/auctions/${created.id}`, user, {
        title: 'Nie powinno się zapisać',
        mediaIds: [mediaId],
      });
      expect(response.statusCode).toBe(400);
      expect(errorPaths(response)).toEqual(['mediaIds']);
    }
    const category = await call('PATCH', `/v1/auctions/${created.id}`, user, {
      categoryId: '01960000-0000-7000-8000-000000000999',
    });
    expect(errorPaths(category)).toEqual(['categoryId']);
    expect((await call('GET', `/v1/me/auctions/${created.id}`, user)).json()).toMatchObject({
      title: null,
      photos: [],
      categoryId: null,
    });
  });

  it('cudza aukcja i zły identyfikator: 404', async () => {
    const owner = await createUser({ phone: false });
    const stranger = await createUser();
    const created = await draft(owner);
    for (const [method, url] of [
      ['GET', `/v1/me/auctions/${created.id}`],
      ['PATCH', `/v1/auctions/${created.id}`],
      ['POST', `/v1/auctions/${created.id}/publish`],
      ['DELETE', `/v1/auctions/${created.id}`],
      ['GET', '/v1/me/auctions/nie-uuid'],
    ] as const) {
      const response = await call(
        method,
        url,
        stranger,
        method === 'GET' || method === 'DELETE' ? undefined : {},
      );
      expect(response.statusCode, `${method} ${url}`).toBe(404);
    }
  });
});

describe('publikacja', () => {
  it('wymaga zweryfikowanego telefonu', async () => {
    const user = await createUser({ phone: false });
    const listing = await completeDraft(user);
    const response = await publish(user, listing.id);
    expect(response.statusCode).toBe(403);
    expect(problemOf(response).code).toBe('PHONE_NOT_VERIFIED');
  });

  it('pusty szkic: każde brakujące pole i potwierdzenie informacji o KYC', async () => {
    const user = await createUser();
    const created = await draft(user);
    const response = await call('POST', `/v1/auctions/${created.id}/publish`, user, {});
    expect(response.statusCode).toBe(400);
    expect(errorPaths(response)).toEqual([
      'mediaIds',
      'categoryId',
      'title',
      'description',
      'condition',
      'packageSize',
      'allowedCarriers',
      'startPrice',
      'durationDays',
      'kycNoticeAccepted',
    ]);
  });

  it('komplet: ACTIVE na czas trwania, event AuctionPublished, potwierdzenie KYC zapisane raz', async () => {
    const user = await createUser();
    const listing = await completeDraft(user, { buyNowPrice: 2_600, reservePrice: 2_500 });
    const response = await publish(user, listing.id);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<Listing>();
    expect(body).toMatchObject({ status: 'ACTIVE', editable: true, reviewReasons: [] });
    expect(Date.parse(body.endsAt ?? '') - Date.parse(body.startsAt ?? '')).toBe(7 * DAY);
    expect(await outbox('AuctionPublished', listing.id)).toEqual([
      expect.objectContaining({
        sellerId: user.id,
        categoryId: await categoryId('dekoracje'),
        startPrice: { amount: 2_000, currency: 'PLN' },
        buyNowPrice: { amount: 2_600, currency: 'PLN' },
        endsAt: new Date(body.endsAt ?? '').toISOString(),
      }),
    ]);
    const { rows } = await pool.query<{ accepted: Date | null }>(
      'select seller_kyc_notice_accepted_at as accepted from users where id = $1',
      [user.id],
    );
    expect(rows[0]?.accepted).not.toBeNull();

    const again = await publish(user, listing.id);
    expect(again.statusCode).toBe(409);
    // Kolejna publikacja nie wymaga już potwierdzenia.
    const next = await completeDraft(user);
    expect((await publish(user, next.id, false)).statusCode).toBe(200);
  });

  it('Kup teraz poniżej 130% ceny wywoławczej albo poniżej ceny minimalnej: odrzucone', async () => {
    const user = await createUser();
    const low = await completeDraft(user, { startPrice: 10_000, buyNowPrice: 12_999 });
    const response = await publish(user, low.id);
    expect(response.statusCode).toBe(400);
    expect(problemOf(response).errors).toEqual([
      expect.objectContaining({
        path: 'buyNowPrice',
        message: expect.stringContaining('130% ceny wywoławczej') as string,
      }),
    ]);
    const belowReserve = await completeDraft(user, {
      startPrice: 10_000,
      reservePrice: 20_000,
      buyNowPrice: 15_000,
    });
    expect(errorPaths(await publish(user, belowReserve.id))).toEqual(['buyNowPrice']);
  });

  it('nowe konto: wartość aukcji do 5000 zł, powyżej także brak KYC', async () => {
    const user = await createUser();
    const pricey = await completeDraft(user, { startPrice: 10_000, reservePrice: 500_001 });
    const response = await publish(user, pricey.id);
    expect(problemOf(response).errors).toEqual([
      expect.objectContaining({
        path: 'reservePrice',
        // formatMoney oddziela kwotę od „zł” twardą spacją (Intl.NumberFormat).
        message: expect.stringContaining('Twój limit wartości aukcji to 5000 zł') as string,
      }),
    ]);
    expect(
      (await publish(user, (await completeDraft(user, { startPrice: 500_000 })).id)).statusCode,
    ).toBe(200);
  });

  it('nowe konto: najwyżej 5 aktywnych aukcji (także przy równoległych publikacjach)', async () => {
    const user = await createUser();
    for (let index = 0; index < 4; index += 1) {
      await published(user);
    }
    const [first, second] = [await completeDraft(user), await completeDraft(user)];
    const results = await Promise.all([publish(user, first.id), publish(user, second.id)]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    const rejected = results.find((result) => result.statusCode === 409);
    expect(rejected === undefined ? undefined : problemOf(rejected)).toMatchObject({
      code: 'LISTING_LIMIT_REACHED',
      limit: 5,
    });
    const limits: unknown = (await call('GET', '/v1/me/selling-limits', user)).json();
    expect(limits).toEqual({
      level: 'NEW',
      maxActiveAuctions: 5,
      activeAuctions: 5,
      maxAuctionValue: 500_000,
      kycVerified: false,
      kycRequiredAbove: 500_000,
      listingBlockedUntil: null,
      kycNoticeAccepted: true,
    });
  });

  it('blokada wystawiania: 403 LISTING_BLOCKED z datą końca', async () => {
    const user = await createUser();
    const until = new Date(Date.now() + 3 * DAY);
    await pool.query('update users set listing_blocked_until = $2 where id = $1', [user.id, until]);
    const response = await publish(user, (await completeDraft(user)).id);
    expect(response.statusCode).toBe(403);
    expect(problemOf(response)).toMatchObject({
      code: 'LISTING_BLOCKED',
      blockedUntil: until.toISOString(),
    });
  });

  it('filtr słów: zakazane odrzuca, niejednoznaczne kieruje do moderacji', async () => {
    const user = await createUser();
    const blocked = await completeDraft(user, { title: 'Naboje kolekcjonerskie 9 mm' });
    const response = await publish(user, blocked.id);
    expect(response.statusCode).toBe(400);
    expect(problemOf(response).errors).toEqual([
      expect.objectContaining({
        path: 'title',
        message: expect.stringContaining('„naboj”') as string,
      }),
    ]);

    const review = await completeDraft(user, {
      description: 'Replika wazonu z muzeum, wykonana ręcznie, bez uszkodzeń.',
    });
    const submitted = await publish(user, review.id);
    expect(submitted.json()).toMatchObject({
      status: 'PENDING_REVIEW',
      reviewReasons: ['WORD_FILTER'],
      startsAt: null,
      endsAt: null,
    });
    expect(await outbox('AuctionSubmittedForReview', review.id)).toEqual([
      expect.objectContaining({ reasons: ['WORD_FILTER'], terms: ['replik'] }),
    ]);
  });

  it('kategoria z ograniczeniami (Militaria): moderacja przed publikacją', async () => {
    const user = await createUser();
    const listing = await completeDraft(user, { categoryId: await categoryId('militaria') });
    const response = await publish(user, listing.id);
    expect(response.json()).toMatchObject({
      status: 'PENDING_REVIEW',
      reviewReasons: ['RESTRICTED_CATEGORY'],
    });
  });

  it('kategoria narażona na podróbki: 4 zdjęcia, marka i wymagane atrybuty', async () => {
    const user = await createUser();
    const listing = await completeDraft(user, { categoryId: await categoryId('sneakersy') });
    expect(errorPaths(await publish(user, listing.id))).toEqual([
      'mediaIds',
      'attributes.rozmiarEu',
      'brand',
    ]);
  });
});

describe('po publikacji', () => {
  it('edycja bez ofert: pełna walidacja, event AuctionUpdated; z ofertą: AUCTION_HAS_BIDS', async () => {
    const user = await createUser();
    const listing = await published(user);
    const edited = await call('PATCH', `/v1/auctions/${listing.id}`, user, {
      title: 'Wazon ceramiczny, lata 70., sygnowany',
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(await outbox('AuctionUpdated', listing.id)).toHaveLength(1);

    const duration = await call('PATCH', `/v1/auctions/${listing.id}`, user, { durationDays: 3 });
    expect(errorPaths(duration)).toEqual(['durationDays']);
    const invalidPrice = await call('PATCH', `/v1/auctions/${listing.id}`, user, {
      description: 'Zmieniony opis, którego nie powinno być widać w aukcji.',
      buyNowPrice: 2_100,
    });
    expect(errorPaths(invalidPrice)).toEqual(['buyNowPrice']);
    const review = await call('PATCH', `/v1/auctions/${listing.id}`, user, {
      description: 'To jest replika wazonu, wykonana ręcznie w pracowni.',
    });
    expect(errorPaths(review)).toEqual(['description']);
    expect((await call('GET', `/v1/me/auctions/${listing.id}`, user)).json()).toMatchObject({
      description: 'Ręcznie malowany wazon, bez pęknięć i odprysków. Wysokość 30 cm.',
      buyNowPrice: null,
    });

    await pool.query('update auctions set bid_count = 1 where id = $1', [listing.id]);
    for (const patch of [
      { startPrice: 1_000 },
      { description: 'Inny opis przedmiotu na aukcji.' },
      { mediaIds: [] },
    ]) {
      const response = await call('PATCH', `/v1/auctions/${listing.id}`, user, patch);
      expect(response.statusCode).toBe(409);
      expect(problemOf(response).code).toBe('AUCTION_HAS_BIDS');
    }
    expect((await call('GET', `/v1/me/auctions/${listing.id}`, user)).json()).toMatchObject({
      editable: false,
    });
  });

  it('anulowanie: bez ofert zawsze, z ofertami nie w ostatnich 12 h; event z liczbą ofert', async () => {
    const user = await createUser();
    const free = await published(user);
    const cancelled = await call('POST', `/v1/auctions/${free.id}/cancel`, user);
    expect(cancelled.json()).toMatchObject({ status: 'CANCELLED', editable: false });
    expect(await outbox('AuctionCancelled', free.id)).toEqual([
      { sellerId: user.id, bidCount: 0, previousStatus: 'ACTIVE', cancelledBy: 'SELLER' },
    ]);
    expect((await call('POST', `/v1/auctions/${free.id}/cancel`, user)).statusCode).toBe(409);

    const late = await published(user);
    await pool.query(
      `update auctions set bid_count = 2, ends_at = now() + interval '6 hours' where id = $1`,
      [late.id],
    );
    const tooLate = await call('POST', `/v1/auctions/${late.id}/cancel`, user);
    expect(problemOf(tooLate).code).toBe('AUCTION_CANCEL_TOO_LATE');

    await pool.query(`update auctions set ends_at = now() + interval '13 hours' where id = $1`, [
      late.id,
    ]);
    expect((await call('POST', `/v1/auctions/${late.id}/cancel`, user)).statusCode).toBe(200);
    expect(await outbox('AuctionCancelled', late.id)).toEqual([
      expect.objectContaining({ bidCount: 2 }),
    ]);
  });

  it('ponowne wystawienie: szkic z kopią przedmiotu i cen; zdjęcia wspólne zostają przypisane', async () => {
    const user = await createUser();
    const original = await published(user, { buyNowPrice: 3_000 });
    expect((await call('POST', `/v1/auctions/${original.id}/relist`, user)).statusCode).toBe(409);
    await call('POST', `/v1/auctions/${original.id}/cancel`, user);

    const relisted = await call('POST', `/v1/auctions/${original.id}/relist`, user);
    expect(relisted.statusCode, relisted.body).toBe(201);
    const copy = relisted.json<Listing>();
    expect(copy).toMatchObject({
      status: 'DRAFT',
      title: original.title,
      description: original.description,
      startPrice: 2_000,
      buyNowPrice: 3_000,
      durationDays: 7,
      photos: original.photos.map((entry) => expect.objectContaining({ id: entry.id }) as unknown),
    });
    expect(copy.id).not.toBe(original.id);

    // Zdjęcie usunięte z kopii nadal jest w zakończonej aukcji: nie wraca do sprzątania.
    const [kept, removed] = copy.photos.map((entry) => entry.id);
    await call('PATCH', `/v1/auctions/${copy.id}`, user, { mediaIds: [kept] });
    expect(await attachedAt(removed ?? '')).not.toBeNull();
    expect((await call('GET', `/v1/me/auctions/${original.id}`, user)).json()).toMatchObject({
      photos: original.photos.map((entry) => expect.objectContaining({ id: entry.id }) as unknown),
    });
  });
});

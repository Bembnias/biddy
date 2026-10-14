// Kryteria F-12 na prawdziwym Postgresie, Redisie i magazynie S3 (RustFS w Testcontainers):
// presigned PUT, przetwarzanie w workerze bez EXIF i GPS, odrzucenia, moderacja (prywatność,
// event), właściciel, limit, zdjęcie profilowe i sprzątanie nieużytych zdjęć.
import type { LightMyRequestResponse } from 'fastify';
import { Pool } from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MediaService } from '../../src/modules/media/index.js';
import { integrationConfig, problemOf, startTestApp, type TestApp } from './support/app.js';
import type { ScratchDatabase } from './support/database.js';
import { MEDIA_BUCKET, UPLOADS_BUCKET, type TestS3, startS3 } from './support/s3.js';
import {
  type TestWorker,
  createMigratedDatabase,
  redisUrl,
  startTestWorker,
  uniqueQueuePrefix,
  waitFor,
  workerConfig,
} from './support/worker.js';

const WEB = 'http://localhost:3000';
const TURNSTILE_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
/** Szerokość geograficzna 52°13'0" w EXIF (trzy ułamki RATIONAL, big-endian). */
const GPS_LATITUDE = Buffer.from([0, 0, 0, 52, 0, 0, 0, 1, 0, 0, 0, 13, 0, 0, 0, 1]);

let database: ScratchDatabase;
let pool: Pool;
let s3: TestS3;
let api: TestApp;
let worker: TestWorker;
let clientIp = '192.0.2.10';
let ipCounter = 10;

beforeEach(() => {
  ipCounter += 1;
  clientIp = `192.0.2.${String(ipCounter)}`;
});

beforeAll(async () => {
  [database, s3] = await Promise.all([createMigratedDatabase(), startS3()]);
  pool = new Pool({ connectionString: database.url, max: 2 });
  const shared = {
    DATABASE_URL: database.url,
    REDIS_QUEUE_URL: redisUrl(),
    QUEUE_PREFIX: uniqueQueuePrefix(),
    ...s3.env,
  };
  api = await startTestApp(integrationConfig({ ...shared, TRUST_PROXY: 'loopback' }));
  worker = await startTestWorker(workerConfig(database.url, shared));
}, 120_000);

afterAll(async () => {
  await worker.close();
  await api.close();
  await pool.end();
  await s3.stop();
  await database.drop();
});

function call(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  options: { body?: Record<string, unknown>; cookie?: string } = {},
): Promise<LightMyRequestResponse> {
  return api.http.inject({
    method,
    url,
    headers: {
      'x-forwarded-for': clientIp,
      origin: WEB,
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
    },
    ...(options.body === undefined ? {} : { payload: options.body }),
  });
}

interface TestUser {
  readonly id: string;
  readonly cookie: string;
}

async function createUser(): Promise<TestUser> {
  const email = `media-${Math.random().toString(36).slice(2, 10)}@example.com`;
  const response = await api.http.inject({
    method: 'POST',
    url: '/v1/auth/sign-up/email',
    headers: { origin: WEB, 'x-forwarded-for': clientIp, 'x-turnstile-token': TURNSTILE_TOKEN },
    payload: {
      name: 'Zofia Zdjęcie',
      email,
      password: 'bardzo-tajne-haslo-1',
      acceptTerms: true,
      adultDeclaration: true,
      callbackURL: `${WEB}/weryfikacja-email`,
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  const setCookie = response.headers['set-cookie'];
  const cookies = (Array.isArray(setCookie) ? setCookie : [setCookie ?? '']).map(
    (cookie) => cookie.split(';')[0],
  );
  const { rows } = await pool.query<{ id: string }>('select id from users where email = $1', [
    email,
  ]);
  return { id: rows[0]?.id ?? '', cookie: cookies.join('; ') };
}

async function photo(
  options: { width?: number; height?: number; color?: string; gps?: boolean } = {},
): Promise<Buffer> {
  const image = sharp({
    create: {
      width: options.width ?? 1200,
      height: options.height ?? 900,
      channels: 3,
      background: options.color ?? '#1e78c8',
    },
  }).jpeg();
  return options.gps === false
    ? image.toBuffer()
    : image
        .withMetadata({ orientation: 1 })
        .withExifMerge({
          IFD0: { Make: 'Aparat', Model: 'Telefon Testowy' },
          IFD3: {
            GPSLatitudeRef: 'N',
            GPSLatitude: '52/1 13/1 0/1',
            GPSLongitudeRef: 'E',
            GPSLongitude: '21/1 0/1 0/1',
          },
        })
        .toBuffer();
}

interface MediaBody {
  id: string;
  status: string;
  urls: Record<string, string> | null;
  rejectionReason: string | null;
  width: number | null;
}

interface UploadBody {
  media: MediaBody;
  upload: { url: string; method: string; headers: Record<string, string> };
}

async function requestUpload(
  user: TestUser,
  file: Buffer,
  options: { purpose?: string; contentType?: string } = {},
): Promise<UploadBody> {
  const response = await call('POST', '/v1/media/uploads', {
    cookie: user.cookie,
    body: {
      purpose: options.purpose ?? 'ITEM_PHOTO',
      contentType: options.contentType ?? 'image/jpeg',
      sizeBytes: file.length,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<UploadBody>();
}

/** Upload przez presigned PUT i potwierdzenie; czeka na koniec przetwarzania. */
async function upload(
  user: TestUser,
  file: Buffer,
  options: { purpose?: string; contentType?: string } = {},
): Promise<MediaBody> {
  const { media, upload: target } = await requestUpload(user, file, options);
  const put = await fetch(target.url, { method: 'PUT', headers: target.headers, body: file });
  expect(put.status, await put.text()).toBe(200);
  const completed = await call('POST', `/v1/media/${media.id}/complete`, { cookie: user.cookie });
  expect(completed.statusCode, completed.body).toBe(202);
  return waitFor(
    async () => {
      const current = (
        await call('GET', `/v1/media/${media.id}`, { cookie: user.cookie })
      ).json<MediaBody>();
      return current.status === 'PROCESSING' ? undefined : current;
    },
    `przetworzenie zdjęcia ${media.id}`,
    30_000,
  );
}

describe('upload i przetwarzanie', () => {
  it('presigned PUT → worker → publiczne warianty WebP bez EXIF i GPS; oryginał usunięty', async () => {
    const user = await createUser();
    const input = await photo();
    expect(input.includes(GPS_LATITUDE)).toBe(true);

    const media = await upload(user, input);
    expect(media).toMatchObject({ status: 'READY', width: 1200, rejectionReason: null });
    expect(Object.keys(media.urls ?? {}).sort()).toEqual(['large', 'medium', 'thumb']);

    for (const url of Object.values(media.urls ?? {})) {
      // Anonimowo: kubełek media jest publiczny.
      const response = await fetch(url);
      expect(response.status, url).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/webp');
      expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      const body = Buffer.from(await response.arrayBuffer());
      const metadata = await sharp(body).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(body.includes(GPS_LATITUDE)).toBe(false);
      expect(body.includes(Buffer.from('Telefon Testowy'))).toBe(false);
    }
    expect(await s3.exists(UPLOADS_BUCKET, `incoming/${user.id}/${media.id}`)).toBe(false);
  });

  it('zły typ i za duży plik: odrzucone przed uploadem; większy plik niż podpisany: magazyn odrzuca', async () => {
    const user = await createUser();
    const gif = await call('POST', '/v1/media/uploads', {
      cookie: user.cookie,
      body: { purpose: 'ITEM_PHOTO', contentType: 'image/gif', sizeBytes: 1000 },
    });
    expect(gif.statusCode).toBe(400);
    expect(problemOf(gif).errors?.[0]?.message).toBe('Dodaj zdjęcie JPEG, PNG albo WebP.');

    const tooBig = await call('POST', '/v1/media/uploads', {
      cookie: user.cookie,
      body: { purpose: 'ITEM_PHOTO', contentType: 'image/jpeg', sizeBytes: 16 * 1024 * 1024 },
    });
    expect(tooBig.statusCode).toBe(400);
    expect(problemOf(tooBig).errors?.[0]?.message).toBe('Zdjęcie jest za duże: maksymalnie 15 MB.');

    const declared = Buffer.alloc(1000, 1);
    const { upload: target } = await requestUpload(user, declared);
    const bigger = await fetch(target.url, {
      method: 'PUT',
      headers: target.headers,
      body: Buffer.alloc(5000, 1),
    });
    expect(bigger.ok).toBe(false);
  });

  it('potwierdzenie bez wysłanego pliku: 409 MEDIA_NOT_UPLOADED', async () => {
    const user = await createUser();
    const { media } = await requestUpload(user, await photo());
    const response = await call('POST', `/v1/media/${media.id}/complete`, { cookie: user.cookie });
    expect(response.statusCode).toBe(409);
    expect(problemOf(response).code).toBe('MEDIA_NOT_UPLOADED');
  });

  it('plik, który nie jest obrazem: REJECTED z powodem po polsku', async () => {
    const user = await createUser();
    const media = await upload(user, Buffer.from('to nie jest zdjęcie, tylko tekst'));
    expect(media).toMatchObject({
      status: 'REJECTED',
      urls: null,
      rejectionReason: 'Plik nie jest obsługiwanym zdjęciem (JPEG, PNG albo WebP).',
    });
  });
});

describe('moderacja', () => {
  it('zdjęcie oznaczone: niepubliczne, kopia w kwarantannie, event MediaFlagged w outboxie', async () => {
    const user = await createUser();
    const media = await upload(user, await photo({ color: '#ff0000', gps: false }));
    expect(media).toMatchObject({ status: 'FLAGGED', urls: null });

    for (const variant of ['thumb', 'medium', 'large']) {
      expect(await s3.exists(MEDIA_BUCKET, `items/${media.id}/${variant}.webp`)).toBe(false);
    }
    expect(await s3.exists(UPLOADS_BUCKET, `quarantine/${media.id}.webp`)).toBe(true);
    const anonymous = await fetch(`${s3.endpoint}/${UPLOADS_BUCKET}/quarantine/${media.id}.webp`);
    expect(anonymous.ok).toBe(false);

    const { rows } = await pool.query<{ payload: { labels: string[]; ownerId: string } }>(
      `select payload from outbox where type = 'MediaFlagged' and aggregate_id = $1`,
      [media.id],
    );
    expect(rows[0]?.payload).toMatchObject({ ownerId: user.id, labels: ['test-red'] });
  });
});

describe('właściciel, limit i usuwanie', () => {
  it('cudze zdjęcie: 404; własne nieużyte: usunięcie razem z plikami', async () => {
    const owner = await createUser();
    const other = await createUser();
    const media = await upload(owner, await photo({ gps: false }));
    expect((await call('GET', `/v1/media/${media.id}`, { cookie: other.cookie })).statusCode).toBe(
      404,
    );
    expect(
      (await call('DELETE', `/v1/media/${media.id}`, { cookie: other.cookie })).statusCode,
    ).toBe(404);

    expect(
      (await call('DELETE', `/v1/media/${media.id}`, { cookie: owner.cookie })).statusCode,
    ).toBe(204);
    expect(await s3.exists(MEDIA_BUCKET, `items/${media.id}/large.webp`)).toBe(false);
  });

  it('limit 50 zdjęć na godzinę: 429', async () => {
    const user = await createUser();
    await pool.query(
      `insert into media (id, owner_id, purpose, content_type, size_bytes)
       select gen_random_uuid(), $1, 'ITEM_PHOTO', 'image/jpeg', 1000 from generate_series(1, 50)`,
      [user.id],
    );
    const response = await call('POST', '/v1/media/uploads', {
      cookie: user.cookie,
      body: { purpose: 'ITEM_PHOTO', contentType: 'image/jpeg', sizeBytes: 1000 },
    });
    expect(response.statusCode).toBe(429);
    expect(problemOf(response).code).toBe('RATE_LIMITED');
  });
});

describe('zdjęcie profilowe', () => {
  it('ustawienie, zmiana (poprzednie zwolnione) i usunięcie; widoczne w profilu publicznym', async () => {
    const user = await createUser();
    const first = await upload(user, await photo({ width: 400, height: 400, gps: false }), {
      purpose: 'AVATAR',
    });
    expect(Object.keys(first.urls ?? {}).sort()).toEqual(['large', 'small']);

    const set = await call('PUT', '/v1/me/avatar', {
      cookie: user.cookie,
      body: { mediaId: first.id },
    });
    expect(set.statusCode, set.body).toBe(200);
    const avatarUrl = set.json<{ avatarUrl: string }>().avatarUrl;
    expect(avatarUrl).toBe(first.urls?.['large']);
    expect((await call('GET', '/v1/me', { cookie: user.cookie })).json()).toMatchObject({
      avatarUrl,
    });
    expect((await call('GET', `/v1/users/${user.id}`)).json()).toMatchObject({ avatarUrl });
    expect(
      (await call('DELETE', `/v1/media/${first.id}`, { cookie: user.cookie })).statusCode,
    ).toBe(409);

    const second = await upload(user, await photo({ width: 300, height: 300, gps: false }), {
      purpose: 'AVATAR',
    });
    await call('PUT', '/v1/me/avatar', { cookie: user.cookie, body: { mediaId: second.id } });
    const { rows } = await pool.query<{ id: string; attached: boolean }>(
      'select id, attached_at is not null as attached from media where id = any($1)',
      [[first.id, second.id]],
    );
    expect(Object.fromEntries(rows.map((row) => [row.id, row.attached]))).toEqual({
      [first.id]: false,
      [second.id]: true,
    });

    expect((await call('DELETE', '/v1/me/avatar', { cookie: user.cookie })).statusCode).toBe(204);
    expect((await call('GET', '/v1/me', { cookie: user.cookie })).json()).toMatchObject({
      avatarUrl: null,
    });
  });

  it('zdjęcie przedmiotu, cudze albo nieprzetworzone nie może być zdjęciem profilowym', async () => {
    const user = await createUser();
    const item = await upload(user, await photo({ gps: false }));
    const response = await call('PUT', '/v1/me/avatar', {
      cookie: user.cookie,
      body: { mediaId: item.id },
    });
    expect(response.statusCode).toBe(400);
    expect(problemOf(response).code).toBe('VALIDATION_FAILED');
  });
});

describe('sprzątanie', () => {
  it('usuwa nieprzypisane zdjęcia starsze niż doba; zatrzymane przez moderację czekają 30 dni', async () => {
    const user = await createUser();
    const old = await upload(user, await photo({ gps: false }));
    const flagged = await upload(user, await photo({ color: '#ff0000', gps: false }));
    const fresh = await upload(user, await photo({ gps: false }));
    await pool.query(
      `update media set created_at = now() - interval '25 hours' where id = any($1)`,
      [[old.id, flagged.id]],
    );

    expect(await api.app.get(MediaService).cleanup()).toBeGreaterThanOrEqual(1);
    const { rows } = await pool.query<{ id: string }>('select id from media where id = any($1)', [
      [old.id, flagged.id, fresh.id],
    ]);
    expect(rows.map((row) => row.id).sort()).toEqual([flagged.id, fresh.id].sort());
    expect(await s3.exists(MEDIA_BUCKET, `items/${old.id}/large.webp`)).toBe(false);
    expect(await s3.exists(MEDIA_BUCKET, `items/${fresh.id}/large.webp`)).toBe(true);
  });
});

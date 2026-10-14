// Kryteria F-10 na prawdziwym Postgresie (Testcontainers): zmiana imienia z regułami Biddy,
// blokada /v1/auth/update-user i pola image przy rejestracji, profil publiczny bez danych
// kontaktowych, adresy (CRUD, domyślne flagi także równolegle, limit, cudzy adres).
import type { LightMyRequestResponse } from 'fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AddressService } from '../../src/modules/identity/index.js';
import { integrationConfig, problemOf, startTestApp, type TestApp } from './support/app.js';
import type { ScratchDatabase } from './support/database.js';
import { createMigratedDatabase, redisUrl, uniqueQueuePrefix } from './support/worker.js';

const WEB = 'http://localhost:3000';
const TURNSTILE_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const ADDRESSES = '/v1/me/addresses';

let database: ScratchDatabase;
let pool: Pool;
let api: TestApp;
let clientIp = '192.0.2.1';
let ipCounter = 1;

beforeEach(() => {
  ipCounter += 1;
  clientIp = `192.0.2.${ipCounter}`;
});

beforeAll(async () => {
  database = await createMigratedDatabase();
  pool = new Pool({ connectionString: database.url, max: 2 });
  api = await startTestApp(
    integrationConfig({
      DATABASE_URL: database.url,
      REDIS_QUEUE_URL: redisUrl(),
      QUEUE_PREFIX: uniqueQueuePrefix(),
      TRUST_PROXY: 'loopback',
    }),
  );
});

afterAll(async () => {
  await api.close();
  await pool.end();
  await database.drop();
});

function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  options: {
    body?: Record<string, unknown>;
    cookie?: string;
    origin?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<LightMyRequestResponse> {
  return api.http.inject({
    method,
    url,
    headers: {
      'x-forwarded-for': clientIp,
      origin: options.origin ?? WEB,
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { payload: options.body }),
  });
}

function cookiesOf(response: LightMyRequestResponse): string {
  const setCookie = response.headers['set-cookie'];
  const list = Array.isArray(setCookie) ? setCookie : setCookie === undefined ? [] : [setCookie];
  return list.map((cookie) => cookie.split(';')[0]).join('; ');
}

function signUpBody(extra: Record<string, unknown> = {}) {
  return {
    name: 'Ola Profil',
    email: `profil-${Math.random().toString(36).slice(2, 10)}@example.com`,
    password: 'bardzo-tajne-haslo-1',
    acceptTerms: true,
    adultDeclaration: true,
    callbackURL: `${WEB}/weryfikacja-email`,
    ...extra,
  };
}

function signUp(extra: Record<string, unknown> = {}) {
  return call('POST', '/v1/auth/sign-up/email', {
    body: signUpBody(extra),
    headers: { 'x-turnstile-token': TURNSTILE_TOKEN },
  });
}

interface TestUser {
  readonly id: string;
  readonly cookie: string;
  readonly email: string;
}

async function createUser(): Promise<TestUser> {
  const body = signUpBody();
  const response = await call('POST', '/v1/auth/sign-up/email', {
    body,
    headers: { 'x-turnstile-token': TURNSTILE_TOKEN },
  });
  expect(response.statusCode, response.body).toBe(200);
  const { rows } = await pool.query<{ id: string }>('select id from users where email = $1', [
    body.email,
  ]);
  return { id: rows[0]?.id ?? '', cookie: cookiesOf(response), email: body.email };
}

const ADDRESS = {
  recipientName: 'Ola Profil',
  street: 'ul. Marszałkowska 1/2',
  postalCode: '00950',
  city: 'Warszawa',
  phone: '500 600 700',
};

interface AddressBody {
  id: string;
  postalCode: string;
  phone: string;
  isDefault: boolean;
  isSenderDefault: boolean;
}

async function addAddress(user: TestUser, extra: Record<string, unknown> = {}) {
  const response = await call('POST', ADDRESSES, {
    cookie: user.cookie,
    body: { ...ADDRESS, ...extra },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<AddressBody>();
}

async function listAddresses(user: TestUser): Promise<AddressBody[]> {
  return (await call('GET', ADDRESSES, { cookie: user.cookie })).json<AddressBody[]>();
}

describe('profil: imię wyświetlane', () => {
  it('PATCH /v1/me zapisuje znormalizowane imię i zwraca konto', async () => {
    const user = await createUser();
    const response = await call('PATCH', '/v1/me', {
      cookie: user.cookie,
      body: { name: '  Ola   Nowa  ' },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ id: user.id, name: 'Ola Nowa' });
    expect((await call('GET', '/v1/me', { cookie: user.cookie })).json()).toMatchObject({
      name: 'Ola Nowa',
    });
  });

  it.each([
    ['numer telefonu', 'Ola 500 600 700', 'nie może zawierać numeru telefonu'],
    ['adres strony', 'Ola www.sklep', 'nie może zawierać numeru telefonu'],
    ['za krótkie', 'O', 'od 2 do 60 znaków'],
    ['znaki specjalne', 'Ola <3', 'może zawierać litery'],
  ])('odrzuca imię: %s', async (_label, name, message) => {
    const user = await createUser();
    const response = await call('PATCH', '/v1/me', { cookie: user.cookie, body: { name } });
    expect(response.statusCode).toBe(400);
    const problem = problemOf(response);
    expect(problem.code).toBe('VALIDATION_FAILED');
    expect(problem.errors?.[0]).toMatchObject({ path: 'name' });
    expect(problem.errors?.[0]?.message).toContain(message);
  });

  it('bez sesji 401, z obcego Origin 403 (CSRF)', async () => {
    expect((await call('PATCH', '/v1/me', { body: { name: 'Ola Nowa' } })).statusCode).toBe(401);
    const user = await createUser();
    const foreign = await call('PATCH', '/v1/me', {
      cookie: user.cookie,
      origin: 'https://zla-strona.example',
      body: { name: 'Ola Nowa' },
    });
    expect(foreign.statusCode).toBe(403);
  });

  it('Better Auth: /update-user zablokowane, rejestracja odrzuca image i imię z kontaktem', async () => {
    const user = await createUser();
    const update = await call('POST', '/v1/auth/update-user', {
      cookie: user.cookie,
      body: { name: 'Ola 500600700', image: 'https://zla-strona.example/a.png' },
    });
    expect(update.statusCode).toBe(403);
    expect(problemOf(update).code).toBe('FORBIDDEN');
    const { rows } = await pool.query<{ name: string; image: string | null }>(
      'select name, image from users where id = $1',
      [user.id],
    );
    expect(rows[0]).toEqual({ name: 'Ola Profil', image: null });

    const withImage = await signUp({ image: 'https://zla-strona.example/a.png' });
    expect(withImage.statusCode).toBe(400);
    expect(problemOf(withImage).code).toBe('VALIDATION_FAILED');

    const withPhone = await signUp({ name: 'Jan 500600700' });
    expect(withPhone.statusCode).toBe(400);
    expect(problemOf(withPhone).detail).toBe(
      'Imię wyświetlane nie może zawierać numeru telefonu ani adresu strony.',
    );
  });
});

describe('profil publiczny', () => {
  it('tylko imię, data dołączenia i znaczek telefonu; bez e-maila, telefonu i adresów', async () => {
    const user = await createUser();
    await addAddress(user);
    await pool.query(
      `update users set phone_number = '+48500600711', phone_number_verified_at = now() where id = $1`,
      [user.id],
    );

    const response = await call('GET', `/v1/users/${user.id}`);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    const body = response.json<Record<string, unknown>>();
    expect(Object.keys(body).sort()).toEqual(['id', 'memberSince', 'name', 'phoneVerified']);
    expect(body).toMatchObject({ id: user.id, name: 'Ola Profil', phoneVerified: true });
    for (const secret of [user.email, '500600711', '500 600 700', 'Marszałkowska', '00-950']) {
      expect(response.body).not.toContain(secret);
    }
  });

  it('zablokowane, nieznane i błędne identyfikatory: 404', async () => {
    const user = await createUser();
    await pool.query(`update users set status = 'BANNED' where id = $1`, [user.id]);
    for (const id of [user.id, '01960000-0000-7000-8000-000000000999', 'nie-uuid']) {
      const response = await call('GET', `/v1/users/${id}`);
      expect(response.statusCode, id).toBe(404);
      expect(problemOf(response).code).toBe('NOT_FOUND');
    }
  });
});

describe('adresy', () => {
  it('pierwszy adres jest domyślny do dostawy i nadania; kod i telefon w postaci zapisu', async () => {
    const user = await createUser();
    const first = await addAddress(user);
    expect(first).toMatchObject({
      postalCode: '00-950',
      phone: '+48500600700',
      isDefault: true,
      isSenderDefault: true,
    });

    const second = await addAddress(user, { street: 'ul. Długa 5', isDefault: true });
    expect(second).toMatchObject({ isDefault: true, isSenderDefault: false });
    const list = await listAddresses(user);
    expect(list.map((address) => [address.id, address.isDefault, address.isSenderDefault])).toEqual(
      [
        [second.id, true, false],
        [first.id, false, true],
      ],
    );

    const sender = await call('PATCH', `${ADDRESSES}/${second.id}`, {
      cookie: user.cookie,
      body: { isSenderDefault: true, city: 'Kraków', postalCode: '31-042' },
    });
    expect(sender.json()).toMatchObject({
      city: 'Kraków',
      postalCode: '31-042',
      isSenderDefault: true,
    });
    expect((await listAddresses(user)).filter((address) => address.isSenderDefault)).toHaveLength(
      1,
    );
    expect((await api.app.get(AddressService).defaultSenderAddress(user.id))?.id).toBe(second.id);
  });

  it('walidacja po polsku: kod pocztowy, telefon, puste pola; flagi tylko true', async () => {
    const user = await createUser();
    const invalid = await call('POST', ADDRESSES, {
      cookie: user.cookie,
      body: { ...ADDRESS, postalCode: '1234', phone: '22 123 45 67', city: '' },
    });
    expect(invalid.statusCode).toBe(400);
    const errors = problemOf(invalid).errors ?? [];
    expect(Object.fromEntries(errors.map((error) => [error.path, error.message]))).toMatchObject({
      postalCode: 'Podaj kod pocztowy w formacie 00-000.',
      phone: 'Podaj polski numer komórkowy, np. 500 600 700.',
      city: 'Miasto: co najmniej 2 znaki.',
    });

    const address = await addAddress(user);
    const unset = await call('PATCH', `${ADDRESSES}/${address.id}`, {
      cookie: user.cookie,
      body: { isDefault: false },
    });
    expect(unset.statusCode).toBe(400);
  });

  it('usunięcie domyślnego adresu nie wybiera nowego; cudzy adres to 404', async () => {
    const owner = await createUser();
    const other = await createUser();
    const first = await addAddress(owner);
    const second = await addAddress(owner);

    for (const [method, body] of [
      ['PATCH', { city: 'Gdańsk' }],
      ['DELETE', undefined],
    ] as const) {
      const response = await call(method, `${ADDRESSES}/${first.id}`, {
        cookie: other.cookie,
        ...(body === undefined ? {} : { body }),
      });
      expect(response.statusCode, method).toBe(404);
    }

    expect(
      (await call('DELETE', `${ADDRESSES}/${first.id}`, { cookie: owner.cookie })).statusCode,
    ).toBe(204);
    const left = await listAddresses(owner);
    expect(left.map((address) => [address.id, address.isDefault, address.isSenderDefault])).toEqual(
      [[second.id, false, false]],
    );
    expect(
      (await call('DELETE', `${ADDRESSES}/${first.id}`, { cookie: owner.cookie })).statusCode,
    ).toBe(404);
  });

  it('limit 10 adresów (także przy równoległych żądaniach)', async () => {
    const user = await createUser();
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        call('POST', ADDRESSES, { cookie: user.cookie, body: ADDRESS }),
      ),
    );
    expect(results.filter((response) => response.statusCode === 201)).toHaveLength(10);
    const rejected = results.filter((response) => response.statusCode !== 201);
    expect(rejected.map((response) => problemOf(response).code)).toEqual([
      'ADDRESS_LIMIT_REACHED',
      'ADDRESS_LIMIT_REACHED',
    ]);
    expect(await listAddresses(user)).toHaveLength(10);
  });

  it('równoległe ustawianie domyślnego: dokładnie jeden domyślny adres', async () => {
    const user = await createUser();
    const created = [];
    for (let index = 0; index < 5; index += 1) {
      created.push(await addAddress(user));
    }
    const responses = await Promise.all(
      created.map((address) =>
        call('PATCH', `${ADDRESSES}/${address.id}`, {
          cookie: user.cookie,
          body: { isDefault: true, isSenderDefault: true },
        }),
      ),
    );
    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    const list = await listAddresses(user);
    expect(list.filter((address) => address.isDefault)).toHaveLength(1);
    expect(list.filter((address) => address.isSenderDefault)).toHaveLength(1);
  });
});

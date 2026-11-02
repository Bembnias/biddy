// Kryteria F-07 na prawdziwym Postgresie i Redisie (Testcontainers): rejestracja z regulaminem
// i 18+, e-mail weryfikacyjny w kolejce, @RequireVerifiedEmail, logowanie z licznikiem porażek
// i Turnstile, sesja w ciasteczku i Bearer, CSRF, wylogowanie ze wszystkich urządzeń, reset
// hasła, konta testowe z seeda.
import { LEGAL_DOCUMENT_VERSIONS } from '@biddy/shared';
import { Controller, Module, Post } from '@nestjs/common';
import type { LightMyRequestResponse } from 'fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { JobQueues } from '../../src/infra/queues/index.js';
import {
  CurrentUser,
  RequireVerifiedEmail,
  TEST_USERS,
  TEST_USER_PASSWORD,
  type AuthenticatedUser,
  seedTestUsers,
} from '../../src/modules/identity/index.js';
import { integrationConfig, problemOf, startTestApp, type TestApp } from './support/app.js';
import type { ScratchDatabase } from './support/database.js';
import { createMigratedDatabase, redisUrl, uniqueQueuePrefix } from './support/worker.js';

/** Trasa jak licytowanie (F-15): wymaga potwierdzonego e-maila. */
@Controller('integration-test/bids')
class VerifiedOnlyController {
  @Post()
  @RequireVerifiedEmail()
  guardedBid(@CurrentUser() user: AuthenticatedUser): { userId: string } {
    return { userId: user.id };
  }
}

@Module({ controllers: [VerifiedOnlyController] })
class VerifiedOnlyModule {}

const WEB = 'http://localhost:3000';
/** Token z widżetu dla klucza testowego Cloudflare (zawsze przechodzi). */
const TURNSTILE_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const PASSWORD = 'bardzo-tajne-haslo-1';

let database: ScratchDatabase;
let pool: Pool;
let api: TestApp;
/** Adres klienta bieżącego testu (nowy w każdym teście). */
let clientIp = '203.0.113.1';
let ipCounter = 1;

beforeEach(() => {
  ipCounter += 1;
  clientIp = `203.0.113.${ipCounter}`;
});

beforeAll(async () => {
  database = await createMigratedDatabase();
  pool = new Pool({ connectionString: database.url, max: 2 });
  api = await startTestApp(
    integrationConfig({
      DATABASE_URL: database.url,
      REDIS_QUEUE_URL: redisUrl(),
      QUEUE_PREFIX: uniqueQueuePrefix(),
      // Każdy test ma własny adres klienta (X-Forwarded-For), żeby liczniki porażek per IP
      // z jednego testu nie wpływały na inne.
      TRUST_PROXY: 'loopback',
    }),
    [VerifiedOnlyModule],
  );
});

afterAll(async () => {
  await api.close();
  await pool.end();
  await database.drop();
});

interface RequestOptions {
  readonly body?: Record<string, unknown>;
  readonly cookie?: string;
  readonly origin?: string | null;
  readonly headers?: Record<string, string>;
}

function call(
  method: 'GET' | 'POST',
  url: string,
  { body, cookie, origin = WEB, headers = {} }: RequestOptions = {},
): Promise<LightMyRequestResponse> {
  return api.http.inject({
    method,
    url,
    headers: {
      'x-forwarded-for': clientIp,
      ...(origin === null ? {} : { origin }),
      ...(cookie === undefined ? {} : { cookie }),
      ...headers,
    },
    ...(body === undefined ? {} : { payload: body }),
  });
}

/** Ciasteczka z odpowiedzi jako nagłówek Cookie dla kolejnych żądań. */
function cookiesOf(response: LightMyRequestResponse): string {
  const setCookie = response.headers['set-cookie'];
  const list = Array.isArray(setCookie) ? setCookie : setCookie === undefined ? [] : [setCookie];
  return list.map((cookie) => cookie.split(';')[0]).join('; ');
}

function uniqueEmail(label: string): string {
  return `${label}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function signUp(email: string, extra: Record<string, unknown> = {}, token = TURNSTILE_TOKEN) {
  return call('POST', '/v1/auth/sign-up/email', {
    body: {
      name: 'Jan Testowy',
      email,
      password: PASSWORD,
      acceptTerms: true,
      adultDeclaration: true,
      callbackURL: `${WEB}/weryfikacja-email`,
      ...extra,
    },
    headers: token === '' ? {} : { 'x-turnstile-token': token },
  });
}

async function signIn(email: string, password: string, headers: Record<string, string> = {}) {
  return call('POST', '/v1/auth/sign-in/email', { body: { email, password }, headers });
}

/** Link z ostatniego e-maila do adresata (job w kolejce `emails`, bez workera). */
async function lastLinkSentTo(email: string): Promise<URL> {
  const jobs = await api.app.get(JobQueues).queue('emails').getWaiting(0, 500);
  const job = jobs
    .filter((candidate) => (candidate.data as { to: string }).to === email)
    .sort((left, right) => right.timestamp - left.timestamp)[0];
  const text = (job?.data as { text?: string } | undefined)?.text ?? '';
  const match = /https?:\/\/\S+/.exec(text);
  if (match === null) {
    throw new Error(`Brak linku w e-mailu do ${email}`);
  }
  return new URL(match[0]);
}

describe('rejestracja', () => {
  it('zakłada konto, loguje (ciasteczko i token Bearer), zapisuje regulamin z wersją i IP, wysyła link weryfikacyjny', async () => {
    const email = uniqueEmail('rejestracja');
    const response = await signUp(email);

    expect(response.statusCode, response.body).toBe(200);
    expect(cookiesOf(response)).toMatch(/biddy\.session_token=/);
    expect(response.headers['set-auth-token']).toEqual(expect.any(String));

    const { rows: user } = await pool.query<{
      id: string;
      is_adult_declared_at: Date | null;
      email_verified: boolean;
    }>('select id, is_adult_declared_at, email_verified from users where email = $1', [email]);
    expect(user[0]?.email_verified).toBe(false);
    expect(user[0]?.is_adult_declared_at).toBeInstanceOf(Date);
    const { rows: terms } = await pool.query<{ document: string; version: string; ip: string }>(
      'select document, version, ip from terms_acceptances where user_id = $1 order by document',
      [user[0]?.id],
    );
    expect(terms).toEqual([
      { document: 'PRIVACY', version: LEGAL_DOCUMENT_VERSIONS.PRIVACY, ip: clientIp },
      { document: 'TERMS', version: LEGAL_DOCUMENT_VERSIONS.TERMS, ip: clientIp },
    ]);

    const link = await lastLinkSentTo(email);
    expect(link.pathname).toBe('/v1/auth/verify-email');
    expect(link.searchParams.get('callbackURL')).toBe(`${WEB}/weryfikacja-email`);
  });

  it('bez akceptacji regulaminu albo 18+: 400 TERMS_NOT_ACCEPTED (Problem Details), konta nie ma', async () => {
    const email = uniqueEmail('bez-regulaminu');
    for (const extra of [{ acceptTerms: false }, { adultDeclaration: undefined }]) {
      const response = await signUp(email, extra);
      expect(response.statusCode).toBe(400);
      expect(problemOf(response)).toMatchObject({ code: 'TERMS_NOT_ACCEPTED', status: 400 });
    }
    const { rowCount } = await pool.query('select 1 from users where email = $1', [email]);
    expect(rowCount).toBe(0);
  });

  it('bez tokenu Turnstile: 403 CAPTCHA_REQUIRED', async () => {
    const response = await signUp(uniqueEmail('bez-captcha'), {}, '');
    expect(response.statusCode).toBe(403);
    expect(problemOf(response)).toMatchObject({ code: 'CAPTCHA_REQUIRED' });
  });

  it('istniejący e-mail: błąd po polsku jako Problem Details', async () => {
    const email = uniqueEmail('duplikat');
    await signUp(email);
    const response = await signUp(email);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(problemOf(response).detail).toContain('Konto z tym adresem już istnieje');
  });
});

describe('weryfikacja e-maila i @RequireVerifiedEmail', () => {
  it('bez potwierdzenia 403 EMAIL_NOT_VERIFIED, po kliknięciu linku trasa działa', async () => {
    const email = uniqueEmail('weryfikacja');
    const cookie = cookiesOf(await signUp(email));

    const me = await call('GET', '/v1/me', { cookie });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      email,
      emailVerified: false,
      termsAccepted: true,
      staffRole: null,
    });

    const blocked = await call('POST', '/v1/integration-test/bids', { cookie });
    expect(blocked.statusCode).toBe(403);
    expect(problemOf(blocked).code).toBe('EMAIL_NOT_VERIFIED');

    const link = await lastLinkSentTo(email);
    const verified = await call('GET', `${link.pathname}${link.search}`, { origin: null });
    expect(verified.statusCode).toBe(302);
    expect(verified.headers.location).toMatch(new RegExp(`^${WEB}/weryfikacja-email`));

    const allowed = await call('POST', '/v1/integration-test/bids', { cookie });
    expect(allowed.statusCode, allowed.body).toBe(201);
    expect((await call('GET', '/v1/me', { cookie })).json()).toMatchObject({ emailVerified: true });
  });
});

describe('logowanie', () => {
  it('poprawne dane: sesja w ciasteczku; złe hasło: 401 po polsku', async () => {
    const email = uniqueEmail('logowanie');
    await signUp(email);

    const wrong = await signIn(email, 'zle-haslo-123');
    expect(wrong.statusCode).toBe(401);
    expect(problemOf(wrong)).toMatchObject({
      code: 'INVALID_EMAIL_OR_PASSWORD',
      detail: 'Nieprawidłowy e-mail lub hasło.',
    });

    const ok = await signIn(email, PASSWORD);
    expect(ok.statusCode).toBe(200);
    expect((await call('GET', '/v1/me', { cookie: cookiesOf(ok) })).json()).toMatchObject({
      email,
    });
  });

  it('po 5 porażkach na konto: przerwa (429 + Retry-After), potem Turnstile; konto nie jest blokowane', async () => {
    const email = uniqueEmail('porazki');
    await signUp(email);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await signIn(email, 'zle-haslo-123')).statusCode, `próba ${attempt}`).toBe(401);
    }

    const tooSoon = await signIn(email, PASSWORD);
    expect(tooSoon.statusCode).toBe(429);
    expect(problemOf(tooSoon).code).toBe('RATE_LIMITED');
    expect(Number(tooSoon.headers['retry-after'])).toBeGreaterThan(0);

    // Przerwa minęła (zamiast czekać, cofamy czas ostatniej porażki).
    await pool.query(
      `update login_failures set last_failure_at = now() - interval '1 minute' where key = $1`,
      [`email:${email}`],
    );
    const withoutCaptcha = await signIn(email, PASSWORD);
    expect(withoutCaptcha.statusCode).toBe(403);
    expect(problemOf(withoutCaptcha).code).toBe('CAPTCHA_REQUIRED');

    const withCaptcha = await signIn(email, PASSWORD, { 'x-turnstile-token': TURNSTILE_TOKEN });
    expect(withCaptcha.statusCode, withCaptcha.body).toBe(200);
    const { rowCount } = await pool.query('select 1 from login_failures where key = $1', [
      `email:${email}`,
    ]);
    expect(rowCount).toBe(0);
  });

  it('20 porażek z jednego IP na różne konta: Turnstile także dla konta bez porażek', async () => {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      await signIn(uniqueEmail(`ip-${attempt}`), 'zle-haslo-123');
    }
    await pool.query(
      `update login_failures set last_failure_at = now() - interval '1 hour' where key = $1`,
      [`ip:${clientIp}`],
    );
    const email = uniqueEmail('ofiara-ip');
    const response = await signIn(email, 'cokolwiek-123');
    expect(response.statusCode).toBe(403);
    expect(problemOf(response).code).toBe('CAPTCHA_REQUIRED');
  });

  it('token Bearer (mobile) działa bez ciasteczek i bez nagłówka Origin', async () => {
    const email = uniqueEmail('bearer');
    await signUp(email);
    const token = (await signIn(email, PASSWORD)).headers['set-auth-token'];

    const me = await call('GET', '/v1/me', {
      origin: null,
      headers: { authorization: `Bearer ${String(token)}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email });
  });

  it('bez sesji: /v1/me 401 UNAUTHORIZED, /v1/session 200 z user: null', async () => {
    const response = await call('GET', '/v1/me');
    expect(response.statusCode).toBe(401);
    expect(problemOf(response).code).toBe('UNAUTHORIZED');
    const session = await call('GET', '/v1/session');
    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({ user: null });
  });

  it('/v1/session z ciasteczkiem: podstawowe dane użytkownika', async () => {
    const email = uniqueEmail('sesja');
    const cookie = cookiesOf(await signUp(email));
    const session = await call('GET', '/v1/session', { cookie });
    expect(session.json()).toEqual({
      user: {
        id: expect.any(String) as string,
        name: 'Jan Testowy',
        emailVerified: false,
        termsAccepted: true,
        phoneVerified: false,
        avatarUrl: null,
      },
    });
  });
});

describe('CSRF (sesja w ciasteczku)', () => {
  it('żądanie zmieniające stan z obcego Origin: 403; z aplikacji web: 204; Bearer bez ciasteczek: 204', async () => {
    const email = uniqueEmail('csrf');
    const signedUp = await signUp(email);
    const cookie = cookiesOf(signedUp);

    const body = { adultDeclaration: true };
    const foreign = await call('POST', '/v1/me/terms-acceptances', {
      body,
      cookie,
      origin: 'https://zla-strona.example',
    });
    expect(foreign.statusCode).toBe(403);
    expect(problemOf(foreign).code).toBe('FORBIDDEN');

    const missingOrigin = await call('POST', '/v1/me/terms-acceptances', {
      body,
      cookie,
      origin: null,
    });
    expect(missingOrigin.statusCode).toBe(403);

    expect((await call('POST', '/v1/me/terms-acceptances', { body, cookie })).statusCode).toBe(204);
    const bearer = await call('POST', '/v1/me/terms-acceptances', {
      body,
      origin: null,
      headers: { authorization: `Bearer ${String(signedUp.headers['set-auth-token'])}` },
    });
    expect(bearer.statusCode).toBe(204);
  });
});

describe('wylogowanie ze wszystkich urządzeń', () => {
  it('unieważnia wszystkie sesje, także tokeny Bearer', async () => {
    const email = uniqueEmail('wszystkie');
    await signUp(email);
    const web = cookiesOf(await signIn(email, PASSWORD));
    const mobileToken = (await signIn(email, PASSWORD)).headers['set-auth-token'];

    const revoked = await call('POST', '/v1/auth/revoke-sessions', { cookie: web, body: {} });
    expect(revoked.statusCode, revoked.body).toBe(200);

    expect((await call('GET', '/v1/me', { cookie: web })).statusCode).toBe(401);
    const mobile = await call('GET', '/v1/me', {
      origin: null,
      headers: { authorization: `Bearer ${String(mobileToken)}` },
    });
    expect(mobile.statusCode).toBe(401);
  });
});

describe('reset hasła', () => {
  it('link z e-maila prowadzi do web, nowe hasło działa, stare sesje i ponowne użycie linku nie', async () => {
    const email = uniqueEmail('reset');
    const oldSession = cookiesOf(await signUp(email));

    const requested = await call('POST', '/v1/auth/request-password-reset', {
      body: { email, redirectTo: `${WEB}/nowe-haslo` },
      headers: { 'x-turnstile-token': TURNSTILE_TOKEN },
    });
    expect(requested.statusCode, requested.body).toBe(200);

    const link = await lastLinkSentTo(email);
    const redirect = await call('GET', `${link.pathname}${link.search}`, { origin: null });
    expect(redirect.statusCode).toBe(302);
    const target = new URL(String(redirect.headers.location));
    expect(`${target.origin}${target.pathname}`).toBe(`${WEB}/nowe-haslo`);
    const token = target.searchParams.get('token') ?? '';

    const reset = await call('POST', '/v1/auth/reset-password', {
      body: { token, newPassword: 'nowe-haslo-12345' },
    });
    expect(reset.statusCode, reset.body).toBe(200);

    expect((await call('GET', '/v1/me', { cookie: oldSession })).statusCode).toBe(401);
    expect((await signIn(email, PASSWORD)).statusCode).toBe(401);
    expect((await signIn(email, 'nowe-haslo-12345')).statusCode).toBe(200);

    const again = await call('POST', '/v1/auth/reset-password', {
      body: { token, newPassword: 'jeszcze-inne-haslo' },
    });
    expect(again.statusCode).toBe(400);
    expect(problemOf(again).code).toBe('INVALID_TOKEN');
  });

  it('nieznany e-mail: ta sama odpowiedź (nie zdradza, czy konto istnieje)', async () => {
    const response = await call('POST', '/v1/auth/request-password-reset', {
      body: { email: uniqueEmail('nie-ma'), redirectTo: `${WEB}/nowe-haslo` },
      headers: { 'x-turnstile-token': TURNSTILE_TOKEN },
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('konta testowe (db:seed) i metody logowania', () => {
  it('seed tworzy kupującego, sprzedającego i admina; drugie uruchomienie niczego nie dubluje', async () => {
    const db = drizzle(pool, { casing: 'snake_case' });
    expect((await seedTestUsers(db)).sort()).toEqual(TEST_USERS.map((user) => user.email).sort());
    expect(await seedTestUsers(db)).toEqual([]);

    const admin = await signIn('admin@biddy.local', TEST_USER_PASSWORD);
    expect(admin.statusCode).toBe(200);
    expect((await call('GET', '/v1/me', { cookie: cookiesOf(admin) })).json()).toMatchObject({
      emailVerified: true,
      termsAccepted: true,
      staffRole: 'admin',
    });
  });

  it('GET /v1/auth-options: klucz testowy Turnstile, bez Google i Apple bez kluczy', async () => {
    const response = await call('GET', '/v1/auth-options');
    expect(response.json()).toEqual({
      socialProviders: [],
      turnstileSiteKey: '1x00000000000000000000AA',
      passwordMinLength: 10,
    });
  });
});

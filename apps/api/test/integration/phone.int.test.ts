// Kryteria F-08 na prawdziwym Postgresie i Redisie (Testcontainers): weryfikacja telefonu kodem
// SMS (atrapa SMS-ów w pamięci), limity prób i wysyłki, 1 numer = 1 konto, @RequireVerifiedPhone,
// oświadczenie 18+ przy akceptacji regulaminu, konta testowe z telefonem.
import { Controller, Module, Post } from '@nestjs/common';
import type { LightMyRequestResponse } from 'fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { LoggingSmsSender, SMS_SENDER } from '../../src/infra/sms/index.js';
import {
  CurrentUser,
  RequireVerifiedPhone,
  TEST_USERS,
  TEST_USER_PASSWORD,
  type AuthenticatedUser,
  seedTestUsers,
} from '../../src/modules/identity/index.js';
import { PhoneVerificationService } from '../../src/modules/identity/phone/phone-verification.service.js';
import { integrationConfig, problemOf, startTestApp, type TestApp } from './support/app.js';
import type { ScratchDatabase } from './support/database.js';
import { createMigratedDatabase, redisUrl, uniqueQueuePrefix } from './support/worker.js';

/** Trasa jak licytowanie (F-15): wymaga konta gotowego do handlu. */
@Controller('integration-test/phone-bids')
class PhoneOnlyController {
  @Post()
  @RequireVerifiedPhone()
  phoneGuardedBid(@CurrentUser() user: AuthenticatedUser): {
    userId: string;
    phoneNumber: string | null;
  } {
    return { userId: user.id, phoneNumber: user.phoneNumber };
  }
}

@Module({ controllers: [PhoneOnlyController] })
class PhoneOnlyModule {}

const WEB = 'http://localhost:3000';
const TURNSTILE_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const START = '/v1/me/phone-verification';
const CONFIRM = '/v1/me/phone-verification/confirm';
const GUARDED = '/v1/integration-test/phone-bids';

let database: ScratchDatabase;
let pool: Pool;
let api: TestApp;
let sms: LoggingSmsSender;
let clientIp = '198.51.100.1';
let ipCounter = 1;

beforeEach(() => {
  ipCounter += 1;
  clientIp = `198.51.100.${ipCounter}`;
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
    [PhoneOnlyModule],
  );
  sms = api.app.get<LoggingSmsSender>(SMS_SENDER);
});

afterAll(async () => {
  await api.close();
  await pool.end();
  await database.drop();
});

function call(
  method: 'GET' | 'POST',
  url: string,
  options: {
    body?: Record<string, unknown>;
    cookie?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<LightMyRequestResponse> {
  return api.http.inject({
    method,
    url,
    headers: {
      'x-forwarded-for': clientIp,
      origin: WEB,
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

/** Losowy polski numer komórkowy (50x xxx xxx) w E.164. */
function randomPhone(): string {
  return `+4850${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`;
}

interface TestUser {
  readonly id: string;
  readonly cookie: string;
}

/** Konto z sesją; domyślnie z potwierdzonym e-mailem i oświadczeniem 18+. */
async function createUser(
  options: { emailVerified?: boolean; adult?: boolean } = {},
): Promise<TestUser> {
  const email = `tel-${Math.random().toString(36).slice(2, 10)}@example.com`;
  const response = await call('POST', '/v1/auth/sign-up/email', {
    body: {
      name: 'Tomasz Telefon',
      email,
      password: 'bardzo-tajne-haslo-1',
      acceptTerms: true,
      adultDeclaration: true,
      callbackURL: `${WEB}/weryfikacja-email`,
    },
    headers: { 'x-turnstile-token': TURNSTILE_TOKEN },
  });
  expect(response.statusCode, response.body).toBe(200);
  const { rows } = await pool.query<{ id: string }>(
    `update users set email_verified = $2,
       is_adult_declared_at = case when $3 then is_adult_declared_at else null end
     where email = $1 returning id`,
    [email, options.emailVerified ?? true, options.adult ?? true],
  );
  return { id: rows[0]?.id ?? '', cookie: cookiesOf(response) };
}

/** Kod z ostatniego SMS-a (atrapa) na numer. */
function lastCodeSentTo(phoneNumber: string): string {
  const text = sms.lastTo(phoneNumber)?.text ?? '';
  const match = /kod weryfikacyjny to (\d{6})/.exec(text);
  if (match?.[1] === undefined) {
    throw new Error(`Brak SMS-a z kodem na ${phoneNumber}`);
  }
  return match[1];
}

function smsCountTo(phoneNumber: string): number {
  return sms.sent.filter((message) => message.to === phoneNumber).length;
}

async function verifyPhone(user: TestUser, phoneNumber: string): Promise<void> {
  expect(
    (await call('POST', START, { cookie: user.cookie, body: { phoneNumber } })).statusCode,
  ).toBe(201);
  const code = lastCodeSentTo(phoneNumber);
  const response = await call('POST', CONFIRM, { cookie: user.cookie, body: { code } });
  expect(response.statusCode, response.body).toBe(200);
}

/** Przesuwa ostatnią wysyłkę konta w przeszłość (ominięcie 60-sekundowego odstępu w testach). */
async function ageLastSend(userId: string, seconds: number): Promise<void> {
  await pool.query(
    `update phone_verifications set created_at = created_at - make_interval(secs => $2)
     where user_id = $1`,
    [userId, seconds],
  );
}

/** Wcześniejsze wysyłki wprost w bazie (limity numeru, IP i konta). */
async function insertSends(
  rows: { userId: string; phoneNumber: string; ip: string; secondsAgo: number }[],
): Promise<void> {
  for (const row of rows) {
    await pool.query(
      `insert into phone_verifications (id, user_id, phone_number, code_hash, ip, expires_at, created_at)
       values (gen_random_uuid(), $1, $2, 'x', $3, now(), now() - make_interval(secs => $4))`,
      [row.userId, row.phoneNumber, row.ip, row.secondsAgo],
    );
  }
}

describe('weryfikacja telefonu', () => {
  it('kod SMS → potwierdzenie → numer w /v1/me i /v1/session, trasa z @RequireVerifiedPhone działa', async () => {
    const user = await createUser();
    const guardedBefore = await call('POST', GUARDED, { cookie: user.cookie });
    expect(guardedBefore.statusCode).toBe(403);
    expect(problemOf(guardedBefore).code).toBe('PHONE_NOT_VERIFIED');

    const national = randomPhone().slice(3);
    const startedAt = Date.now();
    const started = await call('POST', START, {
      cookie: user.cookie,
      body: { phoneNumber: `${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}` },
    });
    expect(started.statusCode, started.body).toBe(201);
    const body = started.json<{
      phoneNumber: string;
      expiresAt: string;
      resendAvailableAt: string;
    }>();
    expect(body.phoneNumber).toBe(`+48${national}`);
    expect(new Date(body.expiresAt).getTime() - startedAt).toBeGreaterThan(4.5 * 60_000);
    expect(new Date(body.resendAvailableAt).getTime() - startedAt).toBeGreaterThan(55_000);

    const text = sms.lastTo(body.phoneNumber)?.text ?? '';
    expect(text).toMatch(/^[\x20-\x7E\n]+$/);
    const code = lastCodeSentTo(body.phoneNumber);
    expect(text.split('\n').at(-1)).toBe(`@localhost #${code}`);
    const { rows } = await pool.query<{ code_hash: string }>(
      'select code_hash from phone_verifications where user_id = $1',
      [user.id],
    );
    expect(rows[0]?.code_hash).toMatch(/^[0-9a-f]{64}$/);

    const confirmed = await call('POST', CONFIRM, { cookie: user.cookie, body: { code } });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json()).toMatchObject({ phoneNumber: body.phoneNumber });

    expect((await call('GET', '/v1/me', { cookie: user.cookie })).json()).toMatchObject({
      phoneNumber: body.phoneNumber,
      phoneVerified: true,
    });
    expect((await call('GET', '/v1/session', { cookie: user.cookie })).json()).toMatchObject({
      user: { phoneVerified: true },
    });
    const guarded = await call('POST', GUARDED, { cookie: user.cookie });
    expect(guarded.statusCode).toBe(201);
    expect(guarded.json()).toEqual({ userId: user.id, phoneNumber: body.phoneNumber });
  });

  it('wymaga sesji i potwierdzonego e-maila; zły numer to VALIDATION_FAILED z podpowiedzią', async () => {
    expect((await call('POST', START, { body: { phoneNumber: randomPhone() } })).statusCode).toBe(
      401,
    );

    const unverified = await createUser({ emailVerified: false });
    const response = await call('POST', START, {
      cookie: unverified.cookie,
      body: { phoneNumber: randomPhone() },
    });
    expect(response.statusCode).toBe(403);
    expect(problemOf(response).code).toBe('EMAIL_NOT_VERIFIED');

    const user = await createUser();
    for (const phoneNumber of ['22 123 45 67', '+49 1512 3456789', 'abc']) {
      const invalid = await call('POST', START, { cookie: user.cookie, body: { phoneNumber } });
      expect(invalid.statusCode).toBe(400);
      expect(problemOf(invalid)).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [
          { path: 'phoneNumber', message: 'Podaj polski numer komórkowy, np. 500 600 700.' },
        ],
      });
    }
  });

  it('zły kod: PHONE_CODE_INVALID z pozostałymi próbami; po 5 próbach kod przepada', async () => {
    const user = await createUser();
    const phoneNumber = randomPhone();
    await call('POST', START, { cookie: user.cookie, body: { phoneNumber } });
    const code = lastCodeSentTo(phoneNumber);
    const wrong = code === '000000' ? '111111' : '000000';

    for (const remainingAttempts of [4, 3, 2, 1, 0]) {
      const response = await call('POST', CONFIRM, { cookie: user.cookie, body: { code: wrong } });
      expect(response.statusCode).toBe(400);
      expect(problemOf(response)).toMatchObject({ code: 'PHONE_CODE_INVALID', remainingAttempts });
    }
    const late = await call('POST', CONFIRM, { cookie: user.cookie, body: { code } });
    expect(problemOf(late).code).toBe('PHONE_CODE_EXPIRED');
  });

  it('kod wygasa po 5 minutach, a nowy kod unieważnia poprzedni', async () => {
    const user = await createUser();
    const phoneNumber = randomPhone();
    await call('POST', START, { cookie: user.cookie, body: { phoneNumber } });
    const first = lastCodeSentTo(phoneNumber);

    await ageLastSend(user.id, 61);
    await call('POST', START, { cookie: user.cookie, body: { phoneNumber } });
    const second = lastCodeSentTo(phoneNumber);
    if (first !== second) {
      const old = await call('POST', CONFIRM, { cookie: user.cookie, body: { code: first } });
      expect(problemOf(old).code).toBe('PHONE_CODE_INVALID');
    }

    await pool.query(
      `update phone_verifications set expires_at = now() - interval '1 second' where user_id = $1`,
      [user.id],
    );
    const expired = await call('POST', CONFIRM, { cookie: user.cookie, body: { code: second } });
    expect(expired.statusCode).toBe(400);
    expect(problemOf(expired).code).toBe('PHONE_CODE_EXPIRED');

    const nothing = await call('POST', CONFIRM, {
      cookie: (await createUser()).cookie,
      body: { code: '123456' },
    });
    expect(problemOf(nothing).code).toBe('PHONE_CODE_EXPIRED');
  });

  it('1 numer = 1 konto: zajęty numer bez SMS-a, wyścig przy potwierdzeniu, własny numer to CONFLICT', async () => {
    const owner = await createUser();
    const phoneNumber = randomPhone();
    await verifyPhone(owner, phoneNumber);

    const other = await createUser();
    const sentBefore = smsCountTo(phoneNumber);
    const taken = await call('POST', START, { cookie: other.cookie, body: { phoneNumber } });
    expect(taken.statusCode).toBe(409);
    expect(problemOf(taken).code).toBe('PHONE_NUMBER_TAKEN');
    expect(smsCountTo(phoneNumber)).toBe(sentBefore);

    const own = await call('POST', START, { cookie: owner.cookie, body: { phoneNumber } });
    expect(own.statusCode).toBe(409);
    expect(problemOf(own).code).toBe('CONFLICT');

    // Dwa konta wysłały kod na ten sam wolny numer; pierwsze potwierdzenie wygrywa.
    const contested = randomPhone();
    const first = await createUser();
    const second = await createUser();
    await call('POST', START, { cookie: first.cookie, body: { phoneNumber: contested } });
    const firstCode = lastCodeSentTo(contested);
    await call('POST', START, { cookie: second.cookie, body: { phoneNumber: contested } });
    const secondCode = lastCodeSentTo(contested);
    expect(
      (await call('POST', CONFIRM, { cookie: first.cookie, body: { code: firstCode } })).statusCode,
    ).toBe(200);
    const lost = await call('POST', CONFIRM, { cookie: second.cookie, body: { code: secondCode } });
    expect(lost.statusCode).toBe(409);
    expect(problemOf(lost).code).toBe('PHONE_NUMBER_TAKEN');
  });

  it('zmiana numeru: nowy zastępuje stary, a stary wraca do puli', async () => {
    const user = await createUser();
    const oldNumber = randomPhone();
    const newNumber = randomPhone();
    await verifyPhone(user, oldNumber);
    await ageLastSend(user.id, 61);
    await verifyPhone(user, newNumber);
    expect((await call('GET', '/v1/me', { cookie: user.cookie })).json()).toMatchObject({
      phoneNumber: newNumber,
    });

    const next = await createUser();
    expect(
      (await call('POST', START, { cookie: next.cookie, body: { phoneNumber: oldNumber } }))
        .statusCode,
    ).toBe(201);
  });

  it('nieudana wysyłka SMS-a: 503 i brak wpisu (od razu można spróbować ponownie)', async () => {
    const user = await createUser();
    const phoneNumber = randomPhone();
    const send = sms.send.bind(sms);
    sms.send = () => Promise.reject(new Error('SMSAPI nie odpowiada'));
    try {
      const failed = await call('POST', START, { cookie: user.cookie, body: { phoneNumber } });
      expect(failed.statusCode).toBe(503);
      expect(problemOf(failed)).toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        detail: 'Nie udało się wysłać SMS-a. Spróbuj ponownie za chwilę.',
      });
    } finally {
      sms.send = send;
    }
    expect(
      (await call('POST', START, { cookie: user.cookie, body: { phoneNumber } })).statusCode,
    ).toBe(201);
  });
});

describe('limity wysyłki SMS-ów', () => {
  it('kolejny SMS dla konta po 60 s (429 z Retry-After)', async () => {
    const user = await createUser();
    await call('POST', START, { cookie: user.cookie, body: { phoneNumber: randomPhone() } });
    const again = await call('POST', START, {
      cookie: user.cookie,
      body: { phoneNumber: randomPhone() },
    });
    expect(again.statusCode).toBe(429);
    expect(problemOf(again).code).toBe('RATE_LIMITED');
    const retryAfter = Number(again.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it('3 SMS-y na numer na godzinę (różne konta)', async () => {
    const phoneNumber = randomPhone();
    const others = [await createUser(), await createUser(), await createUser()];
    await insertSends(
      others.map((other, index) => ({
        userId: other.id,
        phoneNumber,
        ip: `192.0.2.${index + 1}`,
        secondsAgo: 600,
      })),
    );
    const user = await createUser();
    const limited = await call('POST', START, { cookie: user.cookie, body: { phoneNumber } });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeCloseTo(50 * 60, -1);
    expect(problemOf(limited).detail).toBe(
      'Wysłaliśmy już kilka SMS-ów. Spróbuj ponownie za 50 min.',
    );
  });

  it('10 SMS-ów z jednego IP na godzinę (różne konta i numery)', async () => {
    const other = await createUser();
    await insertSends(
      Array.from({ length: 10 }, () => ({
        userId: other.id,
        phoneNumber: randomPhone(),
        ip: clientIp,
        secondsAgo: 120,
      })),
    );
    const user = await createUser();
    const limited = await call('POST', START, {
      cookie: user.cookie,
      body: { phoneNumber: randomPhone() },
    });
    expect(limited.statusCode).toBe(429);
  });

  it('10 SMS-ów na konto na dobę', async () => {
    const user = await createUser();
    await insertSends(
      Array.from({ length: 10 }, (_, index) => ({
        userId: user.id,
        phoneNumber: randomPhone(),
        ip: `192.0.2.${100 + index}`,
        secondsAgo: (index + 1) * 3_600,
      })),
    );
    const limited = await call('POST', START, {
      cookie: user.cookie,
      body: { phoneNumber: randomPhone() },
    });
    expect(limited.statusCode).toBe(429);
  });
});

describe('oświadczenie 18+ i @RequireVerifiedPhone', () => {
  it('konto bez 18+ (np. Google): TERMS_NOT_ACCEPTED, akceptacja regulaminu wymaga oświadczenia', async () => {
    const user = await createUser({ adult: false });
    const guarded = await call('POST', GUARDED, { cookie: user.cookie });
    expect(guarded.statusCode).toBe(403);
    expect(problemOf(guarded).code).toBe('TERMS_NOT_ACCEPTED');

    const withoutDeclaration = await call('POST', '/v1/me/terms-acceptances', {
      cookie: user.cookie,
      body: {},
    });
    expect(withoutDeclaration.statusCode).toBe(400);
    expect(problemOf(withoutDeclaration).code).toBe('VALIDATION_FAILED');

    const accepted = await call('POST', '/v1/me/terms-acceptances', {
      cookie: user.cookie,
      body: { adultDeclaration: true },
    });
    expect(accepted.statusCode).toBe(204);
    const { rows } = await pool.query<{ declared: boolean }>(
      'select is_adult_declared_at is not null as declared from users where id = $1',
      [user.id],
    );
    expect(rows[0]?.declared).toBe(true);
    expect(problemOf(await call('POST', GUARDED, { cookie: user.cookie })).code).toBe(
      'PHONE_NOT_VERIFIED',
    );
  });

  it('kolejność: najpierw e-mail, potem 18+, potem telefon', async () => {
    const user = await createUser({ emailVerified: false, adult: false });
    expect(problemOf(await call('POST', GUARDED, { cookie: user.cookie })).code).toBe(
      'EMAIL_NOT_VERIFIED',
    );
  });

  it('konta testowe z seeda mają zweryfikowany telefon i przechodzą guard', async () => {
    await seedTestUsers(drizzle(pool, { casing: 'snake_case' }));
    const [buyer] = TEST_USERS;
    const signIn = await call('POST', '/v1/auth/sign-in/email', {
      body: { email: buyer?.email, password: TEST_USER_PASSWORD },
    });
    expect(signIn.statusCode).toBe(200);
    const guarded = await call('POST', GUARDED, { cookie: cookiesOf(signIn) });
    expect(guarded.statusCode).toBe(201);
    expect(guarded.json()).toMatchObject({ phoneNumber: buyer?.phoneNumber });
  });
});

describe('sprzątanie', () => {
  it('usuwa niepotwierdzone weryfikacje starsze niż doba, historię zweryfikowanych zostawia', async () => {
    const user = await createUser();
    await verifyPhone(user, randomPhone());
    await insertSends([
      { userId: user.id, phoneNumber: randomPhone(), ip: '192.0.2.200', secondsAgo: 25 * 3_600 },
      { userId: user.id, phoneNumber: randomPhone(), ip: '192.0.2.201', secondsAgo: 3_600 },
    ]);
    await pool.query(
      `update phone_verifications set created_at = now() - interval '30 days'
       where user_id = $1 and verified_at is not null`,
      [user.id],
    );

    expect(await api.app.get(PhoneVerificationService).cleanup()).toBeGreaterThanOrEqual(1);
    const { rows } = await pool.query<{ verified: boolean }>(
      'select verified_at is not null as verified from phone_verifications where user_id = $1 order by created_at',
      [user.id],
    );
    expect(rows.map((row) => row.verified)).toEqual([true, false]);
  });
});

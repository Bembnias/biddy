// Konta testowe przez prawdziwą rejestrację (Better Auth) z ciasteczkiem sesji, a potwierdzony
// e-mail i telefon ustawione wprost w bazie (wystawianie F-14, licytowanie F-15).
import type { Pool } from 'pg';
import { expect } from 'vitest';

import type { TestApp } from './app.js';

export const WEB_ORIGIN = 'http://localhost:3000';
/** Testowy token Turnstile (klucze testowe Cloudflare: zawsze przechodzi). */
export const TURNSTILE_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

export interface TestUser {
  readonly id: string;
  readonly cookie: string;
  /** Token Bearer sesji (nagłówek set-auth-token; klient mobilny). */
  readonly token: string;
}

let counter = 0;

/** Konto z sesją; domyślnie z potwierdzonym e-mailem i zweryfikowanym telefonem. */
export async function createUser(
  api: TestApp,
  pool: Pool,
  options: { readonly phone?: boolean; readonly name?: string } = {},
): Promise<TestUser> {
  counter += 1;
  const email = `user-${String(counter)}-${Math.random().toString(36).slice(2, 10)}@example.com`;
  const response = await api.http.inject({
    method: 'POST',
    url: '/v1/auth/sign-up/email',
    headers: {
      origin: WEB_ORIGIN,
      'x-forwarded-for': `198.51.100.${String(counter % 250)}`,
      'x-turnstile-token': TURNSTILE_TOKEN,
    },
    payload: {
      name: options.name ?? 'Użytkownik Testowy',
      email,
      password: 'bardzo-tajne-haslo-1',
      acceptTerms: true,
      adultDeclaration: true,
      callbackURL: `${WEB_ORIGIN}/weryfikacja-email`,
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  const setCookie = response.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie : [setCookie ?? ''])
    .map((value) => value.split(';')[0])
    .join('; ');
  const { rows } = await pool.query<{ id: string }>('select id from users where email = $1', [
    email,
  ]);
  const id = rows[0]?.id ?? '';
  await pool.query('update users set email_verified = true where id = $1', [id]);
  if (options.phone !== false) {
    const phone = `+48500${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`;
    await pool.query(
      `update users set phone_number = $2, phone_number_verified_at = now() where id = $1`,
      [id, phone],
    );
  }
  const token = response.headers['set-auth-token'];
  return { id, cookie, token: typeof token === 'string' ? token : '' };
}

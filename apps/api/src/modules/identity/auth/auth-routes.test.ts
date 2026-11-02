import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';

import { authProblem, toFetchRequest } from './auth-routes.js';

const CONTEXT = { instance: '/v1/auth/sign-in/email', requestId: 'req-1' };

describe('authProblem: błędy Better Auth i hooków jako Problem Details', () => {
  it('kod Better Auth z polskim komunikatem i polem message dla klienta Better Auth', () => {
    expect(
      authProblem(
        401,
        { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' },
        CONTEXT,
      ),
    ).toEqual({
      type: 'https://biddy.pl/problems/invalid-email-or-password',
      title: 'Wymagane logowanie',
      status: 401,
      detail: 'Nieprawidłowy e-mail lub hasło.',
      instance: '/v1/auth/sign-in/email',
      code: 'INVALID_EMAIL_OR_PASSWORD',
      requestId: 'req-1',
      message: 'Nieprawidłowy e-mail lub hasło.',
    });
  });

  it('kod Biddy z hooka: tytuł z katalogu, komunikat z hooka', () => {
    expect(
      authProblem(
        403,
        { code: 'CAPTCHA_REQUIRED', message: 'Potwierdź, że nie jesteś robotem.' },
        CONTEXT,
      ),
    ).toMatchObject({
      code: 'CAPTCHA_REQUIRED',
      title: 'Wymagana weryfikacja',
      detail: 'Potwierdź, że nie jesteś robotem.',
    });
  });

  it('nieznany kod Better Auth: ogólny polski komunikat zamiast angielskiego', () => {
    expect(
      authProblem(400, { code: 'SOMETHING_NEW', message: 'English text' }, CONTEXT),
    ).toMatchObject({
      code: 'SOMETHING_NEW',
      detail: 'Żądanie jest nieprawidłowe.',
    });
  });

  it('walidacja Better Auth → VALIDATION_FAILED, limit (429) → RATE_LIMITED, brak treści → kod ze statusu', () => {
    expect(authProblem(400, { code: 'VALIDATION_ERROR' }, CONTEXT).code).toBe('VALIDATION_FAILED');
    expect(authProblem(429, { message: 'Too many requests' }, CONTEXT).code).toBe('RATE_LIMITED');
    expect(authProblem(404, undefined, CONTEXT).code).toBe('NOT_FOUND');
  });
});

describe('toFetchRequest', () => {
  function fastifyRequest(overrides: Partial<FastifyRequest>): FastifyRequest {
    return {
      method: 'POST',
      url: '/v1/auth/sign-in/email?x=1',
      ip: '203.0.113.9',
      headers: {
        'content-type': 'application/json',
        'content-length': '999',
        cookie: 'a=1',
        'x-biddy-client-ip': '6.6.6.6',
      },
      body: { email: 'a@b.pl' },
      ...overrides,
    } as FastifyRequest;
  }

  it('adres z bazowym URL API, treść JSON od nowa, IP klienta z Fastify (nie od klienta)', async () => {
    const request = toFetchRequest(fastifyRequest({}), 'https://api.biddy.pl');

    expect(request.url).toBe('https://api.biddy.pl/v1/auth/sign-in/email?x=1');
    expect(request.headers.get('x-biddy-client-ip')).toBe('203.0.113.9');
    expect(request.headers.get('cookie')).toBe('a=1');
    expect(request.headers.has('content-length')).toBe(false);
    expect(await request.json()).toEqual({ email: 'a@b.pl' });
  });

  it('formularz (callback Apple) jako application/x-www-form-urlencoded', async () => {
    const request = toFetchRequest(
      fastifyRequest({
        url: '/v1/auth/callback/apple',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: { code: 'abc', state: 'xyz' },
      }),
      'https://api.biddy.pl',
    );
    expect(await request.text()).toBe('code=abc&state=xyz');
  });

  it('GET bez treści', () => {
    const request = toFetchRequest(
      fastifyRequest({ method: 'GET', body: undefined }),
      'https://api.biddy.pl',
    );
    expect(request.body).toBeNull();
  });
});

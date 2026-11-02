import { describe, expect, it } from 'vitest';

import { csrfVerdict, hasSessionCookie } from './csrf.js';

const ALLOWED = new Set(['http://localhost:3000', 'https://biddy.pl']);
const SESSION = 'biddy.session_token=abc.def';

function verdict(
  method: string,
  headers: Record<string, string>,
  url = '/v1/me/terms-acceptances',
) {
  return csrfVerdict({ method, url, headers }, ALLOWED);
}

describe('csrfVerdict', () => {
  it('żądanie zmieniające stan z ciasteczkiem sesji: tylko z dozwolonego Origin', () => {
    expect(verdict('POST', { cookie: SESSION, origin: 'https://biddy.pl' })).toBe('allowed');
    expect(verdict('POST', { cookie: SESSION, origin: 'https://zla-strona.example' })).toBe(
      'forbidden',
    );
    expect(verdict('DELETE', { cookie: SESSION })).toBe('forbidden');
  });

  it('bez ciasteczka sesji (Bearer, serwer) i metody bezpieczne: bez sprawdzania', () => {
    expect(verdict('POST', { authorization: 'Bearer x' })).toBe('allowed');
    expect(verdict('POST', { cookie: 'inne=1' })).toBe('allowed');
    expect(verdict('GET', { cookie: SESSION, origin: 'https://zla-strona.example' })).toBe(
      'allowed',
    );
  });

  it('callback OAuth (form_post Apple) jest wyjęty: chroni go parametr state', () => {
    expect(verdict('POST', { cookie: SESSION }, '/v1/auth/callback/apple')).toBe('allowed');
  });
});

describe('hasSessionCookie', () => {
  it('rozpoznaje ciasteczka Better Auth z prefiksem biddy, także __Secure-', () => {
    expect(hasSessionCookie('x=1; __Secure-biddy.session_token=abc')).toBe(true);
    expect(hasSessionCookie('biddy.session_data=abc')).toBe(true);
    expect(hasSessionCookie('notbiddy.session_token=abc')).toBe(false);
    expect(hasSessionCookie(undefined)).toBe(false);
  });
});

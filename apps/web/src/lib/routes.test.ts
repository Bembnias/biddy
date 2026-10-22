import { describe, expect, it } from 'vitest';

import { fakePayUrl, safeNextPath, safeReturnUrl, searchUrl, withNext } from './routes';

describe('safeNextPath (ochrona przed open redirect)', () => {
  it.each(['/konto', '/szukaj?q=lego', '/a/nike-air-max-k3x9qa'])(
    'przepuszcza ścieżkę %s',
    (path) => {
      expect(safeNextPath(path)).toBe(path);
    },
  );

  it.each([
    undefined,
    null,
    '',
    'https://zla-strona.example',
    '//zla-strona.example',
    '/\\zla-strona.example',
    'javascript:alert(1)',
  ])('zamienia %s na adres domyślny', (value) => {
    expect(safeNextPath(value)).toBe('/konto');
    expect(safeNextPath(value, '/')).toBe('/');
  });
});

describe('adresy', () => {
  it('withNext i searchUrl kodują parametry', () => {
    expect(withNext('/logowanie', '/konto?x=1')).toBe('/logowanie?next=%2Fkonto%3Fx%3D1');
    expect(searchUrl('karty Pokémon')).toBe('/szukaj?q=karty+Pok%C3%A9mon');
  });
});

describe('safeReturnUrl (powrót ze strony testowej FakeGateway, F-23)', () => {
  const site = 'https://staging.biddy.pl';

  it('przepuszcza adres w obrębie strony Biddy', () => {
    expect(safeReturnUrl('https://staging.biddy.pl/zamowienia/k3x9qa7m?x=1', site)).toBe(
      'https://staging.biddy.pl/zamowienia/k3x9qa7m?x=1',
    );
  });

  it.each([
    'https://zla-strona.example/zamowienia',
    'http://staging.biddy.pl/zamowienia',
    'https://staging.biddy.pl.zla-strona.example/',
    'javascript:alert(1)',
    '/zamowienia/k3x9qa7m',
    'nie adres',
  ])('odrzuca %s', (value) => {
    expect(safeReturnUrl(value, site)).toBeNull();
  });

  it('fakePayUrl koduje identyfikator płatności', () => {
    expect(fakePayUrl('fake_pay_0199')).toBe('/dev/fake-pay/fake_pay_0199');
    expect(fakePayUrl('a/b')).toBe('/dev/fake-pay/a%2Fb');
  });
});

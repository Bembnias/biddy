import { describe, expect, it } from 'vitest';

import { safeNextPath, searchUrl, withNext } from './routes';

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

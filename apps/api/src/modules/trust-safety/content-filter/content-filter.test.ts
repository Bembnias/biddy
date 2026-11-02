import { describe, expect, it } from 'vitest';

import { checkListingText, normalizeWords } from './content-filter.js';

describe('normalizeWords', () => {
  it('małe litery, bez polskich znaków, separatory, cyfry zamiast liter tylko w słowach z literami', () => {
    expect(normalizeWords('Broń PALNA — Łódź, ŻÓŁW!')).toEqual(['bron', 'palna', 'lodz', 'zolw']);
    expect(normalizeWords('m3f3dr0n i 42 zł')).toEqual(['mefedron', 'i', '42', 'zl']);
    expect(normalizeWords('e-papierosy / e.papieros')).toEqual(['e', 'papierosy', 'e', 'papieros']);
    expect(normalizeWords('k0k@in@')).toEqual(['kokaina']);
  });
});

describe('checkListingText', () => {
  it.each([
    ['Naboje 9 mm, 50 szt.', 'naboj*'],
    ['Sprzedam AMUNICJĘ', 'amunicj*'],
    ['E-papieros jednorazowy', 'e papieros*'],
    ['Mystery Box elektronika', 'mystery box'],
    ['Podróbka torebki', 'podrobk*'],
    ['M3F3DR0N', 'mefedron*'],
  ])('BLOCK: „%s” (%s)', (title, term) => {
    const result = checkListingText({ title });
    expect(result.verdict).toBe('BLOCK');
    expect(result.matches).toContainEqual({ field: 'title', term, verdict: 'BLOCK' });
  });

  it.each([
    ['Pistolet do kleju na gorąco', 'pistolet*'],
    ['Etui na paszport, skóra', 'paszport*'],
    ['Replika miecza z filmu', 'replik*'],
    ['Buty Nike 1:1', '1:1'],
    ['Szczeniaki labrador', 'szczeni*'],
  ])('REVIEW: „%s” (%s)', (title, term) => {
    const result = checkListingText({ title });
    expect(result.verdict).toBe('REVIEW');
    expect(result.matches.map((match) => match.term)).toContain(term);
  });

  it.each([
    'Kufel do piwa, kolekcjonerski',
    'Granatowa kurtka zimowa',
    'Papierośnica srebrna, antyk',
    'Spodnie, rozmiar 42, 100% bawełna',
    'Lekka kurtka przeciwdeszczowa',
    'Konsola SNES z grą Bronze',
  ])('ALLOW (bez fałszywego trafienia): „%s”', (title) => {
    expect(checkListingText({ title })).toEqual({ verdict: 'ALLOW', matches: [] });
  });

  it('BLOCK ma pierwszeństwo, dopasowania z każdego pola', () => {
    const result = checkListingText({
      title: 'Replika pistoletu',
      description: 'W zestawie naboje hukowe.',
      brand: null,
    });
    expect(result.verdict).toBe('BLOCK');
    expect(result.matches.map((match) => `${match.field}:${match.term}`)).toEqual([
      'title:pistolet*',
      'title:replik*',
      'description:naboj*',
    ]);
  });

  it('własna lista słów (np. w testach i przyszłej konfiguracji)', () => {
    expect(
      checkListingText({ title: 'Złoty zegarek' }, [{ term: 'zegar*', verdict: 'REVIEW' }]).verdict,
    ).toBe('REVIEW');
  });
});

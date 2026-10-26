import { describe, expect, it } from 'vitest';

import {
  activeFilters,
  filterCount,
  pageWindow,
  parseSearchState,
  searchHref,
  toApiParams,
  toUrlParams,
  withoutFilters,
} from './search-params';

describe('parseSearchState', () => {
  it('czyta zapytanie, stan, ceny, atrybuty, sortowanie i stronę', () => {
    const state = parseSearchState({
      q: '  nike  ',
      kategoria: 'moda/sneakersy',
      stan: ['NEW', 'ZEPSUTY', 'GOOD'],
      cena_od: '100',
      cena_do: '',
      'a.kolor': ['czarny', 'bialy', 'czarny'],
      'a.rozmiarEu.od': '40',
      'a.rozmiarEu.do': '44,5',
      'a.pusty.od': '',
      'a.Zly-Klucz': 'x',
      sort: 'cena_rosnaco',
      strona: '3',
    });
    expect(state).toEqual({
      q: 'nike',
      category: 'moda/sneakersy',
      conditions: ['NEW', 'GOOD'],
      priceFrom: '100',
      priceTo: '',
      values: { kolor: ['czarny', 'bialy'] },
      ranges: { rozmiarEu: { from: '40', to: '44,5' } },
      sort: 'cena_rosnaco',
      page: 3,
    });
  });

  it('nieznane sortowanie i zła strona: wartości domyślne', () => {
    const state = parseSearchState({ sort: 'losowo', strona: '-2' });
    expect(state.sort).toBeUndefined();
    expect(state.page).toBe(1);
    expect(parseSearchState({ strona: 'abc' }).page).toBe(1);
  });
});

describe('toApiParams', () => {
  it('ceny w groszach, atrybuty jako attr, sortowanie API, strona i kategoria', () => {
    const state = parseSearchState({
      q: 'nike',
      stan: 'NEW',
      cena_od: '99,50',
      cena_do: '1 200 zł',
      'a.kolor': 'czarny',
      'a.rozmiarEu.od': '40',
      'a.rozmiarEu.do': '44,5',
      'a.wysokosc.do': 'dużo',
      sort: 'koniec',
      strona: '2',
    });
    expect(toApiParams(state, { categoryId: 'kat-1' })).toEqual({
      q: 'nike',
      category: 'kat-1',
      condition: ['NEW'],
      priceMin: 9_950,
      priceMax: 120_000,
      attr: ['kolor:czarny', 'rozmiarEu:40..44.5'],
      sort: 'ending',
      page: 2,
      pageSize: 24,
    });
  });

  it('bez atrybutów (np. po odrzuceniu przez API) i z błędną ceną', () => {
    const state = parseSearchState({ 'a.kolor': 'czarny', cena_od: 'sto' });
    expect(toApiParams(state, { withAttributes: false })).toEqual({ page: 1, pageSize: 24 });
  });
});

describe('adresy', () => {
  it('stan → parametry adresu i z powrotem', () => {
    const raw = {
      q: 'nike',
      stan: ['NEW'],
      'a.kolor': ['czarny'],
      'a.rozmiarEu.od': '40',
      sort: 'nowe',
      strona: '2',
    };
    const params = toUrlParams(parseSearchState(raw));
    expect(params.toString()).toBe(
      'q=nike&stan=NEW&a.kolor=czarny&a.rozmiarEu.od=40&sort=nowe&strona=2',
    );
    expect(parseSearchState(Object.fromEntries(params))).toMatchObject({ page: 2, sort: 'nowe' });
  });

  it('link do strony, czyszczenie filtrów i liczba filtrów', () => {
    const state = parseSearchState({ q: 'nike', stan: 'NEW', cena_od: '10', strona: '4' });
    expect(filterCount(state)).toBe(2);
    expect(searchHref('/szukaj', state, { page: 1 })).toBe('/szukaj?q=nike&stan=NEW&cena_od=10');
    expect(searchHref('/kategoria/moda', withoutFilters(state))).toBe('/kategoria/moda?q=nike');
    expect(searchHref('/kategoria/moda', parseSearchState({}))).toBe('/kategoria/moda');
  });
});

describe('pageWindow', () => {
  it('pierwsza, ostatnia i sąsiedzi bieżącej z przerwami', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageWindow(10, 10)).toEqual([1, null, 9, 10]);
  });
});

describe('activeFilters (chipy nad wynikami, F-63)', () => {
  it('stan i cena jako jeden chip, atrybuty osobno; usunięcie wraca na pierwszą stronę', () => {
    const state = parseSearchState({
      q: 'nike',
      stan: ['LIKE_NEW', 'VERY_GOOD'],
      cena_do: '500',
      'a.kolor': ['czarny', 'bialy'],
      'a.rozmiarEu.od': '42',
      sort: 'koniec',
      strona: '2',
    });
    const filters = activeFilters(state);
    expect(filters.map(({ without: _without, ...filter }) => filter)).toEqual([
      { kind: 'condition', values: ['LIKE_NEW', 'VERY_GOOD'] },
      { kind: 'price', from: '', to: '500' },
      { kind: 'values', key: 'kolor', values: ['czarny', 'bialy'] },
      { kind: 'range', key: 'rozmiarEu', from: '42', to: '' },
    ]);
    expect(filters.map((filter) => searchHref('/szukaj', filter.without))).toEqual([
      '/szukaj?q=nike&cena_do=500&a.kolor=czarny&a.kolor=bialy&a.rozmiarEu.od=42&sort=koniec',
      '/szukaj?q=nike&stan=LIKE_NEW&stan=VERY_GOOD&a.kolor=czarny&a.kolor=bialy&a.rozmiarEu.od=42&sort=koniec',
      '/szukaj?q=nike&stan=LIKE_NEW&stan=VERY_GOOD&cena_do=500&a.rozmiarEu.od=42&sort=koniec',
      '/szukaj?q=nike&stan=LIKE_NEW&stan=VERY_GOOD&cena_do=500&a.kolor=czarny&a.kolor=bialy&sort=koniec',
    ]);
  });

  it('bez filtrów: brak chipów (zapytanie, kategoria i sortowanie to nie filtry)', () => {
    expect(activeFilters(parseSearchState({ q: 'nike', kategoria: 'moda', sort: 'nowe' }))).toEqual(
      [],
    );
  });
});

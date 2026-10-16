import type { AttributeDefinition } from '@biddy/shared';
import { describe, expect, it } from 'vitest';

import {
  AttributeFilterError,
  buildFilter,
  effectiveSort,
  parseAttributeFilters,
  quote,
  sortRules,
} from './auction-query.js';

const DEFINITIONS: AttributeDefinition[] = [
  { key: 'rozmiarEu', label: 'Rozmiar', type: 'number', min: 15, max: 52, unit: 'EU' },
  {
    key: 'kolor',
    label: 'Kolor',
    type: 'select',
    options: [
      { value: 'czarny', label: 'Czarny' },
      { value: 'bialy', label: 'Biały' },
    ],
  },
  { key: 'zPudelkiem', label: 'Z pudełkiem', type: 'boolean' },
  { key: 'model', label: 'Model', type: 'text' },
];

const BASE = {
  categoryId: undefined,
  conditions: [],
  priceMin: undefined,
  priceMax: undefined,
  attributes: [],
  sellerId: undefined,
  now: 1_000,
} as const;

describe('parseAttributeFilters', () => {
  it('opcje (lub w ramach atrybutu), tak/nie i zakresy liczb', () => {
    expect(
      parseAttributeFilters(
        ['kolor:czarny', 'kolor:bialy', 'zPudelkiem:true', 'rozmiarEu:40..44,5'],
        DEFINITIONS,
      ),
    ).toEqual([
      { key: 'kolor', kind: 'values', values: ['czarny', 'bialy'] },
      { key: 'zPudelkiem', kind: 'values', values: ['true'] },
      { key: 'rozmiarEu', kind: 'range', min: 40, max: 44.5 },
    ]);
    expect(parseAttributeFilters(['rozmiarEu:42'], DEFINITIONS)).toEqual([
      { key: 'rozmiarEu', kind: 'range', min: 42, max: 42 },
    ]);
    expect(parseAttributeFilters(['rozmiarEu:..44', 'rozmiarEu:40..'], DEFINITIONS)).toEqual([
      { key: 'rozmiarEu', kind: 'range', min: 40, max: undefined },
    ]);
  });

  it('atrybut spoza kategorii, tekst, zła opcja, liczba i zakres: błąd', () => {
    for (const raw of [
      'marka:nike',
      'model:air',
      'kolor:zielony',
      'kolor',
      'zPudelkiem:tak',
      'rozmiarEu:duży',
      'rozmiarEu:44..40',
    ]) {
      expect(() => parseAttributeFilters([raw], DEFINITIONS), raw).toThrow(AttributeFilterError);
    }
    expect(() => parseAttributeFilters(['kolor:czarny'], [])).toThrow(
      'Filtry atrybutów wymagają kategorii, która je ma.',
    );
  });
});

describe('buildFilter', () => {
  it('zawsze aktywne aukcje przed końcem', () => {
    expect(buildFilter(BASE)).toBe('status = "ACTIVE" AND endsAtTs > 1000');
  });

  it('kategoria, stan, cena, sprzedawca i atrybuty', () => {
    expect(
      buildFilter({
        ...BASE,
        categoryId: '01960000-0000-7000-8000-0000000000c1',
        conditions: ['NEW', 'LIKE_NEW'],
        priceMin: 1_000,
        priceMax: 50_000,
        sellerId: '01960000-0000-7000-8000-0000000000b1',
        attributes: [
          { key: 'kolor', kind: 'values', values: ['czarny', 'bialy'] },
          { key: 'zPudelkiem', kind: 'values', values: ['true'] },
          { key: 'rozmiarEu', kind: 'range', min: 40, max: undefined },
        ],
      }),
    ).toBe(
      [
        'status = "ACTIVE"',
        'endsAtTs > 1000',
        'categoryIds = "01960000-0000-7000-8000-0000000000c1"',
        'condition IN ["NEW", "LIKE_NEW"]',
        'price >= 1000',
        'price <= 50000',
        'sellerId = "01960000-0000-7000-8000-0000000000b1"',
        'attributes.kolor IN ["czarny", "bialy"]',
        'attributes.zPudelkiem = "true"',
        'attributes.rozmiarEu >= 40',
      ].join(' AND '),
    );
  });

  it('escapuje cudzysłowy i ukośniki', () => {
    expect(quote('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});

describe('sortowanie', () => {
  it('domyślnie trafność z zapytaniem, kończące się bez', () => {
    expect(effectiveSort(undefined, 'nike')).toBe('relevance');
    expect(effectiveSort(undefined, '')).toBe('ending');
    expect(effectiveSort('price_asc', 'nike')).toBe('price_asc');
  });

  it('reguły Meilisearch', () => {
    expect(sortRules('relevance')).toEqual([]);
    expect(sortRules('ending')).toEqual(['endsAtTs:asc']);
    expect(sortRules('newest')).toEqual(['publishedAtTs:desc']);
    expect(sortRules('bids')).toEqual(['bidCount:desc', 'endsAtTs:asc']);
  });
});

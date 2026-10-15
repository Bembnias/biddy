import type { ListingDto } from '@biddy/api-client';
import { describe, expect, it } from 'vitest';

import {
  changedFields,
  convert,
  formValuesFrom,
  mergeIssues,
  parseInteger,
  parseKilograms,
  parsePrice,
  priceText,
  snapshot,
  stepOfPath,
} from './form';

const LISTING: ListingDto = {
  id: '01960000-0000-7000-8000-000000000001',
  publicId: 'k3x9qa7m',
  status: 'DRAFT',
  editable: true,
  bidCount: 0,
  currency: 'PLN',
  categoryId: '01960000-0000-7000-8000-0000000000c1',
  attributes: { rozmiarEu: 42 },
  title: 'Wazon ceramiczny',
  description: null,
  condition: 'GOOD',
  brand: null,
  packageSize: 'XL',
  weightGrams: 12_500,
  lengthCm: 120,
  widthCm: 60,
  heightCm: 40,
  allowedCarriers: ['dpd-kurier'],
  photos: [
    { id: 'a', status: 'READY', urls: { thumb: 't', medium: 'm', large: 'l' } },
    { id: 'b', status: 'PROCESSING', urls: null },
  ],
  startPrice: 1_250,
  reservePrice: 2_000,
  buyNowPrice: null,
  durationDays: 7,
  reviewReasons: [],
  startsAt: null,
  endsAt: null,
  publishedAt: null,
  cancelledAt: null,
  createdAt: '2026-10-15T10:00:00.000Z',
  updatedAt: '2026-10-15T10:00:00.000Z',
};

describe('parsowanie pól', () => {
  it.each([
    ['', null],
    ['12', 1_200],
    ['12,5', 1_250],
    ['12.50', 1_250],
    ['1 200 zł', 120_000],
    ['12,555', 'invalid'],
    ['-5', 'invalid'],
    ['abc', 'invalid'],
  ])('cena „%s” → %s', (text, expected) => {
    expect(parsePrice(text)).toBe(expected);
  });

  it('kilogramy i centymetry', () => {
    expect(parseKilograms('1,25')).toBe(1_250);
    expect(parseKilograms('12 kg')).toBe(12_000);
    expect(parseKilograms('0.5')).toBe(500);
    expect(parseKilograms('1,2345')).toBe('invalid');
    expect(parseInteger(' 120 ')).toBe(120);
    expect(parseInteger('12,5')).toBe('invalid');
  });

  it('priceText: pełne złote bez groszy, inaczej z przecinkiem', () => {
    expect(priceText(2_000)).toBe('20');
    expect(priceText(1_250)).toBe('12,50');
    expect(priceText(null)).toBe('');
  });
});

describe('formValuesFrom i convert', () => {
  it('aukcja → pola formularza (tylko gotowe zdjęcia, waga w kg) → ta sama zmiana', () => {
    const values = formValuesFrom(LISTING);
    expect(values).toMatchObject({
      mediaIds: ['a'],
      startPrice: '12,50',
      reservePrice: '20',
      weightKg: '12,5',
      lengthCm: '120',
      durationDays: '7',
      description: '',
    });
    const { patch, formatIssues } = convert(values);
    expect(formatIssues).toEqual([]);
    expect(patch).toMatchObject({
      mediaIds: ['a'],
      startPrice: 1_250,
      reservePrice: 2_000,
      buyNowPrice: null,
      weightGrams: 12_500,
      lengthCm: 120,
      description: null,
      durationDays: 7,
      attributes: { rozmiarEu: 42 },
    });
  });

  it('błędny format: pole pominięte w walidacji (null) i błąd formatu na ścieżce formularza', () => {
    const { patch, input, formatIssues } = convert({
      ...formValuesFrom(LISTING),
      startPrice: '12,5x',
      weightKg: 'dużo',
    });
    expect(patch.startPrice).toBeNull();
    expect(input.startPrice).toBeNull();
    expect(formatIssues).toEqual([
      { path: 'startPrice', message: 'Podaj kwotę w złotych, np. 12,50.' },
      { path: 'weightKg', message: 'Podaj wagę w kilogramach, np. 1,5.' },
    ]);
  });

  it('wymiary i waga tylko dla XL; puste pola atrybutów pominięte', () => {
    const { patch } = convert({
      ...formValuesFrom(LISTING),
      packageSize: 'M',
      attributes: { rozmiarEu: Number.NaN, kolor: '', pudelko: false, model: 'X' },
    });
    expect(patch).toMatchObject({ weightGrams: null, lengthCm: null, heightCm: null });
    expect(patch.attributes).toEqual({ pudelko: false, model: 'X' });
  });

  it('changedFields: autozapis wysyła tylko zmienione pola', () => {
    const { patch } = convert(formValuesFrom(LISTING));
    const saved = snapshot(patch);
    expect(changedFields(patch, saved)).toEqual({});
    const next = convert({ ...formValuesFrom(LISTING), title: 'Nowy tytuł', mediaIds: ['a', 'c'] });
    expect(changedFields(next.patch, saved)).toEqual({
      title: 'Nowy tytuł',
      mediaIds: ['a', 'c'],
    });
  });
});

describe('kroki i błędy', () => {
  it('stepOfPath: pola API i formularza → kroki kreatora', () => {
    expect(stepOfPath('mediaIds')).toBe('zdjecia');
    expect(stepOfPath('attributes.rozmiarEu')).toBe('kategoria');
    expect(stepOfPath('brand')).toBe('kategoria');
    expect(stepOfPath('condition')).toBe('opis');
    expect(stepOfPath('weightGrams')).toBe('dostawa');
    expect(stepOfPath('buyNowPrice')).toBe('cena');
    expect(stepOfPath('kycNoticeAccepted')).toBe('podglad');
  });

  it('mergeIssues: błąd formatu zastępuje reguły tego pola, ścieżki API → formularz', () => {
    expect(
      mergeIssues(
        [{ path: 'startPrice', message: 'format' }],
        [
          { path: 'startPrice', message: 'Podaj cenę wywoławczą.' },
          { path: 'weightGrams', message: 'waga' },
        ],
      ),
    ).toEqual([
      { path: 'startPrice', message: 'format' },
      { path: 'weightKg', message: 'waga' },
    ]);
  });
});

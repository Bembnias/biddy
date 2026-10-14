import { describe, expect, it } from 'vitest';

import {
  type AttributeDefinition,
  attributeDefinitionsSchema,
  attributesJsonSchema,
  describeAttributes,
  inheritAttributes,
  validateAttributes,
} from './attributes.js';

const color: AttributeDefinition = {
  key: 'kolor',
  label: 'Kolor',
  type: 'select',
  options: [
    { value: 'czarny', label: 'Czarny' },
    { value: 'bialy', label: 'Biały' },
  ],
};
const size: AttributeDefinition = {
  key: 'rozmiarEu',
  label: 'Rozmiar',
  type: 'number',
  required: true,
  min: 15,
  max: 50,
  unit: 'EU',
};
const model: AttributeDefinition = { key: 'model', label: 'Model', type: 'text', maxLength: 10 };
const box: AttributeDefinition = { key: 'pudelko', label: 'Pudełko', type: 'boolean' };
const sneakers = [color, size, model, box];

describe('definicje atrybutów', () => {
  it('przyjmuje poprawne definicje każdego typu', () => {
    expect(attributeDefinitionsSchema.safeParse(sneakers).success).toBe(true);
  });

  it.each([
    ['powtórzony klucz', [color, { ...color, label: 'Inny' }]],
    ['zły klucz', [{ ...model, key: 'Model-1' }]],
    ['select bez opcji', [{ ...color, options: [] }]],
    ['powtórzona opcja', [{ ...color, options: [color.options[0], color.options[0]] }]],
    ['min większe niż max', [{ ...size, min: 60 }]],
    ['nieznany typ', [{ key: 'x', label: 'X', type: 'date' }]],
    ['dodatkowe pole', [{ ...box, options: [] }]],
  ])('odrzuca: %s', (_label, definitions) => {
    expect(attributeDefinitionsSchema.safeParse(definitions).success).toBe(false);
  });
});

describe('dziedziczenie', () => {
  it('najpierw atrybuty przodków; potomek zastępuje atrybut o tym samym kluczu na jego miejscu', () => {
    const narrowed: AttributeDefinition = { ...color, options: [color.options[0]!] };
    const result = inheritAttributes([[color, box], [size], [narrowed]]);
    expect(result.map((definition) => definition.key)).toEqual(['kolor', 'pudelko', 'rozmiarEu']);
    expect(result[0]).toBe(narrowed);
  });
});

describe('walidacja wartości', () => {
  it('poprawne wartości: tekst przycięty, brakujący boolean jako false, puste opcjonalne pominięte', () => {
    expect(
      validateAttributes(sneakers, { rozmiarEu: 42.5, model: '  Air   Max ', kolor: '' }),
    ).toEqual({
      success: true,
      values: { rozmiarEu: 42.5, model: 'Air Max', pudelko: false },
    });
  });

  it('błąd po polsku na każdy zły atrybut', () => {
    const result = validateAttributes(sneakers, {
      kolor: 'zielony',
      rozmiarEu: 51,
      model: 'bardzo długi model',
      pudelko: 'tak',
      waga: 3,
    });
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.issues).toEqual([
      { key: 'waga', message: 'Nieznany atrybut w tej kategorii.' },
      { key: 'kolor', message: 'Wybierz jedną z opcji pola „Kolor”.' },
      { key: 'rozmiarEu', message: 'Pole „Rozmiar” musi być liczbą od 15 do 50.' },
      { key: 'model', message: 'Pole „Model” może mieć najwyżej 10 znaków.' },
      { key: 'pudelko', message: 'Pole „Pudełko” musi mieć wartość tak albo nie.' },
    ]);
  });

  it.each([
    ['brak', {}],
    ['puste pole liczbowe z formularza (NaN)', { rozmiarEu: Number.NaN }],
    ['null', { rozmiarEu: null }],
  ])('wymagany atrybut: %s', (_label, input) => {
    expect(validateAttributes(sneakers, input)).toEqual({
      success: false,
      issues: [{ key: 'rozmiarEu', message: 'Pole „Rozmiar” jest wymagane.' }],
    });
  });

  it('liczba całkowita, tekst zamiast liczby, wartości nie-obiektowe', () => {
    const year: AttributeDefinition = {
      key: 'rok',
      label: 'Rok',
      type: 'number',
      integer: true,
      min: 1,
    };
    expect(validateAttributes([year], { rok: 1999.5 })).toMatchObject({
      issues: [{ message: 'Pole „Rok” musi być liczbą całkowitą nie mniejszą niż 1.' }],
    });
    expect(validateAttributes([year], { rok: '1999' }).success).toBe(false);
    expect(validateAttributes([year], [1]).success).toBe(false);
    expect(validateAttributes([], undefined)).toEqual({ success: true, values: {} });
  });
});

describe('JSON Schema', () => {
  it('opisuje typy, ograniczenia, opcje i wymagane pola', () => {
    expect(attributesJsonSchema(sneakers)).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      properties: {
        kolor: {
          title: 'Kolor',
          type: 'string',
          oneOf: [
            { const: 'czarny', title: 'Czarny' },
            { const: 'bialy', title: 'Biały' },
          ],
        },
        rozmiarEu: { title: 'Rozmiar', type: 'number', minimum: 15, maximum: 50, 'x-unit': 'EU' },
        model: { title: 'Model', type: 'string', maxLength: 10 },
        pudelko: { title: 'Pudełko', type: 'boolean', default: false },
      },
      required: ['rozmiarEu', 'pudelko'],
    });
  });
});

describe('wyświetlanie po zmianie schematu', () => {
  const stored = { kolor: 'zielony', rozmiarEu: 42.5, pudelko: true, usuniety: 'x' };

  it('etykiety, jednostki i Tak/Nie według aktualnych definicji', () => {
    expect(
      describeAttributes(sneakers, { kolor: 'czarny', rozmiarEu: 42.5, pudelko: false }),
    ).toEqual([
      { key: 'kolor', label: 'Kolor', value: 'Czarny' },
      { key: 'rozmiarEu', label: 'Rozmiar', value: '42,5 EU' },
      { key: 'pudelko', label: 'Pudełko', value: 'Nie' },
    ]);
  });

  it('usunięta opcja, usunięty atrybut i nowy wymagany atrybut nie psują wyświetlania', () => {
    const changed = [
      ...sneakers,
      { key: 'stan', label: 'Stan', type: 'text', required: true } as const,
    ];
    expect(describeAttributes(changed, stored)).toEqual([
      { key: 'kolor', label: 'Kolor', value: 'zielony' },
      { key: 'rozmiarEu', label: 'Rozmiar', value: '42,5 EU' },
      { key: 'pudelko', label: 'Pudełko', value: 'Tak' },
    ]);
    expect(describeAttributes(changed, 'uszkodzone')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';

import type { Category } from '../db/catalog.schema.js';
import { CategoryTree, InvalidCategoryAttributesError } from './category-tree.js';

let counter = 0;
function category(overrides: Partial<Category> & Pick<Category, 'slug'>): Category {
  counter += 1;
  return {
    id: `id-${overrides.slug}`,
    parentId: null,
    path: overrides.slug,
    name: overrides.slug,
    position: counter,
    attributes: [],
    isRestricted: false,
    isBrandSensitive: false,
    listingNotice: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const moda = category({
  slug: 'moda',
  attributes: [{ key: 'kolor', label: 'Kolor', type: 'text' }],
  listingNotice: 'Zasady mody',
});
const sneakersy = category({
  slug: 'sneakersy',
  parentId: moda.id,
  position: 2,
  isBrandSensitive: true,
  attributes: [{ key: 'rozmiarEu', label: 'Rozmiar', type: 'number', required: true }],
});
const odziez = category({ slug: 'odziez', parentId: moda.id, position: 1 });
const ukryte = category({ slug: 'ukryte', parentId: moda.id, position: 3, isActive: false });
const podUkrytym = category({ slug: 'pod-ukrytym', parentId: ukryte.id });
const inne = category({ slug: 'inne', position: 0 });
const tree = new CategoryTree([sneakersy, moda, odziez, ukryte, podUkrytym, inne]);

describe('CategoryTree', () => {
  it('aktywne kategorie w kolejności drzewa (pozycja), bez poddrzewa nieaktywnej', () => {
    expect(
      tree.activeNodes().map((node) => [node.path.join('.'), node.depth, node.isLeaf]),
    ).toEqual([
      ['inne', 0, true],
      ['moda', 0, false],
      ['moda.odziez', 1, true],
      ['moda.sneakersy', 1, true],
    ]);
  });

  it('schemat liścia: atrybuty przodków najpierw, flagi i zasady dziedziczone', () => {
    expect(tree.schema(sneakersy.id)).toMatchObject({
      slug: 'sneakersy',
      isLeaf: true,
      isBrandSensitive: true,
      isRestricted: false,
      listingNotice: 'Zasady mody',
      attributes: [{ key: 'kolor' }, { key: 'rozmiarEu' }],
    });
  });

  it('nieznana, nieaktywna i pod nieaktywnym przodkiem: brak schematu', () => {
    expect(tree.schema('brak')).toBeUndefined();
    expect(tree.schema(ukryte.id)).toBeUndefined();
    expect(tree.schema(podUkrytym.id)).toBeUndefined();
  });

  it('uszkodzone definicje w bazie: błąd serwera z nazwą kategorii', () => {
    const broken = category({ slug: 'zepsuta', attributes: [{ key: 'x' }] as never });
    expect(() => new CategoryTree([broken]).schema(broken.id)).toThrow(
      InvalidCategoryAttributesError,
    );
  });
});

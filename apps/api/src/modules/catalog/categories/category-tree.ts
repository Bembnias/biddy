// Drzewo kategorii w pamięci (F-11): kolejność, aktywność z przodkami, dziedziczone atrybuty
// i flagi. Funkcje czyste na wierszach z bazy, testowane bez Postgresa.
import {
  type AttributeDefinition,
  attributeDefinitionsSchema,
  inheritAttributes,
} from '@biddy/shared';

import type { Category } from '../db/catalog.schema.js';

export interface CategoryNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly slug: string;
  readonly name: string;
  /** Slugi od korzenia do tej kategorii. */
  readonly path: readonly string[];
  readonly depth: number;
  readonly isLeaf: boolean;
  /** Flagi efektywne: ustawione na tej kategorii albo którymkolwiek przodku. */
  readonly isRestricted: boolean;
  readonly isBrandSensitive: boolean;
}

export interface CategorySchema extends CategoryNode {
  /** Atrybuty obowiązujące (dziedziczone ze ścieżki). */
  readonly attributes: readonly AttributeDefinition[];
  /** Zasady wystawiania: najbliższe ustawione na ścieżce (od tej kategorii w górę). */
  readonly listingNotice: string | null;
}

/** Uszkodzona definicja atrybutów w bazie: błąd serwera, a nie formularz z niepewną treścią. */
export class InvalidCategoryAttributesError extends Error {
  constructor(slug: string, cause: unknown) {
    super(`Niepoprawne definicje atrybutów kategorii „${slug}”`, { cause });
    this.name = 'InvalidCategoryAttributesError';
  }
}

export class CategoryTree {
  private readonly byId: ReadonlyMap<string, Category>;
  private readonly children: ReadonlyMap<string | null, readonly Category[]>;

  constructor(rows: readonly Category[]) {
    this.byId = new Map(rows.map((row) => [row.id, row]));
    const children = new Map<string | null, Category[]>();
    for (const row of rows) {
      const siblings = children.get(row.parentId) ?? [];
      siblings.push(row);
      children.set(row.parentId, siblings);
    }
    for (const siblings of children.values()) {
      siblings.sort(
        (left, right) =>
          left.position - right.position || left.name.localeCompare(right.name, 'pl'),
      );
    }
    this.children = children;
  }

  /** Aktywne kategorie w kolejności drzewa (w głąb); poddrzewo nieaktywnej kategorii pomijamy. */
  activeNodes(): CategoryNode[] {
    const nodes: CategoryNode[] = [];
    const visit = (parentId: string | null) => {
      for (const row of this.children.get(parentId) ?? []) {
        if (row.isActive) {
          nodes.push(this.node(row));
          visit(row.id);
        }
      }
    };
    visit(null);
    return nodes;
  }

  /** Schemat aktywnej kategorii albo undefined (nieznana, nieaktywna albo z nieaktywnym przodkiem). */
  schema(categoryId: string): CategorySchema | undefined {
    const chain = this.chain(categoryId);
    if (chain === undefined || chain.some((row) => !row.isActive)) {
      return undefined;
    }
    const definitions = chain.map((row) => {
      const parsed = attributeDefinitionsSchema.safeParse(row.attributes);
      if (!parsed.success) {
        throw new InvalidCategoryAttributesError(row.slug, parsed.error);
      }
      return parsed.data;
    });
    const leaf = chain.at(-1) as Category;
    return {
      ...this.node(leaf),
      attributes: inheritAttributes(definitions),
      listingNotice:
        [...chain].reverse().find((row) => row.listingNotice !== null)?.listingNotice ?? null,
    };
  }

  /** Nazwy kategorii od korzenia do wskazanej (także nieaktywnych); pusta lista dla nieznanej. */
  pathNames(categoryId: string): string[] {
    return (this.chain(categoryId) ?? []).map((row) => row.name);
  }

  /** Kategorie od korzenia do wskazanej (włącznie) albo undefined dla nieznanej. */
  private chain(categoryId: string): Category[] | undefined {
    const chain: Category[] = [];
    for (let row = this.byId.get(categoryId); row !== undefined;) {
      chain.unshift(row);
      row = row.parentId === null ? undefined : this.byId.get(row.parentId);
    }
    return chain.length === 0 ? undefined : chain;
  }

  private node(row: Category): CategoryNode {
    const chain = this.chain(row.id) ?? [row];
    return {
      id: row.id,
      parentId: row.parentId,
      slug: row.slug,
      name: row.name,
      path: chain.map((item) => item.slug),
      depth: chain.length - 1,
      isLeaf: !(this.children.get(row.id) ?? []).some((child) => child.isActive),
      isRestricted: chain.some((item) => item.isRestricted),
      isBrandSensitive: chain.some((item) => item.isBrandSensitive),
    };
  }
}

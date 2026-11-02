// Kategorie i atrybuty (F-11): drzewo dla klientów i walidacja atrybutów przedmiotu dla
// kreatora wystawiania (F-14). Drzewo ma kilkadziesiąt wierszy, więc liczymy je w pamięci.
import {
  type AttributeValues,
  type DescribedAttribute,
  describeAttributes,
  validateAttributes,
} from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { categories } from '../db/catalog.schema.js';
import {
  type CategoryCrumb,
  type CategoryNode,
  type CategorySchema,
  CategoryTree,
} from './category-tree.js';

/** Odczyt kategorii dla wielu przedmiotów naraz (patrz {@link CategoryService.lookup}). */
export interface CategoryLookup {
  pathNodes(categoryId: string): CategoryCrumb[];
  describeAttributes(categoryId: string, stored: unknown): DescribedAttribute[];
}

@Injectable()
export class CategoryService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Aktywne kategorie w kolejności drzewa. */
  async list(): Promise<CategoryNode[]> {
    return (await this.tree()).activeNodes();
  }

  /** Schemat aktywnej kategorii albo undefined. */
  async schema(categoryId: string): Promise<CategorySchema | undefined> {
    return (await this.tree()).schema(categoryId);
  }

  /**
   * Atrybuty przedmiotu do zapisu (F-14). Kategoria musi być aktywnym liściem drzewa. Błędy:
   * 400 VALIDATION_FAILED z błędem pola `categoryId` albo `attributes.<klucz>` po polsku.
   */
  async validateItemAttributes(categoryId: string, values: unknown): Promise<AttributeValues> {
    const schema = await this.schema(categoryId);
    if (schema === undefined || !schema.isLeaf) {
      throw new DomainError({
        code: 'VALIDATION_FAILED',
        detail: 'Wybierz kategorię z listy.',
        errors: [
          {
            path: 'categoryId',
            code: 'custom',
            message:
              schema === undefined
                ? 'Ta kategoria nie istnieje albo nie jest już dostępna.'
                : 'Wybierz podkategorię: przedmiot trafia do najbardziej szczegółowej kategorii.',
          },
        ],
      });
    }
    const result = validateAttributes(schema.attributes, values);
    if (!result.success) {
      throw new DomainError({
        code: 'VALIDATION_FAILED',
        detail: 'Popraw atrybuty przedmiotu.',
        errors: result.issues.map((issue) => ({
          path: issue.key === '' ? 'attributes' : `attributes.${issue.key}`,
          code: 'custom',
          message: issue.message,
        })),
      });
    }
    return result.values;
  }

  /**
   * Zapisane atrybuty przedmiotu do wyświetlenia według aktualnych definicji kategorii. Działa
   * także dla kategorii nieaktywnej i po zmianie atrybutów (nie rzuca błędów walidacji).
   */
  async describeAttributes(categoryId: string, stored: unknown): Promise<DescribedAttribute[]> {
    const rows = await this.db.select().from(categories);
    const active = rows.map((row) => ({ ...row, isActive: true }));
    const schema = new CategoryTree(active).schema(categoryId);
    return schema === undefined ? [] : describeAttributes(schema.attributes, stored);
  }

  /**
   * Nazwy kategorii od głównej do wskazanej, np. ['Moda', 'Sneakersy'] (snapshot zamówienia,
   * F-16). Działa także dla kategorii nieaktywnej.
   */
  async pathNames(categoryId: string): Promise<string[]> {
    return (await this.tree()).pathNames(categoryId);
  }

  /** Kategorie od głównej do wskazanej ({ id, slug, name }), także nieaktywne (strona aukcji). */
  async pathNodes(categoryId: string): Promise<CategoryCrumb[]> {
    return (await this.tree()).pathNodes(categoryId);
  }

  /**
   * Ścieżki i atrybuty wielu przedmiotów z jednego odczytu drzewa (indeks wyszukiwarki, F-19).
   * Jak `pathNodes` i `describeAttributes`: działa także dla kategorii nieaktywnych.
   */
  async lookup(): Promise<CategoryLookup> {
    const rows = await this.db.select().from(categories);
    const tree = new CategoryTree(rows);
    const everyActive = new CategoryTree(rows.map((row) => ({ ...row, isActive: true })));
    return {
      pathNodes: (categoryId) => tree.pathNodes(categoryId),
      describeAttributes: (categoryId, stored) => {
        const schema = everyActive.schema(categoryId);
        return schema === undefined ? [] : describeAttributes(schema.attributes, stored);
      },
    };
  }

  private async tree(): Promise<CategoryTree> {
    return new CategoryTree(await this.db.select().from(categories));
  }
}

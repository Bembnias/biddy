// Przedmioty (F-14): dane opisowe aukcji i zdjęcia w kolejności. Proces wystawiania prowadzi
// moduł auctions i woła te metody w swojej transakcji (`tx`), żeby zmiana przedmiotu nie
// przeplotła się z pierwszą ofertą (blokada wiersza aukcji). Kompletność sprawdza publikacja.
import type { ItemCondition, PackageSize } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';

import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { type Item, itemMedia, items } from '../db/catalog.schema.js';

export interface ItemDetails {
  readonly id: string;
  readonly sellerId: string;
  readonly categoryId: string | null;
  readonly title: string | null;
  readonly description: string | null;
  readonly condition: ItemCondition | null;
  readonly brand: string | null;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
  readonly packageSize: PackageSize | null;
  readonly weightGrams: number | null;
  readonly lengthCm: number | null;
  readonly widthCm: number | null;
  readonly heightCm: number | null;
  readonly allowedCarriers: readonly string[];
  /** Zdjęcia w kolejności (pierwsze = główne). */
  readonly mediaIds: readonly string[];
}

/** Zmiana przedmiotu: pominięte pole bez zmian, null czyści pole. */
export type ItemPatch = Partial<{
  -readonly [K in Exclude<keyof ItemDetails, 'id' | 'sellerId'>]: ItemDetails[K];
}>;

export interface ItemUpdate {
  readonly item: ItemDetails;
  /** Zdjęcia dodane do przedmiotu (do przypisania w module media). */
  readonly addedMediaIds: readonly string[];
  /** Zdjęcia usunięte z przedmiotu, których nie używa żaden inny przedmiot (do zwolnienia). */
  readonly releasedMediaIds: readonly string[];
}

/** Tekst jednoliniowy: przycięty, białe znaki zwinięte; pusty = null. */
function line(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  const text = value.trim().replace(/\s+/gu, ' ');
  return text === '' ? null : text;
}

/** Tekst wieloliniowy: przycięty, bez spacji na końcach wierszy; pusty = null. */
function text(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  const normalized = value
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((row) => row.trimEnd())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  return normalized === '' ? null : normalized;
}

function details(row: Item, mediaIds: readonly string[]): ItemDetails {
  return {
    id: row.id,
    sellerId: row.sellerId,
    categoryId: row.categoryId,
    title: row.title,
    description: row.description,
    condition: row.condition,
    brand: row.brand,
    attributes: row.attributes,
    packageSize: row.packageSize,
    weightGrams: row.weightGrams,
    lengthCm: row.lengthCm,
    widthCm: row.widthCm,
    heightCm: row.heightCm,
    allowedCarriers: row.allowedCarriers,
    mediaIds,
  };
}

@Injectable()
export class ItemService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Pusty przedmiot szkicu. */
  async create(sellerId: string, tx: Transaction): Promise<ItemDetails> {
    const [row] = await tx.insert(items).values({ sellerId }).returning();
    if (row === undefined) {
      throw new Error('INSERT items nie zwrócił wiersza');
    }
    return details(row, []);
  }

  async get(itemId: string, tx?: Transaction): Promise<ItemDetails | undefined> {
    const [found] = await this.getMany([itemId], tx);
    return found;
  }

  /** Przedmioty w kolejności `itemIds` (nieistniejących nie ma w wyniku). */
  async getMany(itemIds: readonly string[], tx?: Transaction): Promise<ItemDetails[]> {
    if (itemIds.length === 0) {
      return [];
    }
    const db = tx ?? this.db;
    const rows = await db
      .select()
      .from(items)
      .where(inArray(items.id, [...itemIds]));
    const photos = await db
      .select()
      .from(itemMedia)
      .where(inArray(itemMedia.itemId, [...itemIds]))
      .orderBy(asc(itemMedia.position));
    const byId = new Map(rows.map((row) => [row.id, row]));
    return itemIds.flatMap((id) => {
      const row = byId.get(id);
      return row === undefined
        ? []
        : [
            details(
              row,
              photos.filter((photo) => photo.itemId === id).map((photo) => photo.mediaId),
            ),
          ];
    });
  }

  /** Zmienia pola przedmiotu i (gdy podano `mediaIds`) zdjęcia z kolejnością. */
  async update(itemId: string, patch: ItemPatch, tx: Transaction): Promise<ItemUpdate> {
    const current = await this.get(itemId, tx);
    if (current === undefined) {
      throw new Error(`Nie ma przedmiotu ${itemId}`);
    }
    const values = {
      ...(patch.categoryId === undefined ? {} : { categoryId: patch.categoryId }),
      ...(patch.title === undefined ? {} : { title: line(patch.title) ?? null }),
      ...(patch.description === undefined ? {} : { description: text(patch.description) ?? null }),
      ...(patch.condition === undefined ? {} : { condition: patch.condition }),
      ...(patch.brand === undefined ? {} : { brand: line(patch.brand) ?? null }),
      ...(patch.attributes === undefined ? {} : { attributes: { ...patch.attributes } }),
      ...(patch.packageSize === undefined ? {} : { packageSize: patch.packageSize }),
      ...(patch.weightGrams === undefined ? {} : { weightGrams: patch.weightGrams }),
      ...(patch.lengthCm === undefined ? {} : { lengthCm: patch.lengthCm }),
      ...(patch.widthCm === undefined ? {} : { widthCm: patch.widthCm }),
      ...(patch.heightCm === undefined ? {} : { heightCm: patch.heightCm }),
      ...(patch.allowedCarriers === undefined
        ? {}
        : { allowedCarriers: [...new Set(patch.allowedCarriers)] }),
    };
    await tx
      .update(items)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(items.id, itemId));

    let addedMediaIds: string[] = [];
    let releasedMediaIds: string[] = [];
    if (patch.mediaIds !== undefined) {
      const next = [...new Set(patch.mediaIds)];
      addedMediaIds = next.filter((id) => !current.mediaIds.includes(id));
      const removed = current.mediaIds.filter((id) => !next.includes(id));
      await tx.delete(itemMedia).where(eq(itemMedia.itemId, itemId));
      if (next.length > 0) {
        await tx
          .insert(itemMedia)
          .values(next.map((mediaId, position) => ({ itemId, mediaId, position })));
      }
      releasedMediaIds = await this.unused(removed, itemId, tx);
    }
    const item = await this.get(itemId, tx);
    if (item === undefined) {
      throw new Error(`Nie ma przedmiotu ${itemId}`);
    }
    return { item, addedMediaIds, releasedMediaIds };
  }

  /** Kopia przedmiotu z tymi samymi zdjęciami (ponowne wystawienie). */
  async copy(itemId: string, tx: Transaction): Promise<ItemDetails> {
    const source = await this.get(itemId, tx);
    if (source === undefined) {
      throw new Error(`Nie ma przedmiotu ${itemId}`);
    }
    const [row] = await tx
      .insert(items)
      .values({
        sellerId: source.sellerId,
        categoryId: source.categoryId,
        title: source.title,
        description: source.description,
        condition: source.condition,
        brand: source.brand,
        attributes: { ...source.attributes },
        packageSize: source.packageSize,
        weightGrams: source.weightGrams,
        lengthCm: source.lengthCm,
        widthCm: source.widthCm,
        heightCm: source.heightCm,
        allowedCarriers: [...source.allowedCarriers],
      })
      .returning();
    if (row === undefined) {
      throw new Error('INSERT items nie zwrócił wiersza');
    }
    if (source.mediaIds.length > 0) {
      await tx
        .insert(itemMedia)
        .values(
          source.mediaIds.map((mediaId, position) => ({ itemId: row.id, mediaId, position })),
        );
    }
    return details(row, source.mediaIds);
  }

  /** Usuwa przedmiot (szkic). Zwraca zdjęcia, których nie używa już żaden przedmiot. */
  async remove(itemId: string, tx: Transaction): Promise<readonly string[]> {
    const current = await this.get(itemId, tx);
    if (current === undefined) {
      return [];
    }
    await tx.delete(items).where(eq(items.id, itemId));
    return this.unused(current.mediaIds, itemId, tx);
  }

  /** Zdjęcia spośród `mediaIds`, których nie ma w żadnym przedmiocie poza `exceptItemId`. */
  private async unused(
    mediaIds: readonly string[],
    exceptItemId: string,
    tx: Transaction,
  ): Promise<string[]> {
    if (mediaIds.length === 0) {
      return [];
    }
    const used = await tx
      .select({ mediaId: itemMedia.mediaId })
      .from(itemMedia)
      .where(and(inArray(itemMedia.mediaId, [...mediaIds]), ne(itemMedia.itemId, exceptItemId)));
    const usedIds = new Set(used.map((row) => row.mediaId));
    return mediaIds.filter((id) => !usedIds.has(id));
  }
}

import { getTableConfig, pgTable } from 'drizzle-orm/pg-core';
import { validate, version } from 'uuid';
import { describe, expect, it } from 'vitest';

import { idColumn, newId } from '../../src/infra/db/index.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Znacznik czasu (ms od epoki) zapisany w pierwszych 48 bitach UUIDv7. */
function timestampOf(id: string): number {
  return Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16);
}

describe('newId', () => {
  it('zwraca UUIDv7 w kanonicznym formacie (małe litery, wariant RFC 9562)', () => {
    const id = newId();

    expect(id).toMatch(UUID_V7);
    expect(validate(id)).toBe(true);
    expect(version(id)).toBe(7);
  });

  it('zapisuje w ID chwilę wygenerowania', () => {
    const before = Date.now();
    const id = newId();

    // Generator może przesunąć znacznik o kilka ms do przodu, żeby zachować monotoniczność.
    expect(timestampOf(id)).toBeGreaterThanOrEqual(before);
    expect(timestampOf(id) - before).toBeLessThan(1_000);
  });

  it('kolejne ID są unikalne i rosną leksykograficznie, także w tej samej milisekundzie', () => {
    const ids = Array.from({ length: 5_000 }, () => newId());

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.toSorted()).toEqual(ids);
    // Przy 5000 ID część na pewno powstaje w tej samej milisekundzie: sprawdzamy, że ten
    // przypadek naprawdę wystąpił i też jest uporządkowany.
    const sameMillisecond = ids.slice(1).some((id, index) => {
      const previous = ids[index];
      return previous !== undefined && timestampOf(id) === timestampOf(previous);
    });
    expect(sameMillisecond).toBe(true);
  });
});

describe('idColumn', () => {
  const items = pgTable('items', { id: idColumn() });
  const [column] = getTableConfig(items).columns;

  it('to klucz główny typu uuid bez wartości domyślnej w bazie', () => {
    expect(column?.name).toBe('id');
    expect(column?.getSQLType()).toBe('uuid');
    expect(column?.primary).toBe(true);
    expect(column?.notNull).toBe(true);
    expect(column?.default).toBeUndefined();
  });

  it('nadaje UUIDv7 w aplikacji przy INSERT bez jawnego id', () => {
    expect(column?.hasDefault).toBe(true);
    const generated = column?.defaultFn?.();

    expect(typeof generated).toBe('string');
    expect(generated).toMatch(UUID_V7);
  });
});

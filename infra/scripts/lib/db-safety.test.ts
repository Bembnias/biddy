import { describe, expect, it } from 'vitest';

import { checkResetSafety, databaseUrlFor } from './db-safety.js';

function reasonFor(databaseUrl: string, nodeEnv?: string): string {
  const result = checkResetSafety(databaseUrl, nodeEnv);
  if (result.ok) {
    throw new Error(`Oczekiwano odmowy dla ${databaseUrl}`);
  }
  return result.reason;
}

describe('checkResetSafety', () => {
  it.each([
    ['postgres://biddy:biddy@localhost:5432/biddy', 'localhost'],
    ['postgresql://biddy:biddy@127.0.0.1:5433/biddy', '127.0.0.1'],
    ['postgres://biddy:biddy@[::1]:5432/biddy', '::1'],
    ['postgres://biddy:biddy@LOCALHOST/biddy', 'localhost'],
  ])('pozwala na reset lokalnej bazy %s', (databaseUrl, host) => {
    const result = checkResetSafety(databaseUrl, 'development');
    expect(result).toMatchObject({ ok: true, target: { host, database: 'biddy' } });
  });

  it('zwraca dokładne parametry połączenia (z dekodowaniem znaków specjalnych)', () => {
    const result = checkResetSafety('postgres://ad%40min:p%23ss@localhost:6543/biddy_test', 'test');
    expect(result).toEqual({
      ok: true,
      target: {
        host: 'localhost',
        port: 6543,
        user: 'ad@min',
        password: 'p#ss',
        database: 'biddy_test',
      },
    });
  });

  it('przyjmuje domyślny port 5432, gdy adres go nie podaje', () => {
    const result = checkResetSafety('postgres://biddy:biddy@localhost/biddy', undefined);
    expect(result).toMatchObject({ ok: true, target: { port: 5432 } });
  });

  it('odmawia przy NODE_ENV=production, nawet dla localhost', () => {
    expect(reasonFor('postgres://biddy:biddy@localhost:5432/biddy', 'production')).toContain(
      'NODE_ENV=production',
    );
  });

  it.each([
    'postgres://app:secret@dpg-abc123.frankfurt-postgres.render.com:5432/biddy',
    'postgres://app:secret@db.example.com/biddy',
    'postgres://app:secret@10.0.0.5:5432/biddy',
    'postgres://app:secret@0.0.0.0:5432/biddy',
    'postgres://app:secret@host.docker.internal:5432/biddy',
    'postgres://app:secret@localhost.example.com:5432/biddy',
  ])('odmawia dla zdalnego hosta %s', (databaseUrl) => {
    expect(reasonFor(databaseUrl, 'development')).toContain('tylko dla localhost');
  });

  it('odmawia, gdy parametr ?host= przekierowuje połączenie na zdalny serwer', () => {
    expect(
      reasonFor('postgres://biddy:biddy@localhost:5432/biddy?host=db.example.com', 'development'),
    ).toContain('host=db.example.com');
    expect(
      reasonFor('postgres://biddy:biddy@localhost:5432/biddy?hostaddr=10.1.2.3', 'development'),
    ).toContain('hostaddr=10.1.2.3');
  });

  it.each([
    // pg i libpq biorą OSTATNIĄ wartość powtórzonego parametru, URLSearchParams.get pierwszą.
    ['postgres://biddy:biddy@localhost:5432/biddy?host=localhost&host=db.example.com', 'host='],
    [
      'postgres://biddy:biddy@localhost:5432/biddy?hostaddr=127.0.0.1&hostaddr=10.0.0.5',
      'hostaddr=',
    ],
    // Nawet lokalna wartość: parametr i tak zmienia cel względem tego, co widzi bezpiecznik.
    ['postgres://biddy:biddy@localhost:5432/biddy?host=localhost', 'host=localhost'],
    // ?port= kieruje sterownik na inny port (np. lokalny tunel do zdalnej bazy).
    ['postgres://biddy:biddy@localhost:5432/biddy?port=6543', 'port=6543'],
    ['postgres://biddy:biddy@localhost:5432/biddy?dbname=other', 'dbname=other'],
    ['postgres://biddy:biddy@localhost:5432/biddy?sslmode=disable&user=admin', 'user=admin'],
    ['postgres://biddy:biddy@localhost:5432/biddy?service=prod', 'service=prod'],
  ])('odmawia, gdy parametr w adresie nadpisuje cel połączenia: %s', (databaseUrl, fragment) => {
    const reason = reasonFor(databaseUrl, 'development');
    expect(reason).toContain(fragment);
    expect(reason).toContain('zmienia cel połączenia');
  });

  it('przepuszcza parametry, które nie zmieniają celu połączenia', () => {
    const result = checkResetSafety(
      'postgres://biddy:biddy@localhost:5432/biddy?sslmode=disable&application_name=api',
      'development',
    );
    expect(result).toMatchObject({ ok: true, target: { host: 'localhost', port: 5432 } });
  });

  it('odmawia (bez wyjątku) dla niepoprawnego kodowania % w adresie', () => {
    expect(reasonFor('postgres://biddy:100%pewne@localhost:5432/biddy')).toContain('%25');
    expect(reasonFor('postgres://biddy:biddy@localhost:5432/bi%ZZddy')).toContain('%25');
    expect(reasonFor('postgres://bi%E0%A4ddy:biddy@localhost:5432/biddy')).toContain('%25');
  });

  it('nie usuwa baz systemowych ani adresu bez nazwy bazy', () => {
    expect(reasonFor('postgres://biddy:biddy@localhost:5432/postgres')).toContain('systemowa');
    expect(reasonFor('postgres://biddy:biddy@localhost:5432/template1')).toContain('systemowa');
    expect(reasonFor('postgres://biddy:biddy@localhost:5432/')).toContain('nazwy bazy');
    expect(reasonFor('postgres://biddy:biddy@localhost:5432')).toContain('nazwy bazy');
  });

  it('odmawia dla adresu, który nie jest adresem Postgresa', () => {
    expect(reasonFor('to nie jest url')).toContain('postgres://');
    expect(reasonFor('mysql://root@localhost/biddy')).toContain('postgres://');
  });
});

describe('databaseUrlFor', () => {
  it('buduje adres z celu bezpiecznika, bez parametrów zapytania', () => {
    const result = checkResetSafety(
      'postgres://biddy:biddy@LOCALHOST:5433/biddy?sslmode=disable',
      'development',
    );
    if (!result.ok) {
      throw new Error(result.reason);
    }
    expect(databaseUrlFor(result.target)).toBe('postgres://biddy:biddy@localhost:5433/biddy');
  });

  it.each([
    'postgres://ad%40min:p%23ss%3Aw%2Frd@127.0.0.1:6543/biddy_test',
    'postgres://biddy:biddy@[::1]:5432/biddy',
    'postgres://biddy@localhost:5432/biddy',
  ])('daje adres, który bezpiecznik odczytuje jako ten sam cel: %s', (databaseUrl) => {
    const first = checkResetSafety(databaseUrl, 'development');
    if (!first.ok) {
      throw new Error(first.reason);
    }
    const second = checkResetSafety(databaseUrlFor(first.target), 'development');
    expect(second).toEqual(first);
  });
});

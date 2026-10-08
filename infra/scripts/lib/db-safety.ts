// Bezpiecznik `pnpm db:reset`: czysta funkcja bez efektów ubocznych, łatwa do przetestowania.
// Kasowanie bazy dopuszczamy wyłącznie dla Postgresa na tej maszynie i poza produkcją.
import { PERCENT_ENCODING_HINT, isLocalHostname, portOf, safeDecode } from './net.js';

/** Bazy, których nie wolno usunąć: bez nich nie da się połączyć ani utworzyć nowej bazy. */
const PROTECTED_DATABASES = new Set(['postgres', 'template0', 'template1']);

/**
 * Parametry w adresie (?host=…), którymi pg i libpq nadpisują cel połączenia zapisany w samym
 * adresie. Gdy parametr się powtarza, sterownik bierze OSTATNIĄ wartość, a URLSearchParams.get
 * pierwszą, więc nie próbujemy ich interpretować: każdy z nich oznacza odmowę.
 */
const CONNECTION_OVERRIDES = [
  'host',
  'hostaddr',
  'port',
  'dbname',
  'user',
  'password',
  'service',
] as const;

export interface ResetTarget {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export type ResetSafetyResult = { ok: true; target: ResetTarget } | { ok: false; reason: string };

/**
 * Sprawdza, czy wolno usunąć i odtworzyć bazę z DATABASE_URL.
 * Zwraca też dokładne parametry połączenia, żeby skrypt łączył się dokładnie tam,
 * gdzie sprawdził bezpiecznik (bez ponownego parsowania adresu przez sterownik).
 */
export function checkResetSafety(
  databaseUrl: string,
  nodeEnv: string | undefined,
): ResetSafetyResult {
  if (nodeEnv === 'production') {
    return { ok: false, reason: 'NODE_ENV=production: reset bazy jest zablokowany.' };
  }

  const url = URL.parse(databaseUrl);
  if (url === null || !['postgres:', 'postgresql:'].includes(url.protocol)) {
    return {
      ok: false,
      reason: 'DATABASE_URL nie jest poprawnym adresem postgres://… (nie wiadomo, co usuwać).',
    };
  }

  if (!isLocalHostname(url.hostname)) {
    return {
      ok: false,
      reason: `DATABASE_URL wskazuje na host „${url.hostname || '(pusty)'}”; reset jest dozwolony tylko dla localhost, 127.0.0.1 i ::1.`,
    };
  }

  for (const parameter of CONNECTION_OVERRIDES) {
    const values = url.searchParams.getAll(parameter);
    if (values.length > 0) {
      const shown = values.map((value) => `${parameter}=${value}`).join(', ');
      return {
        ok: false,
        reason: `DATABASE_URL zawiera ${shown}; parametr ?${parameter}= zmienia cel połączenia. Podaj host, port, użytkownika i bazę w samym adresie (postgres://użytkownik:hasło@localhost:5432/baza), bez parametrów zapytania.`,
      };
    }
  }

  const user = safeDecode(url.username);
  const password = safeDecode(url.password);
  const database = safeDecode(url.pathname.slice(1));
  if (user === undefined || password === undefined || database === undefined) {
    return { ok: false, reason: `DATABASE_URL: ${PERCENT_ENCODING_HINT}.` };
  }
  if (database === '' || database.includes('/')) {
    return { ok: false, reason: 'DATABASE_URL nie zawiera nazwy bazy (…/nazwa_bazy na końcu).' };
  }
  if (PROTECTED_DATABASES.has(database)) {
    return { ok: false, reason: `Baza „${database}” jest systemowa i nie może zostać usunięta.` };
  }

  return {
    ok: true,
    target: {
      // Dla schematu postgres: URL nie zmienia wielkości liter hosta. Sterownik pg oczekuje
      // adresu IPv6 bez nawiasów kwadratowych.
      host: url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1'),
      port: portOf(url) ?? 5432,
      user,
      password,
      database,
    },
  };
}

/**
 * Adres zbudowany wyłącznie z celu sprawdzonego przez bezpiecznik (bez parametrów zapytania).
 * Dostają go migracje i seed, więc łączą się dokładnie z bazą, którą odtworzyliśmy, nawet gdy
 * ich sterownik parsowałby surowy DATABASE_URL inaczej niż bezpiecznik.
 */
export function databaseUrlFor(target: ResetTarget): string {
  const host = target.host.includes(':') ? `[${target.host}]` : target.host;
  const user = encodeURIComponent(target.user);
  const password = encodeURIComponent(target.password);
  const credentials = target.password === '' ? user : `${user}:${password}`;
  return `postgres://${credentials}@${host}:${target.port}/${encodeURIComponent(target.database)}`;
}

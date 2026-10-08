// Pomocnicze funkcje dla adresów usług (bez efektów ubocznych, testowalne).

// URL.hostname zwraca IPv6 w nawiasach kwadratowych ("[::1]"), parametr ?host= już bez nich.
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Czy host wskazuje na tę maszynę (localhost, 127.0.0.1, ::1)? */
export function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTNAMES.has(hostname.toLowerCase());
}

const DEFAULT_PORTS: Readonly<Record<string, number>> = {
  'http:': 80,
  'https:': 443,
  'postgres:': 5432,
  'postgresql:': 5432,
  'redis:': 6379,
  'rediss:': 6379,
  'smtp:': 25,
};

/** Port z adresu URL; gdy go nie podano, domyślny port protokołu (lub undefined, jeśli nieznany). */
export function portOf(url: URL): number | undefined {
  return url.port === '' ? DEFAULT_PORTS[url.protocol] : Number(url.port);
}

/**
 * decodeURIComponent bez wyjątku: dla niepoprawnego kodowania (np. samotny „%” w haśle)
 * zwraca undefined zamiast rzucać URIError.
 */
export function safeDecode(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

/** Komunikat dla adresu z niepoprawnym kodowaniem procentowym. */
export const PERCENT_ENCODING_HINT =
  'niepoprawne kodowanie % w adresie (znak % zapisz jako %25, a znaki specjalne w haśle zakoduj, np. @ jako %40)';

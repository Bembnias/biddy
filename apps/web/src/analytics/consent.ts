// Zgody na ciasteczka (PROJECT.md §17: domyślnie tylko niezbędne). Ciasteczko zgody zapisuje
// baner z F-41; tu tylko je czytamy. Bez zgody `analytics` analityka nie startuje.

export const CONSENT_COOKIE = 'biddy_consent';

/** Zdarzenie wysyłane przez baner zgód po zmianie wyboru (F-41). */
export const CONSENT_CHANGED_EVENT = 'biddy:consent-changed';

export type ConsentCategory = 'analytics';

/** Kategorie zgód z wartości ciasteczka (lista po przecinku, np. `analytics`). */
export function parseConsent(value: string | undefined): ReadonlySet<ConsentCategory> {
  const granted = new Set<ConsentCategory>();
  for (const entry of decodeURIComponent(value ?? '').split(',')) {
    if (entry.trim() === 'analytics') {
      granted.add('analytics');
    }
  }
  return granted;
}

/** Wartość ciasteczka o danej nazwie z `document.cookie`. */
export function readCookie(cookieHeader: string, name: string): string | undefined {
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      return rest.join('=');
    }
  }
  return undefined;
}

export function hasAnalyticsConsent(cookieHeader: string): boolean {
  return parseConsent(readCookie(cookieHeader, CONSENT_COOKIE)).has('analytics');
}

// Pomocnicze funkcje testów (nie trafiają do paczki: tsdown buduje tylko src/index.ts).

/** Adres z pierwszego argumentu fetch (tekst, URL albo Request). */
export function urlOf(input: Parameters<typeof fetch>[0] | undefined): string {
  if (input === undefined || typeof input === 'string') {
    return input ?? '';
  }
  return input instanceof URL ? input.href : input.url;
}

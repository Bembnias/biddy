// Adres strony aukcji (F-18): `/a/{slug}-{publicId}`, np. `/a/nike-air-max-90-rozmiar-42-k3x9qa7m`.
// Ten sam adres budują web, mobile (linki), API (e-maile, sitemap) i worker (rewalidacja ISR),
// więc reguły są w jednym miejscu. O tym, która to aukcja, decyduje tylko `publicId`; slug jest
// dla ludzi i wyszukiwarek (po zmianie tytułu stary adres przekierowuje na nowy).

/** Krótki identyfikator aukcji: 8 znaków bez łatwych do pomylenia (0/o, 1/l/i), jak w API. */
export const PUBLIC_ID_PATTERN = /^[a-hjkmnp-z2-9]{8}$/u;

/** Najdłuższy slug (bez publicId). */
export const AUCTION_SLUG_MAX_LENGTH = 60;

/** Slug, gdy tytuł nie ma liter ani cyfr. */
const FALLBACK_SLUG = 'aukcja';

/** Litery, których NFD nie rozkłada na literę i znak diakrytyczny. */
const LETTERS: Readonly<Record<string, string>> = {
  ł: 'l',
  đ: 'd',
  ø: 'o',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
};

/**
 * Slug z tytułu: małe litery bez polskich znaków, cyfry i myślniki, najwyżej 60 znaków
 * (cięcie na granicy słowa, gdy to możliwe).
 *
 * @example auctionSlug('Żółta kurtka, rozmiar M') // 'zolta-kurtka-rozmiar-m'
 */
export function auctionSlug(title: string | null | undefined): string {
  const ascii = (title ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[łđøßæœ]/gu, (letter) => LETTERS[letter] ?? letter);
  const slug = ascii.replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '');
  if (slug === '') {
    return FALLBACK_SLUG;
  }
  if (slug.length <= AUCTION_SLUG_MAX_LENGTH) {
    return slug;
  }
  const cut = slug.slice(0, AUCTION_SLUG_MAX_LENGTH + 1);
  const boundary = cut.lastIndexOf('-');
  // Słowo dłuższe niż połowa limitu tniemy w środku, zamiast zostawiać bardzo krótki slug.
  return boundary >= AUCTION_SLUG_MAX_LENGTH / 2
    ? cut.slice(0, boundary)
    : slug.slice(0, AUCTION_SLUG_MAX_LENGTH).replace(/-+$/u, '');
}

/** Ścieżka strony aukcji. */
export function auctionPath(slug: string, publicId: string): string {
  return `/a/${slug}-${publicId}`;
}

/**
 * `publicId` i slug z segmentu adresu (`{slug}-{publicId}` albo sam `publicId`); null, gdy
 * segment nie kończy się poprawnym identyfikatorem.
 */
export function parseAuctionPath(
  segment: string,
): { readonly slug: string; readonly publicId: string } | null {
  const separator = segment.lastIndexOf('-');
  const publicId = segment.slice(separator + 1);
  if (!PUBLIC_ID_PATTERN.test(publicId)) {
    return null;
  }
  return { slug: separator === -1 ? '' : segment.slice(0, separator), publicId };
}

/** Tag cache strony aukcji w web (ISR): rewalidacja po zdarzeniach aukcji. */
export function auctionCacheTag(publicId: string): string {
  return `auction:${publicId}`;
}

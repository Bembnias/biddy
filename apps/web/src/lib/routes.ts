// Adresy stron w jednym miejscu (polskie ścieżki). Część stron powstanie w kolejnych feature'ach:
// wyszukiwarka (F-19), kreator (F-14), logowanie (F-07), strony prawne i pomoc (F-41).
export const routes = {
  home: '/',
  search: '/szukaj',
  sell: '/wystaw',
  signIn: '/logowanie',
  about: '/o-nas',
  contact: '/kontakt',
  helpCenter: '/pomoc',
  howBiddingWorks: '/pomoc/jak-dziala-licytacja',
  buyerProtection: '/pomoc/pakiet-ochrony-kupujacych',
  prohibitedItems: '/pomoc/zakazane-przedmioty',
  terms: '/regulamin',
  privacy: '/polityka-prywatnosci',
} as const;

/** Adres wyszukiwarki z frazą, np. `/szukaj?q=retro+gaming`. */
export function searchUrl(query: string): string {
  return `${routes.search}?${new URLSearchParams({ q: query }).toString()}`;
}

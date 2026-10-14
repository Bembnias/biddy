// Adresy stron w jednym miejscu (polskie ścieżki). Część stron powstanie w kolejnych feature'ach:
// wyszukiwarka (F-19), kreator (F-14), logowanie (F-07), strony prawne i pomoc (F-41).
export const routes = {
  home: '/',
  search: '/szukaj',
  sell: '/wystaw',
  signIn: '/logowanie',
  signUp: '/rejestracja',
  forgotPassword: '/reset-hasla',
  resetPassword: '/nowe-haslo',
  verifyEmail: '/weryfikacja-email',
  acceptTerms: '/akceptacja-regulaminu',
  verifyPhone: '/weryfikacja-telefonu',
  account: '/konto',
  profileSettings: '/konto/profil',
  addresses: '/konto/adresy',
  newAddress: '/konto/adresy/nowy',
  about: '/o-nas',
  contact: '/kontakt',
  helpCenter: '/pomoc',
  howBiddingWorks: '/pomoc/jak-dziala-licytacja',
  buyerProtection: '/pomoc/pakiet-ochrony-kupujacych',
  prohibitedItems: '/pomoc/zakazane-przedmioty',
  terms: '/regulamin',
  privacy: '/polityka-prywatnosci',
} as const;

/** Profil publiczny użytkownika (F-10). */
export function publicProfileUrl(userId: string): string {
  return `/u/${userId}`;
}

/** Edycja adresu (F-10). */
export function editAddressUrl(addressId: string): string {
  return `${routes.addresses}/${addressId}`;
}

/** Adres wyszukiwarki z frazą, np. `/szukaj?q=retro+gaming`. */
export function searchUrl(query: string): string {
  return `${routes.search}?${new URLSearchParams({ q: query }).toString()}`;
}

/**
 * Bezpieczny adres powrotu z parametru `next` (np. `/logowanie?next=/konto`): tylko ścieżka
 * w tej aplikacji. Adres absolutny albo `//host` (open redirect) zamienia na `fallback`.
 */
export function safeNextPath(
  value: string | null | undefined,
  fallback: string = routes.account,
): string {
  if (
    value === null ||
    value === undefined ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  ) {
    return fallback;
  }
  return value;
}

/** Adres z parametrem `next` (powrót po logowaniu lub akceptacji regulaminu). */
export function withNext(path: string, next: string): string {
  return `${path}?${new URLSearchParams({ next }).toString()}`;
}

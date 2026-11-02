// Adresy stron w jednym miejscu (polskie ścieżki). Część stron powstanie w kolejnych feature'ach:
// strony prawne i pomoc (F-41).
import { auctionPath } from '@biddy/shared';

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
  myBiddy: '/moje-biddy',
  myWins: '/moje-biddy/wygrane',
  myWatchlist: '/moje-biddy/obserwowane',
  myAuctions: '/moje-biddy/aukcje',
  mySales: '/moje-biddy/sprzedane',
  notifications: '/powiadomienia',
  notificationSettings: '/konto/powiadomienia',
  /** Limity konta, strike'i, blokady i odwołania (F-61). */
  accountStanding: '/konto/limity',
  unsubscribe: '/wypisz',
  about: '/o-nas',
  contact: '/kontakt',
  helpCenter: '/pomoc',
  howBiddingWorks: '/pomoc/jak-dziala-licytacja',
  buyerProtection: '/pomoc/pakiet-ochrony-kupujacych',
  prohibitedItems: '/pomoc/zakazane-przedmioty',
  terms: '/regulamin',
  privacy: '/polityka-prywatnosci',
  /** Panel deweloperski FakeGateway (F-23, poza produkcją). */
  fakeGateway: '/dev/fake-gateway',
  /** Panel deweloperski FakeShipping (F-24, poza produkcją). */
  fakeShipping: '/dev/fake-shipping',
} as const;

/** Checkout zamówienia dla kupującego (F-25), np. `/zamowienia/k3x9qa7m/zaplac`. */
export function checkoutUrl(orderPublicId: string): string {
  return `/zamowienia/${encodeURIComponent(orderPublicId)}/zaplac`;
}

/** Strona nadania paczki zamówienia dla sprzedającego (F-24), np. `/zamowienia/k3x9qa7m/nadaj`. */
export function dispatchUrl(orderPublicId: string): string {
  return `/zamowienia/${encodeURIComponent(orderPublicId)}/nadaj`;
}

/** Testowa strona płatności FakeGateway (F-23): tu FakeGateway odsyła płatności z przekierowaniem. */
export function fakePayUrl(paymentId: string): string {
  return `/dev/fake-pay/${encodeURIComponent(paymentId)}`;
}

/**
 * Adres powrotu po płatności na stronie testowej (F-23): tylko adres http(s) w obrębie strony
 * Biddy (`siteUrl`). Inny adres to null: strona pokaże go jako tekst, a nie przekieruje
 * (ochrona przed open redirect).
 */
export function safeReturnUrl(value: string, siteUrl: string): string | null {
  const target = URL.parse(value);
  const site = URL.parse(siteUrl);
  if (target === null || site === null || !['http:', 'https:'].includes(target.protocol)) {
    return null;
  }
  return target.origin === site.origin ? target.toString() : null;
}

/** Strona aukcji (F-18): `/a/{slug}-{publicId}`. */
export function auctionUrl(auction: { readonly slug: string; readonly publicId: string }): string {
  return auctionPath(auction.slug, auction.publicId);
}

/** Strona kategorii (F-19) ze ścieżki slugów, np. `/kategoria/moda/sneakersy`. */
export function categoryUrl(path: readonly string[]): string {
  return `/kategoria/${path.join('/')}`;
}

/** Profil publiczny użytkownika (F-10). */
export function publicProfileUrl(userId: string): string {
  return `/u/${userId}`;
}

/** Kreator aukcji dla szkicu albo aukcji bez ofert (F-14), opcjonalnie od wskazanego kroku. */
export function listingWizardUrl(auctionId: string, step?: string): string {
  return step === undefined
    ? `${routes.sell}/${auctionId}`
    : `${routes.sell}/${auctionId}?krok=${step}`;
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

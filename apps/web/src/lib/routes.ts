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
  /** Rozmowy kupujących ze sprzedającymi (F-29). */
  messages: '/wiadomosci',
  /** Zablokowani użytkownicy (F-29). */
  blockedUsers: '/konto/zablokowani',
  notificationSettings: '/konto/powiadomienia',
  /** Limity konta, strike'i, blokady i odwołania (F-61). */
  accountStanding: '/konto/limity',
  /** Saldo, wypłaty i historia salda (F-27). */
  balance: '/konto/saldo',
  /** Dane do wypłat: dane osobowe (DAC7) i rachunek (F-27). */
  payoutProfile: '/konto/saldo/dane',
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

/** Strona zamówienia dla obu stron (F-26), np. `/zamowienia/k3x9qa7m`. */
export function orderUrl(orderPublicId: string): string {
  return `/zamowienia/${encodeURIComponent(orderPublicId)}`;
}

/** Spór zamówienia dla obu stron (F-28), np. `/zamowienia/k3x9qa7m/spor`. */
export function disputeUrl(orderPublicId: string): string {
  return `/zamowienia/${encodeURIComponent(orderPublicId)}/spor`;
}

/** Rozmowa (F-29), np. `/wiadomosci/0196…`. */
export function conversationUrl(conversationId: string): string {
  return `${routes.messages}/${encodeURIComponent(conversationId)}`;
}

/**
 * Nowa wiadomość o aukcji albo zamówieniu (F-29): `/wiadomosci/nowa?aukcja={id}` albo
 * `?zamowienie={numer}`. Strona przekierowuje do istniejącej rozmowy pary.
 */
export function newConversationUrl(
  subject: { readonly auctionId: string } | { readonly orderPublicId: string },
): string {
  const query: Record<string, string> =
    'auctionId' in subject ? { aukcja: subject.auctionId } : { zamowienie: subject.orderPublicId };
  return `${routes.messages}/nowa?${new URLSearchParams(query).toString()}`;
}

/** Oferta drugiej szansy dla licytującego (F-26). */
export function secondChanceUrl(offerId: string): string {
  return `/druga-szansa/${encodeURIComponent(offerId)}`;
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

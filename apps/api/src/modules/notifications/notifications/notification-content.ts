// Treść powiadomień (F-20): tytuł, akapity, adres i przycisk z migawki zapisanej przy zdarzeniu.
// Te same teksty widać w centrum powiadomień (web, mobile) i w e-mailu. Bez form zależnych od płci.
import {
  type AccountBlockKind,
  auctionPath,
  formatMoney,
  type Money,
  type NotificationType,
  type StrikeReason,
} from '@biddy/shared';

/** Aukcja w migawce powiadomienia. */
export interface AuctionRef {
  readonly id: string;
  readonly publicId: string;
  readonly slug: string;
  readonly title: string;
}

/** Strike albo blokada w migawce powiadomienia o koncie (F-61). */
export interface AccountRef {
  readonly reason?: StrikeReason;
  readonly kind?: AccountBlockKind;
  /** Uzasadnienie decyzji (statement of reasons) albo notatka przy cofnięciu i odwołaniu. */
  readonly statement: string;
  readonly subject?: 'STRIKE' | 'BLOCK';
}

/** Migawka zapisana w `notifications.payload` (pola zależne od typu). */
export interface NotificationPayload {
  /** Aukcja; brak w powiadomieniach o koncie (F-61). */
  readonly auction?: AuctionRef;
  readonly account?: AccountRef;
  /** Aktualna albo wywoławcza cena. */
  readonly price?: Money;
  readonly endsAt?: string;
  readonly orderPublicId?: string;
  /** Wylicytowana kwota (wygrana, sprzedaż). */
  readonly itemsTotal?: Money;
  /** Do zapłaty z POK, bez dostawy (wygrana). */
  readonly total?: Money;
  readonly paymentDueAt?: string;
  /** Termin nadania paczki (opłacone zamówienie, F-24). */
  readonly shipBy?: string;
  readonly reason?: 'NO_BIDS' | 'RESERVE_NOT_MET';
  readonly cancelledBy?: 'SELLER' | 'MODERATOR';
  readonly sellerName?: string;
}

export interface NotificationContent {
  readonly title: string;
  readonly lines: readonly string[];
  /** Ścieżka w web, np. `/a/wazon-k3x9qa7m`. */
  readonly path: string;
  readonly actionLabel: string;
}

/** Moje aukcje w Moje Biddy (powiadomienie o braku sprzedaży, F-21). */
const MY_AUCTIONS_PATH = '/moje-biddy/aukcje';

/** Checkout zamówienia dla kupującego (F-25). */
export function checkoutPath(orderPublicId: string): string {
  return `/zamowienia/${orderPublicId}/zaplac`;
}

/** Limity i strike'i w ustawieniach konta (F-61). */
export const ACCOUNT_STANDING_PATH = '/konto/limity';

/** Strona nadania paczki zamówienia (F-24). */
export function dispatchPath(orderPublicId: string): string {
  return `/zamowienia/${orderPublicId}/nadaj`;
}

const dateTime = new Intl.DateTimeFormat('pl-PL', {
  timeZone: 'Europe/Warsaw',
  dateStyle: 'medium',
  timeStyle: 'short',
});

const date = (iso: string | undefined) => (iso === undefined ? '' : dateTime.format(new Date(iso)));
const money = (value: Money | undefined) =>
  value === undefined ? '' : formatMoney(value, { trailingZeroDisplay: 'stripIfInteger' });

/** Powód strike'a w tytułach powiadomień. */
export const STRIKE_REASON_LABELS: Readonly<Record<StrikeReason, string>> = {
  UNPAID: 'brak płatności',
  NOT_COLLECTED: 'nieodebrana paczka',
  NOT_SHIPPED: 'paczka nienadana w terminie',
  AUCTION_CANCELLED_WITH_BIDS: 'anulowanie aukcji z ofertami',
  DISPUTE_LOST: 'przegrany spór',
  COUNTERFEIT: 'podróbka',
  OTHER: 'naruszenie regulaminu',
};

const BLOCK_LABELS: Readonly<Record<AccountBlockKind, string>> = {
  BIDDING: 'licytowania',
  LISTING: 'wystawiania aukcji',
  PAYOUTS: 'wypłat',
};

const ACCOUNT_TYPES = [
  'STRIKE_ISSUED',
  'STRIKE_REVOKED',
  'ACCOUNT_BLOCKED',
  'ACCOUNT_UNBLOCKED',
  'APPEAL_REJECTED',
] as const satisfies readonly NotificationType[];
type AccountNotificationType = (typeof ACCOUNT_TYPES)[number];

function isAccountType(type: NotificationType): type is AccountNotificationType {
  return (ACCOUNT_TYPES as readonly NotificationType[]).includes(type);
}

/** Strike'i, blokady i odwołania (F-61): treść z zapisanego uzasadnienia. */
function accountContent(type: AccountNotificationType, account: AccountRef): NotificationContent {
  const reason = account.reason === undefined ? 'naruszenie' : STRIKE_REASON_LABELS[account.reason];
  const block = account.kind === undefined ? 'konta' : BLOCK_LABELS[account.kind];
  const base = { path: ACCOUNT_STANDING_PATH, lines: [account.statement] };
  switch (type) {
    case 'STRIKE_ISSUED':
      return { ...base, title: `Strike: ${reason}`, actionLabel: 'Zobacz szczegóły' };
    case 'STRIKE_REVOKED':
      return { ...base, title: `Cofnięto strike: ${reason}`, actionLabel: "Limity i strike'i" };
    case 'ACCOUNT_BLOCKED':
      return { ...base, title: `Blokada ${block}`, actionLabel: 'Szczegóły i odwołanie' };
    case 'ACCOUNT_UNBLOCKED':
      return { ...base, title: `Zdjęto blokadę ${block}`, actionLabel: "Limity i strike'i" };
    case 'APPEAL_REJECTED':
      return {
        ...base,
        title:
          account.subject === 'BLOCK'
            ? `Odwołanie od blokady ${block} nieuwzględnione`
            : `Odwołanie od strike'a nieuwzględnione: ${reason}`,
        actionLabel: 'Zobacz szczegóły',
      };
  }
}

export function notificationContent(
  type: NotificationType,
  payload: NotificationPayload,
): NotificationContent {
  if (isAccountType(type)) {
    return accountContent(type, payload.account ?? { statement: '' });
  }
  const auction = payload.auction ?? { id: '', publicId: '', slug: '', title: '' };
  const path = auctionPath(auction.slug, auction.publicId);
  const title = `„${auction.title}”`;
  switch (type) {
    case 'OUTBID':
      return {
        title: 'Przebito Twoją ofertę',
        lines: [
          `${title}: aktualna cena ${money(payload.price)}.`,
          `Zalicytuj ponownie przed końcem aukcji (${date(payload.endsAt)}).`,
        ],
        path,
        actionLabel: 'Licytuj ponownie',
      };
    case 'ENDING_SOON':
      return {
        title: 'Aukcja kończy się za godzinę',
        lines: [`${title}: aktualna cena ${money(payload.price)}, koniec ${date(payload.endsAt)}.`],
        path,
        actionLabel: 'Zobacz aukcję',
      };
    case 'WON':
      return {
        title: `Wygrana: ${auction.title}`,
        lines: [
          `Wylicytowana kwota: ${money(payload.itemsTotal)}. Do zapłaty z Pakietem Ochrony Kupujących: ${money(payload.total)} (bez dostawy).`,
          `Termin płatności: ${date(payload.paymentDueAt)}. Zamówienie nr ${payload.orderPublicId ?? ''}.`,
        ],
        path: payload.orderPublicId === undefined ? path : checkoutPath(payload.orderPublicId),
        actionLabel: 'Zapłać',
      };
    case 'SOLD':
      return {
        title: `Sprzedano: ${auction.title}`,
        lines: [
          `Przedmiot sprzedany za ${money(payload.itemsTotal)}.`,
          `Kupujący ma czas na płatność do ${date(payload.paymentDueAt)}. Wyślij przedmiot po opłaceniu zamówienia nr ${payload.orderPublicId ?? ''}.`,
        ],
        path,
        actionLabel: 'Zobacz aukcję',
      };
    case 'UNSOLD':
      return {
        title: 'Aukcja zakończona bez sprzedaży',
        lines: [
          payload.reason === 'RESERVE_NOT_MET'
            ? `${title}: najwyższa oferta nie osiągnęła ceny minimalnej.`
            : `${title}: aukcja nie dostała ofert.`,
          'Możesz wystawić przedmiot ponownie w Moich aukcjach.',
        ],
        path: MY_AUCTIONS_PATH,
        actionLabel: 'Moje aukcje',
      };
    case 'AUCTION_CANCELLED':
      return {
        title: 'Aukcja anulowana',
        lines: [
          `${title}: aukcja została anulowana przez ${payload.cancelledBy === 'MODERATOR' ? 'moderację Biddy' : 'sprzedającego'}.`,
          'Oferty w tej aukcji przestały obowiązywać.',
        ],
        path,
        actionLabel: 'Zobacz aukcję',
      };
    case 'ORDER_PAID':
      return {
        title: `Opłacono: ${auction.title}`,
        lines: [
          `Kupujący zapłacił za ${title} (zamówienie nr ${payload.orderPublicId ?? ''}).`,
          `Nadaj paczkę do ${date(payload.shipBy)}: podaj dane nadawcy, a dostaniesz kod nadania albo etykietę.`,
        ],
        path: dispatchPath(payload.orderPublicId ?? ''),
        actionLabel: 'Nadaj paczkę',
      };
    case 'FOLLOWED_SELLER_NEW_AUCTION':
      return {
        title: `Nowa aukcja: ${payload.sellerName ?? 'obserwowany sprzedawca'}`,
        lines: [
          `${payload.sellerName ?? 'Sprzedawca'} wystawia ${title}, cena wywoławcza ${money(payload.price)}, koniec ${date(payload.endsAt)}.`,
        ],
        path,
        actionLabel: 'Zobacz aukcję',
      };
  }
}

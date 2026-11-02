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
  /** Etapy zamówienia (F-26): kto dostaje powiadomienie i szczegóły etapu. */
  readonly recipientRole?: 'BUYER' | 'SELLER';
  readonly cancelReason?: 'UNPAID' | 'NOT_SHIPPED';
  readonly carrierName?: string;
  readonly trackingNumber?: string | null;
  readonly inspectionEndsAt?: string;
  readonly refund?: Money;
  readonly refundReason?: RefundReasonCode;
  readonly compensation?: Money;
  readonly compensationDueAt?: string;
  /** Oferta drugiej szansy (F-26). */
  readonly offerId?: string;
  readonly offerStatus?: 'ACCEPTED' | 'DECLINED' | 'EXPIRED';
  readonly expiresAt?: string;
  readonly reason?: 'NO_BIDS' | 'RESERVE_NOT_MET';
  readonly cancelledBy?: 'SELLER' | 'MODERATOR';
  readonly sellerName?: string;
}

/** Powód zwrotu w migawce (lista z modułu payments; plik treści nie zależy od modułów). */
export type RefundReasonCode =
  | 'NOT_SHIPPED'
  | 'LOST'
  | 'DISPUTE'
  | 'LATE_PAYMENT'
  | 'DUPLICATE_PAYMENT'
  | 'CHARGEBACK'
  | 'NOT_PICKED_UP';

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

/** Strona zamówienia dla obu stron (F-26). */
export function orderPath(orderPublicId: string): string {
  return `/zamowienia/${orderPublicId}`;
}

/** Oferta drugiej szansy dla licytującego (F-26). */
export function secondChancePath(offerId: string): string {
  return `/druga-szansa/${offerId}`;
}

/** Dlaczego zwracamy pieniądze (zdanie w powiadomieniu o zwrocie). */
const REFUND_REASON_TEXT: Readonly<Record<RefundReasonCode, string>> = {
  LATE_PAYMENT: 'Płatność dotarła po terminie.',
  DUPLICATE_PAYMENT: 'Zamówienie było już opłacone.',
  NOT_SHIPPED: 'Sprzedający nie nadał paczki w terminie.',
  NOT_PICKED_UP: 'Paczka nie została odebrana, więc zwrot nie obejmuje dostawy.',
  LOST: 'Paczka zaginęła.',
  DISPUTE: 'Spór rozstrzygnięto na Twoją korzyść.',
  CHARGEBACK: 'Zwrot po reklamacji płatności w banku.',
};

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
  const number = payload.orderPublicId ?? '';
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
    case 'PAYMENT_REMINDER':
      return {
        title: `Zapłać za: ${auction.title}`,
        lines: [
          `Zamówienie nr ${number} czeka na płatność do ${date(payload.paymentDueAt)}. Do zapłaty z Pakietem Ochrony Kupujących: ${money(payload.total)} (bez dostawy).`,
          'Bez płatności w terminie zamówienie zostanie anulowane, a konto dostanie strike.',
        ],
        path: checkoutPath(number),
        actionLabel: 'Zapłać',
      };
    case 'SHIP_REMINDER':
      return {
        title: `Nadaj paczkę: ${auction.title}`,
        lines: [
          `Termin nadania paczki z zamówienia nr ${number} mija ${date(payload.shipBy)}.`,
          'Bez nadania w terminie zamówienie zostanie anulowane, kupujący dostanie zwrot, a konto strike.',
        ],
        path: dispatchPath(number),
        actionLabel: 'Nadaj paczkę',
      };
    case 'ORDER_CANCELLED':
      return cancelledContent(payload, auction.title, number);
    case 'ORDER_SHIPPED':
      return {
        title: `Paczka w drodze: ${auction.title}`,
        lines: [
          payload.trackingNumber === undefined || payload.trackingNumber === null
            ? `Sprzedający nadał paczkę (${payload.carrierName ?? 'przewoźnik'}).`
            : `Sprzedający nadał paczkę: ${payload.carrierName ?? 'przewoźnik'}, numer przesyłki ${payload.trackingNumber}.`,
          'Po odbiorze będziesz mieć 36 godzin na sprawdzenie przedmiotu.',
        ],
        path: orderPath(number),
        actionLabel: 'Śledź przesyłkę',
      };
    case 'ORDER_DELIVERED':
      return {
        title: `Odebrano: ${auction.title}`,
        lines: [
          `Sprawdź przedmiot do ${date(payload.inspectionEndsAt)}. Jeśli wszystko się zgadza, potwierdź odbiór.`,
          'Po tym czasie zamówienie zakończy się samo, a sprzedający dostanie pieniądze.',
        ],
        path: orderPath(number),
        actionLabel: 'Sprawdź i potwierdź',
      };
    case 'ORDER_COMPLETED':
      return {
        title: `Zakończono: ${auction.title}`,
        lines: [
          `Zamówienie nr ${number} jest zakończone. ${money(payload.itemsTotal)} trafia na Twoje saldo.`,
        ],
        path: orderPath(number),
        actionLabel: 'Zobacz zamówienie',
      };
    case 'ORDER_NOT_PICKED_UP':
      return {
        title: `Paczka wraca: ${auction.title}`,
        lines: [
          `Kupujący nie odebrał paczki z zamówienia nr ${number}, więc wraca ona do Ciebie.`,
          'Gdy paczka dotrze, kupujący dostanie zwrot ceny i Pakietu Ochrony Kupujących, bez kosztu dostawy.',
        ],
        path: orderPath(number),
        actionLabel: 'Zobacz zamówienie',
      };
    case 'ORDER_LOST':
      return {
        title: `Zaginiona paczka: ${auction.title}`,
        lines: [
          `Kupujący zgłosił, że paczka z zamówienia nr ${number} nie dotarła. Biddy składa reklamację u przewoźnika, a kupujący dostaje zwrot.`,
          `Dostaniesz rekompensatę ${money(payload.compensation)} najpóźniej ${date(payload.compensationDueAt)}.`,
        ],
        path: orderPath(number),
        actionLabel: 'Zobacz zamówienie',
      };
    case 'ORDER_REFUNDED':
      return {
        title: `Zwrot: ${auction.title}`,
        lines: [
          `Zwróciliśmy ${money(payload.refund)} za zamówienie nr ${number}. ${payload.refundReason === undefined ? '' : REFUND_REASON_TEXT[payload.refundReason]}`.trim(),
          'Pieniądze wracają tą samą metodą płatności; bank może potrzebować kilku dni.',
        ],
        path: orderPath(number),
        actionLabel: 'Zobacz zamówienie',
      };
    case 'SECOND_CHANCE_OFFER':
      return {
        title: `Druga szansa: ${auction.title}`,
        lines: [
          `Zwycięzca nie zapłacił. Sprzedający proponuje Ci ten przedmiot za Twoją najwyższą ofertę: ${money(payload.price)}.`,
          `Oferta jest ważna do ${date(payload.expiresAt)} i nie jest wiążąca.`,
        ],
        path: secondChancePath(payload.offerId ?? ''),
        actionLabel: 'Zobacz ofertę',
      };
    case 'SECOND_CHANCE_ANSWERED':
      return answeredContent(payload, auction.title, number);
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

/** Anulowane zamówienie (F-26): po braku płatności tylko sprzedający, po braku nadania obie strony. */
function cancelledContent(
  payload: NotificationPayload,
  title: string,
  number: string,
): NotificationContent {
  if (payload.cancelReason === 'UNPAID') {
    return {
      title: `Kupujący nie zapłacił: ${title}`,
      lines: [
        `Zamówienie nr ${number} zostało anulowane, bo kupujący nie zapłacił w terminie.`,
        'Możesz wysłać ofertę drugiej szansy kolejnej osobie z licytacji albo wystawić przedmiot ponownie.',
      ],
      path: orderPath(number),
      actionLabel: 'Co dalej',
    };
  }
  return {
    title: `Zamówienie anulowane: ${title}`,
    lines:
      payload.recipientRole === 'SELLER'
        ? [
            `Paczka z zamówienia nr ${number} nie została nadana w terminie, więc zamówienie zostało anulowane, a kupujący dostaje zwrot.`,
          ]
        : [
            `Sprzedający nie nadał paczki w terminie, więc zamówienie nr ${number} zostało anulowane.`,
            'Zwracamy pełną kwotę tą samą metodą płatności.',
          ],
    path: orderPath(number),
    actionLabel: 'Zobacz zamówienie',
  };
}

/** Odpowiedź na ofertę drugiej szansy (sprzedający). */
function answeredContent(
  payload: NotificationPayload,
  title: string,
  number: string,
): NotificationContent {
  switch (payload.offerStatus) {
    case 'ACCEPTED':
      return {
        title: `Druga szansa przyjęta: ${title}`,
        lines: [
          `Licytujący kupuje przedmiot za ${money(payload.price)}. Zamówienie nr ${number} czeka na płatność do ${date(payload.paymentDueAt)}.`,
        ],
        path: orderPath(number),
        actionLabel: 'Zobacz zamówienie',
      };
    case 'DECLINED':
    case 'EXPIRED':
    case undefined:
      return {
        title:
          payload.offerStatus === 'DECLINED'
            ? `Druga szansa odrzucona: ${title}`
            : `Oferta drugiej szansy wygasła: ${title}`,
        lines: [
          'Licytujący nie skorzystał z oferty. Możesz wysłać ofertę kolejnej osobie albo wystawić przedmiot ponownie.',
        ],
        path: orderPath(number),
        actionLabel: 'Co dalej',
      };
  }
}

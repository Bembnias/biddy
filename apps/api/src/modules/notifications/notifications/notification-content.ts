// Treść powiadomień (F-20): tytuł, akapity, adres i przycisk z migawki zapisanej przy zdarzeniu.
// Te same teksty widać w centrum powiadomień (web, mobile) i w e-mailu. Bez form zależnych od płci.
import { auctionPath, formatMoney, type Money, type NotificationType } from '@biddy/shared';

/** Aukcja w migawce powiadomienia. */
export interface AuctionRef {
  readonly id: string;
  readonly publicId: string;
  readonly slug: string;
  readonly title: string;
}

/** Migawka zapisana w `notifications.payload` (pola zależne od typu). */
export interface NotificationPayload {
  readonly auction: AuctionRef;
  /** Aktualna albo wywoławcza cena. */
  readonly price?: Money;
  readonly endsAt?: string;
  readonly orderPublicId?: string;
  /** Wylicytowana kwota (wygrana, sprzedaż). */
  readonly itemsTotal?: Money;
  /** Do zapłaty z POK, bez dostawy (wygrana). */
  readonly total?: Money;
  readonly paymentDueAt?: string;
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

/** Moje aukcje (powiadomienie o braku sprzedaży). */
const MY_AUCTIONS_PATH = '/konto/aukcje';

const dateTime = new Intl.DateTimeFormat('pl-PL', {
  timeZone: 'Europe/Warsaw',
  dateStyle: 'medium',
  timeStyle: 'short',
});

const date = (iso: string | undefined) => (iso === undefined ? '' : dateTime.format(new Date(iso)));
const money = (value: Money | undefined) =>
  value === undefined ? '' : formatMoney(value, { trailingZeroDisplay: 'stripIfInteger' });

export function notificationContent(
  type: NotificationType,
  payload: NotificationPayload,
): NotificationContent {
  const { auction } = payload;
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
        path,
        actionLabel: 'Zobacz aukcję',
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

// Typy i kanały powiadomień (F-20): wspólne dla API (zapis, preferencje), web i mobile
// (ustawienia, ikony). Domyślne e-maile i to, czy da się je wyłączyć, opisuje NOTIFICATION_EMAIL.

export const NOTIFICATION_TYPES = [
  'OUTBID',
  'ENDING_SOON',
  'WON',
  'SOLD',
  'UNSOLD',
  'AUCTION_CANCELLED',
  'FOLLOWED_SELLER_NEW_AUCTION',
  'ORDER_PAID',
  'PAYMENT_REMINDER',
  'SHIP_REMINDER',
  'ORDER_CANCELLED',
  'ORDER_SHIPPED',
  'ORDER_DELIVERED',
  'ORDER_COMPLETED',
  'ORDER_NOT_PICKED_UP',
  'ORDER_LOST',
  'ORDER_REFUNDED',
  'SECOND_CHANCE_OFFER',
  'SECOND_CHANCE_ANSWERED',
  'STRIKE_ISSUED',
  'STRIKE_REVOKED',
  'ACCOUNT_BLOCKED',
  'ACCOUNT_UNBLOCKED',
  'APPEAL_REJECTED',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Kanały: w aplikacji (zawsze) i e-mail; push dojdzie w F-59 (web) i F-37 (mobile). */
export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL'] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * E-mail per typ: domyślnie włączony i czy użytkownik może go wyłączyć. Wygrana, sprzedaż,
 * opłacone zamówienie (F-24: „nadaj paczkę”) i każdy etap zamówienia z drugą szansą (F-26) to
 * e-maile transakcyjne (terminy, pieniądze, wysyłka), a strike'i, blokady i odwołania (F-61) to
 * uzasadnienia decyzji (DSA), więc wychodzą zawsze.
 */
export const NOTIFICATION_EMAIL: Readonly<
  Record<NotificationType, { readonly enabledByDefault: boolean; readonly configurable: boolean }>
> = {
  OUTBID: { enabledByDefault: true, configurable: true },
  ENDING_SOON: { enabledByDefault: true, configurable: true },
  WON: { enabledByDefault: true, configurable: false },
  SOLD: { enabledByDefault: true, configurable: false },
  UNSOLD: { enabledByDefault: true, configurable: true },
  AUCTION_CANCELLED: { enabledByDefault: true, configurable: true },
  FOLLOWED_SELLER_NEW_AUCTION: { enabledByDefault: false, configurable: true },
  ORDER_PAID: { enabledByDefault: true, configurable: false },
  PAYMENT_REMINDER: { enabledByDefault: true, configurable: false },
  SHIP_REMINDER: { enabledByDefault: true, configurable: false },
  ORDER_CANCELLED: { enabledByDefault: true, configurable: false },
  ORDER_SHIPPED: { enabledByDefault: true, configurable: false },
  ORDER_DELIVERED: { enabledByDefault: true, configurable: false },
  ORDER_COMPLETED: { enabledByDefault: true, configurable: false },
  ORDER_NOT_PICKED_UP: { enabledByDefault: true, configurable: false },
  ORDER_LOST: { enabledByDefault: true, configurable: false },
  ORDER_REFUNDED: { enabledByDefault: true, configurable: false },
  SECOND_CHANCE_OFFER: { enabledByDefault: true, configurable: false },
  SECOND_CHANCE_ANSWERED: { enabledByDefault: true, configurable: false },
  STRIKE_ISSUED: { enabledByDefault: true, configurable: false },
  STRIKE_REVOKED: { enabledByDefault: true, configurable: false },
  ACCOUNT_BLOCKED: { enabledByDefault: true, configurable: false },
  ACCOUNT_UNBLOCKED: { enabledByDefault: true, configurable: false },
  APPEAL_REJECTED: { enabledByDefault: true, configurable: false },
};

/** E-mail o przebiciu w tej samej aukcji najwyżej raz na ten czas. */
export const OUTBID_EMAIL_INTERVAL_MS = 15 * 60 * 1000;

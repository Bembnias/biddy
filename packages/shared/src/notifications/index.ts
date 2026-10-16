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
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Kanały: w aplikacji (zawsze) i e-mail; push dojdzie w F-59 (web) i F-37 (mobile). */
export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL'] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * E-mail per typ: domyślnie włączony i czy użytkownik może go wyłączyć. Wygrana i sprzedaż to
 * e-maile transakcyjne (termin płatności, wysyłka), więc wychodzą zawsze.
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
};

/** E-mail o przebiciu w tej samej aukcji najwyżej raz na ten czas. */
export const OUTBID_EMAIL_INTERVAL_MS = 15 * 60 * 1000;

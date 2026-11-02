// Limity weryfikacji telefonu (F-08, PROJECT.md §16.1). Funkcje czyste: serwis podaje czasy
// wysyłek z tabeli phone_verifications, a dostaje czas oczekiwania (0 = można wysłać).

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Kod jest ważny 5 minut. */
export const PHONE_CODE_TTL_MS = 5 * MINUTE_MS;
/** Maks. prób wpisania jednego kodu; potem kod przepada. */
export const PHONE_CODE_MAX_ATTEMPTS = 5;
/** Kolejny SMS dla tego samego konta najwcześniej po minucie. */
export const PHONE_RESEND_COOLDOWN_MS = MINUTE_MS;

/** Limity w oknach przesuwnych; najdłuższe okno to też zakres zapytania o historię. */
export const PHONE_SEND_LIMITS = {
  perPhoneNumber: { max: 3, windowMs: HOUR_MS },
  perIp: { max: 10, windowMs: HOUR_MS },
  perUser: { max: 10, windowMs: 24 * HOUR_MS },
} as const;

export const PHONE_SEND_HISTORY_MS = 24 * HOUR_MS;

/** Czasy wcześniejszych wysyłek pasujące do konta, numeru i adresu IP z żądania. */
export interface PhoneSendHistory {
  readonly byUser: readonly Date[];
  readonly byPhoneNumber: readonly Date[];
  readonly byIp: readonly Date[];
}

/** Ile trzeba czekać, aż w oknie zwolni się miejsce (0, gdy limit nie jest wyczerpany). */
function windowWaitMs(
  times: readonly Date[],
  limit: { readonly max: number; readonly windowMs: number },
  now: Date,
): number {
  const recent = times
    .map((time) => time.getTime())
    .filter((time) => now.getTime() - time < limit.windowMs)
    .sort((left, right) => left - right);
  if (recent.length < limit.max) {
    return 0;
  }
  const freesSlot = recent[recent.length - limit.max] ?? now.getTime();
  return freesSlot + limit.windowMs - now.getTime();
}

/** Czas do możliwej wysyłki: najbardziej restrykcyjny z limitów i odstępu między SMS-ami. */
export function phoneSendWaitMs(history: PhoneSendHistory, now: Date): number {
  const last = Math.max(0, ...history.byUser.map((time) => time.getTime()));
  const cooldown = last + PHONE_RESEND_COOLDOWN_MS - now.getTime();
  return Math.max(
    0,
    cooldown,
    windowWaitMs(history.byUser, PHONE_SEND_LIMITS.perUser, now),
    windowWaitMs(history.byPhoneNumber, PHONE_SEND_LIMITS.perPhoneNumber, now),
    windowWaitMs(history.byIp, PHONE_SEND_LIMITS.perIp, now),
  );
}

// Uzasadnienia strike'ów i blokad (F-61, statement of reasons z DSA): za co, z jakiego zdarzenia,
// do kiedy, co dalej i że można się odwołać. Tekst zapisujemy przy nadaniu, więc późniejsza zmiana
// polityki nie zmienia uzasadnienia. Bez form zależnych od płci.
import {
  type AccountBlockKind,
  type AccountPolicy,
  type StrikeReason,
  type StrikeRole,
} from '@biddy/shared';

/** Zdarzenie, z którego wynika strike (do treści uzasadnienia). */
export interface StrikeContext {
  /** Numer zamówienia, np. `B-4821`. */
  readonly orderPublicId?: string;
  /** Tytuł aukcji albo przedmiotu. */
  readonly title?: string;
}

const dateTime = new Intl.DateTimeFormat('pl-PL', {
  timeZone: 'Europe/Warsaw',
  dateStyle: 'long',
  timeStyle: 'short',
});

const date = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'long' });

/** Data i godzina w strefie Warszawy, np. „2 grudnia 2026 14:05”. */
export function formatWarsawDateTime(value: Date): string {
  return dateTime.format(value);
}

const APPEAL_HINT = "Możesz się odwołać w ustawieniach konta, w sekcji „Limity i strike'i”.";

function orderLabel(context: StrikeContext): string {
  const number = context.orderPublicId === undefined ? '' : ` ${context.orderPublicId}`;
  const title = context.title === undefined ? '' : ` („${context.title}”)`;
  return `zamówienie${number}${title}`;
}

function auctionLabel(context: StrikeContext): string {
  return context.title === undefined ? 'aukcja' : `aukcja „${context.title}”`;
}

/** Fakt, za który jest strike (pierwsze zdanie uzasadnienia). */
function strikeFact(reason: StrikeReason, context: StrikeContext, note?: string): string {
  switch (reason) {
    case 'UNPAID':
      return `Nie zapłacono w terminie za ${orderLabel(context)}, więc zamówienie zostało anulowane.`;
    case 'NOT_COLLECTED':
      return `Paczka z zamówienia${context.orderPublicId === undefined ? '' : ` ${context.orderPublicId}`} nie została odebrana i wraca do sprzedającego.`;
    case 'NOT_SHIPPED':
      return `Paczka z zamówienia${context.orderPublicId === undefined ? '' : ` ${context.orderPublicId}`} nie została nadana w terminie, więc zamówienie zostało anulowane, a kupujący dostał zwrot.`;
    case 'AUCTION_CANCELLED_WITH_BIDS': {
      const label = auctionLabel(context);
      return `${label.charAt(0).toUpperCase()}${label.slice(1)} została anulowana, choć miała już oferty.`;
    }
    case 'DISPUTE_LOST':
      return `Spór o ${orderLabel(context)} rozstrzygnięto na korzyść kupującego: przedmiot był niezgodny z opisem.`;
    case 'COUNTERFEIT':
      return `Potwierdziliśmy, że ${context.title === undefined ? 'wystawiony przedmiot' : `przedmiot „${context.title}”`} był podróbką.${note === undefined ? '' : ` ${note}`}`;
    case 'OTHER':
      return note ?? 'Naruszenie regulaminu Biddy.';
  }
}

const ROLE_ACTION: Readonly<Record<StrikeRole, string>> = {
  BUYER: 'licytowanie',
  SELLER: 'wystawianie aukcji',
};

/** Uzasadnienie strike'a zapisywane przy nadaniu. */
export function strikeStatement(input: {
  readonly reason: StrikeReason;
  readonly role: StrikeRole;
  readonly context: StrikeContext;
  readonly note?: string;
  readonly expiresAt: Date;
  readonly policy: AccountPolicy;
}): string {
  const { strikes } = input.policy;
  const consequence =
    input.reason === 'COUNTERFEIT'
      ? 'Wystawianie aukcji i wypłaty są zablokowane do decyzji moderatora.'
      : `Strike przestaje się liczyć ${date.format(input.expiresAt)}. ${strikes.blockThreshold} strike'i w ciągu ${String(strikes.windowDays)} dni blokują ${ROLE_ACTION[input.role]} na ${String(strikes.blockDays)} dni.`;
  return [strikeFact(input.reason, input.context, input.note), consequence, APPEAL_HINT].join(' ');
}

const BLOCK_SUBJECT: Readonly<Record<AccountBlockKind, string>> = {
  BIDDING: 'Licytowanie',
  LISTING: 'Wystawianie aukcji',
  PAYOUTS: 'Wypłaty',
};

/** Uzasadnienie blokady z progu strike'ów. */
export function strikesBlockStatement(input: {
  readonly kind: AccountBlockKind;
  readonly strikeCount: number;
  readonly endsAt: Date | null;
  readonly policy: AccountPolicy;
}): string {
  const { strikes } = input.policy;
  const subject = BLOCK_SUBJECT[input.kind];
  const cause = `w ciągu ${String(strikes.windowDays)} dni na koncie zebrały się ${String(input.strikeCount)} strike'i`;
  const head =
    input.endsAt === null
      ? `${subject} zablokowane bezterminowo: ${cause}, a to druga blokada w ciągu ${String(Math.round(strikes.escalationWindowDays / 30))} miesięcy.`
      : `${subject} zablokowane do ${formatWarsawDateTime(input.endsAt)}, bo ${cause}.`;
  return `${head} Trwające aukcje i złożone oferty pozostają ważne. ${APPEAL_HINT}`;
}

/** Uzasadnienie blokady po potwierdzonej podróbce. */
export function counterfeitBlockStatement(kind: AccountBlockKind): string {
  return `${BLOCK_SUBJECT[kind]} zablokowane do decyzji moderatora po potwierdzeniu, że przedmiot był podróbką. ${APPEAL_HINT}`;
}

/**
 * Klucz idempotencji strike'a systemowego: jedno zdarzenie (zamówienie, aukcja) daje najwyżej
 * jeden strike danego powodu, także przy ponowionym evencie.
 */
export function strikeSourceKey(reason: StrikeReason, subjectId: string): string {
  return `${reason}:${subjectId}`;
}

/** Notatka przy cofnięciu strike'a przez system po spóźnionej płatności (§6.8). */
export const LATE_PAYMENT_REVOKE_NOTE =
  'Płatność dotarła po terminie i wraca na Twoje konto, więc cofamy strike za brak płatności.';

/** Notatka przy zdjęciu blokady przez cofnięcie strike'a. */
export const STRIKE_REVOKED_LIFT_NOTE = 'Cofnęliśmy strike, który wywołał blokadę.';

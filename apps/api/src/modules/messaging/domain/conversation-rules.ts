// Reguły rozmów (F-29, decyzje nr 135–137): kiedy można zacząć rozmowę o aukcji, początek
// wiadomości na liście rozmów i fragment rozmowy w migawce zgłoszenia. Czyste funkcje.

/** Strona rozmowy z perspektywy oglądającego: sprzedający aukcji albo druga strona. */
export type ConversationRole = 'BUYER' | 'SELLER';

/** Dlaczego nie można zacząć rozmowy o aukcji. */
export type StartBlocker = 'OWN_AUCTION' | 'AUCTION_CLOSED';

/** Długość początku wiadomości na liście rozmów. */
export const PREVIEW_LENGTH = 120;

/** Wiadomości przed zgłoszoną wiadomością w migawce zgłoszenia i ostatnie przy zgłoszeniu osoby. */
export const REPORT_CONTEXT_BEFORE = 10;
export const REPORT_CONTEXT_USER = 20;

/**
 * Nowa rozmowa o aukcji: nie o własnej i tylko o aktywnej, chyba że para ma już zamówienie (wtedy
 * rozmowa dotyczy zamówienia).
 */
export function auctionStartBlocker(input: {
  readonly userId: string;
  readonly sellerId: string;
  readonly auctionStatus: string;
  readonly hasOrder: boolean;
}): StartBlocker | null {
  if (input.userId === input.sellerId) {
    return 'OWN_AUCTION';
  }
  return input.auctionStatus === 'ACTIVE' || input.hasOrder ? null : 'AUCTION_CLOSED';
}

/** Początek wiadomości w jednej linii: białe znaki skrócone, najwyżej 120 znaków z wielokropkiem. */
export function messagePreview(body: string): string {
  const line = body.replaceAll(/\s+/gu, ' ').trim();
  if (line.length <= PREVIEW_LENGTH) {
    return line;
  }
  const cut = line.slice(0, PREVIEW_LENGTH - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > PREVIEW_LENGTH / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Treść wiadomości przycięta z obu stron; zachowuje nowe linie w środku. */
export function normalizeBody(body: string): string {
  return body.trim();
}

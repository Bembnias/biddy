import { money } from '@biddy/shared';
import { describe, expect, it } from 'vitest';

import { notificationContent, type NotificationPayload } from './notification-content.js';
import { createUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribe-token.js';

const AUCTION = {
  id: '01960000-0000-7000-8000-0000000000a1',
  publicId: 'k3x9qa7m',
  slug: 'wazon-ceramiczny',
  title: 'Wazon ceramiczny',
};

const text = (value: string) => value.replaceAll(' ', ' ');

describe('notificationContent', () => {
  it('przebicie: cena, koniec, adres aukcji i przycisk', () => {
    const content = notificationContent('OUTBID', {
      auction: AUCTION,
      price: money(2_500),
      endsAt: '2026-10-20T18:00:00.000Z',
    });
    expect(content.title).toBe('Przebito Twoją ofertę');
    expect(content.lines.map(text)).toEqual([
      '„Wazon ceramiczny”: aktualna cena 25 zł.',
      'Zalicytuj ponownie przed końcem aukcji (20 paź 2026, 20:00).',
    ]);
    expect(content.path).toBe('/a/wazon-ceramiczny-k3x9qa7m');
    expect(content.actionLabel).toBe('Licytuj ponownie');
  });

  it('wygrana, sprzedaż, brak sprzedaży, anulowanie i nowa aukcja sprzedawcy', () => {
    const order: NotificationPayload = {
      auction: AUCTION,
      orderPublicId: 'p7q2m4nx',
      itemsTotal: money(10_000),
      total: money(10_999),
      paymentDueAt: '2026-10-21T18:00:00.000Z',
    };
    const won = notificationContent('WON', order);
    expect(won.title).toBe('Wygrana: Wazon ceramiczny');
    expect(text(won.lines.join(' '))).toContain(
      'Do zapłaty z Pakietem Ochrony Kupujących: 109,99 zł',
    );
    expect(won).toMatchObject({ path: '/zamowienia/p7q2m4nx/zaplac', actionLabel: 'Zapłać' });
    expect(text(notificationContent('SOLD', order).lines[0] ?? '')).toBe(
      'Przedmiot sprzedany za 100 zł.',
    );
    const unsold = notificationContent('UNSOLD', { auction: AUCTION, reason: 'RESERVE_NOT_MET' });
    expect(unsold.lines[0]).toContain('nie osiągnęła ceny minimalnej');
    expect(unsold.path).toBe('/moje-biddy/aukcje');
    expect(
      notificationContent('AUCTION_CANCELLED', { auction: AUCTION, cancelledBy: 'MODERATOR' })
        .lines[0],
    ).toBe('„Wazon ceramiczny”: aukcja została anulowana przez moderację Biddy.');
    expect(
      notificationContent('FOLLOWED_SELLER_NEW_AUCTION', {
        auction: AUCTION,
        sellerName: 'Ania',
        price: money(1_000),
        endsAt: '2026-10-20T18:00:00.000Z',
      }).title,
    ).toBe('Nowa aukcja: Ania');
  });
});

describe('powiadomienia o koncie (F-61)', () => {
  it('etapy zamówienia (F-26): przypomnienia, nadanie, odbiór, zakończenie i zwrot', () => {
    const base = { auction: AUCTION, orderPublicId: 'p7q2m4nx' };
    const reminder = notificationContent('PAYMENT_REMINDER', {
      ...base,
      total: money(10_999),
      paymentDueAt: '2026-10-21T18:00:00.000Z',
    });
    expect(reminder).toMatchObject({
      title: 'Zapłać za: Wazon ceramiczny',
      path: '/zamowienia/p7q2m4nx/zaplac',
      actionLabel: 'Zapłać',
    });
    expect(text(reminder.lines[0] ?? '')).toContain('do 21 paź 2026, 20:00');
    expect(
      notificationContent('SHIP_REMINDER', { ...base, shipBy: '2026-10-28T22:59:59.999Z' }),
    ).toMatchObject({ path: '/zamowienia/p7q2m4nx/nadaj', actionLabel: 'Nadaj paczkę' });
    expect(
      notificationContent('ORDER_SHIPPED', {
        ...base,
        carrierName: 'InPost Paczkomat',
        trackingNumber: 'FAKE123',
      }).lines[0],
    ).toBe('Sprzedający nadał paczkę: InPost Paczkomat, numer przesyłki FAKE123.');
    const delivered = notificationContent('ORDER_DELIVERED', {
      ...base,
      inspectionEndsAt: '2026-10-23T06:15:00.000Z',
    });
    expect(delivered).toMatchObject({
      path: '/zamowienia/p7q2m4nx',
      actionLabel: 'Sprawdź i potwierdź',
    });
    expect(text(delivered.lines[0] ?? '')).toContain('do 23 paź 2026, 08:15');
    expect(
      text(
        notificationContent('ORDER_COMPLETED', { ...base, itemsTotal: money(10_000) }).lines[0] ??
          '',
      ),
    ).toContain('100 zł trafia na Twoje saldo');
    const refunded = notificationContent('ORDER_REFUNDED', {
      ...base,
      refund: money(10_999),
      refundReason: 'NOT_PICKED_UP',
    });
    expect(text(refunded.lines[0] ?? '')).toBe(
      'Zwróciliśmy 109,99 zł za zamówienie nr p7q2m4nx. Paczka nie została odebrana, więc zwrot nie obejmuje dostawy.',
    );
  });

  it('anulowanie i druga szansa (F-26): treść zależy od powodu, roli i odpowiedzi', () => {
    const base = { auction: AUCTION, orderPublicId: 'p7q2m4nx' };
    expect(
      notificationContent('ORDER_CANCELLED', { ...base, cancelReason: 'UNPAID' }),
    ).toMatchObject({
      title: 'Kupujący nie zapłacił: Wazon ceramiczny',
      actionLabel: 'Co dalej',
    });
    const buyer = notificationContent('ORDER_CANCELLED', {
      ...base,
      cancelReason: 'NOT_SHIPPED',
      recipientRole: 'BUYER',
    });
    expect(buyer.lines[1]).toBe('Zwracamy pełną kwotę tą samą metodą płatności.');
    const offer = notificationContent('SECOND_CHANCE_OFFER', {
      auction: AUCTION,
      offerId: 'oferta-1',
      price: money(4_500),
      expiresAt: '2026-10-22T18:00:00.000Z',
    });
    expect(offer).toMatchObject({ path: '/druga-szansa/oferta-1', actionLabel: 'Zobacz ofertę' });
    expect(text(offer.lines[0] ?? '')).toContain('Twoją najwyższą ofertę: 45 zł');
    expect(
      notificationContent('SECOND_CHANCE_ANSWERED', { ...base, offerStatus: 'EXPIRED' }).title,
    ).toBe('Oferta drugiej szansy wygasła: Wazon ceramiczny');
    expect(
      notificationContent('SECOND_CHANCE_ANSWERED', {
        ...base,
        offerStatus: 'ACCEPTED',
        price: money(4_500),
        paymentDueAt: '2026-10-22T18:00:00.000Z',
      }).path,
    ).toBe('/zamowienia/p7q2m4nx');
  });

  it('strike: uzasadnienie i link do limitów', () => {
    const content = notificationContent('STRIKE_ISSUED', {
      account: { reason: 'UNPAID', statement: 'Nie zapłacono w terminie.' },
    });
    expect(content).toEqual({
      title: 'Strike: brak płatności',
      lines: ['Nie zapłacono w terminie.'],
      path: '/konto/limity',
      actionLabel: 'Zobacz szczegóły',
    });
  });

  it('blokada, zdjęcie blokady i odrzucone odwołanie', () => {
    expect(
      notificationContent('ACCOUNT_BLOCKED', { account: { kind: 'BIDDING', statement: 'x' } })
        .title,
    ).toBe('Blokada licytowania');
    expect(
      notificationContent('ACCOUNT_UNBLOCKED', { account: { kind: 'LISTING', statement: 'x' } })
        .title,
    ).toBe('Zdjęto blokadę wystawiania aukcji');
    expect(
      notificationContent('APPEAL_REJECTED', {
        account: { subject: 'STRIKE', reason: 'NOT_COLLECTED', statement: 'Decyzja w mocy.' },
      }),
    ).toMatchObject({
      title: "Odwołanie od strike'a nieuwzględnione: nieodebrana paczka",
      lines: ['Decyzja w mocy.'],
    });
  });
});

describe('wypłaty (F-27)', () => {
  it('wypłata wysłana: kwota, rachunek i zdanie o wypłacie automatycznej', () => {
    const manual = notificationContent('PAYOUT_PAID', {
      payout: { amount: money(12_345), bankAccountMasked: '•••• 2874', trigger: 'MANUAL' },
    });
    expect(text(manual.title)).toBe('Wypłata 123,45 zł wysłana');
    expect(manual.lines.map(text)).toEqual([
      'Wysłaliśmy 123,45 zł na rachunek •••• 2874. Pieniądze dotrą zwykle w 1–2 dni robocze.',
    ]);
    expect(manual).toMatchObject({ path: '/konto/saldo', actionLabel: 'Saldo i wypłaty' });
    const dormant = notificationContent('PAYOUT_PAID', {
      payout: { amount: money(1_200), bankAccountMasked: '•••• 2874', trigger: 'DORMANT_BALANCE' },
    });
    expect(dormant.lines.at(-1)).toBe(
      'Saldo poniżej 20 zł bez sprzedaży od 90 dni wypłacamy automatycznie.',
    );
  });

  it('wypłata nieudana: środki na saldzie, wskazówka zależna od powodu', () => {
    const rejected = notificationContent('PAYOUT_FAILED', {
      payout: { amount: money(5_000), failureReason: 'REJECTED' },
    });
    expect(text(rejected.title)).toBe('Wypłata 50 zł nie powiodła się');
    expect(rejected.lines).toEqual([
      'Pieniądze wróciły na saldo w Biddy.',
      'Sprawdź numer rachunku w danych do wypłat i spróbuj ponownie.',
    ]);
    const kyc = notificationContent('PAYOUT_FAILED', {
      payout: { amount: money(5_000), failureReason: 'SELLER_NOT_VERIFIED' },
    });
    expect(kyc.lines[1]).toBe('Wypłata wymaga weryfikacji tożsamości u operatora płatności.');
  });

  it('rachunek: pierwszy bez blokady, zmiana z terminem wypłat; zawsze ostrzeżenie o przejęciu', () => {
    const first = notificationContent('PAYOUT_ACCOUNT_CHANGED', {
      payout: { bankAccountMasked: '•••• 2874', first: true, blockedUntil: null },
    });
    expect(first).toEqual({
      title: 'Dodano rachunek do wypłat',
      lines: [
        'Wypłaty trafią na rachunek •••• 2874.',
        'Jeśli to nie Ty, od razu zmień hasło i napisz do nas.',
      ],
      path: '/konto/saldo/dane',
      actionLabel: 'Dane do wypłat',
    });
    const changed = notificationContent('PAYOUT_ACCOUNT_CHANGED', {
      payout: {
        bankAccountMasked: '•••• 1111',
        first: false,
        blockedUntil: '2026-11-04T13:02:00.000Z',
      },
    });
    expect(changed.title).toBe('Zmieniono rachunek do wypłat');
    expect(text(changed.lines[0] ?? '')).toBe(
      'Nowy rachunek do wypłat: •••• 1111. Ze względów bezpieczeństwa wypłaty ruszą 4 lis 2026, 14:02.',
    );
  });
});

describe('oceny (F-30)', () => {
  const review = {
    orderPublicId: 'K3X9QA7M',
    title: 'Lampa biurkowa',
    authorRole: 'BUYER' as const,
  };

  it('zaproszenie do oceny: termin, bez gwiazdek', () => {
    const content = notificationContent('REVIEW_REQUESTED', {
      review: { ...review, rateUntil: '2026-11-12T10:00:00.000Z', rating: 1 },
    });
    expect(content.title).toBe('Oceń zamówienie: Lampa biurkowa');
    expect(content.lines[0]).toContain('nr K3X9QA7M');
    expect(content.lines[0]).toContain('12 lis 2026');
    expect(content.lines.join(' ')).not.toMatch(/\d\/5/u);
    expect(content.path).toBe('/zamowienia/K3X9QA7M');
    expect(content.actionLabel).toBe('Oceń zamówienie');
  });

  it('nowa ocena: gwiazdki i rola autora', () => {
    const content = notificationContent('REVIEW_RECEIVED', {
      review: { ...review, authorRole: 'SELLER', rating: 4 },
    });
    expect(content.title).toBe('Nowa ocena: 4/5');
    expect(content.lines[0]).toBe(
      'Ocena od sprzedającego za zamówienie „Lampa biurkowa” (nr K3X9QA7M) jest już widoczna na Twoim profilu.',
    );
    expect(content.path).toBe('/zamowienia/K3X9QA7M');
  });
});

describe('token wypisania', () => {
  const secret = 'test-secret-0123456789-0123456789';
  const userId = '01960000-0000-7000-8000-000000000001';

  it('podpisany token wraca z użytkownikiem i zakresem', () => {
    const token = createUnsubscribeToken(secret, userId, 'OUTBID');
    expect(verifyUnsubscribeToken(secret, token)).toEqual({ userId, scope: 'OUTBID' });
    expect(verifyUnsubscribeToken(secret, createUnsubscribeToken(secret, userId, 'ALL'))).toEqual({
      userId,
      scope: 'ALL',
    });
  });

  it('zmieniony zakres, inny sekret albo zły format: null', () => {
    const token = createUnsubscribeToken(secret, userId, 'OUTBID');
    const [, signature] = token.split('.');
    const forged = `${Buffer.from(`${userId}:ALL`).toString('base64url')}.${signature ?? ''}`;
    expect(verifyUnsubscribeToken(secret, forged)).toBeNull();
    expect(verifyUnsubscribeToken('inny-sekret-0123456789-0123456789', token)).toBeNull();
    expect(verifyUnsubscribeToken(secret, 'bez-kropki')).toBeNull();
    expect(
      verifyUnsubscribeToken(secret, createUnsubscribeToken(secret, 'nie-uuid', 'OUTBID')),
    ).toBeNull();
  });
});

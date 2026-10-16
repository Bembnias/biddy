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
    expect(text(notificationContent('SOLD', order).lines[0] ?? '')).toBe(
      'Przedmiot sprzedany za 100 zł.',
    );
    const unsold = notificationContent('UNSOLD', { auction: AUCTION, reason: 'RESERVE_NOT_MET' });
    expect(unsold.lines[0]).toContain('nie osiągnęła ceny minimalnej');
    expect(unsold.path).toBe('/konto/aukcje');
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

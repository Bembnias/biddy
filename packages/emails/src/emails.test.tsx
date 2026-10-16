import { describe, expect, it } from 'vitest';

import { notificationEmail, resetPasswordEmail, verificationEmail } from './index.js';

describe('notificationEmail', () => {
  it('temat, treść, przycisk i stopka z wypisaniem i ustawieniami', async () => {
    const email = await notificationEmail({
      recipientName: 'Kasia',
      title: 'Przebito Twoją ofertę',
      lines: ['„Wazon ceramiczny”: aktualna cena 25 zł.', 'Zalicytuj ponownie <b>teraz</b>.'],
      action: { label: 'Licytuj ponownie', url: 'https://biddy.pl/a/wazon-k3x9qa7m' },
      settingsUrl: 'https://biddy.pl/konto/powiadomienia',
      unsubscribeUrl: 'https://biddy.pl/wypisz?token=abc',
    });
    expect(email.subject).toBe('Przebito Twoją ofertę');
    expect(email.html).toMatch(/<html[^>]*lang="pl"/u);
    expect(email.html).toContain('href="https://biddy.pl/a/wazon-k3x9qa7m"');
    expect(email.html).toContain('href="https://biddy.pl/wypisz?token=abc"');
    expect(email.html).toContain('Ustawienia powiadomień');
    // Treść od użytkownika jest escapowana.
    expect(email.html).toContain('&lt;b&gt;teraz&lt;/b&gt;');
    expect(email.text).toContain('Cześć Kasia,');
    expect(email.text).toContain('„Wazon ceramiczny”: aktualna cena 25 zł.');
    expect(email.text).toContain('https://biddy.pl/a/wazon-k3x9qa7m');
    expect(email.text).toContain('Wypisz się');
  });

  it('e-mail transakcyjny bez wypisania', async () => {
    const email = await notificationEmail({
      recipientName: 'Kasia',
      title: 'Wygrana: Wazon ceramiczny',
      lines: ['Zapłać 109,99 zł do 16 paź 2026, 14:00.'],
      action: { label: 'Zobacz aukcję', url: 'https://biddy.pl/a/wazon-k3x9qa7m' },
      settingsUrl: 'https://biddy.pl/konto/powiadomienia',
    });
    expect(email.html).not.toContain('Wypisz się');
    expect(email.html).not.toContain('Ustawienia powiadomień');
  });
});

describe('e-maile kont', () => {
  it('weryfikacja adresu i reset hasła z linkiem', async () => {
    const verification = await verificationEmail({
      recipientName: 'Kasia',
      url: 'https://api.biddy.pl/v1/auth/verify-email?token=t',
    });
    expect(verification.subject).toBe('Potwierdź adres e-mail w Biddy');
    expect(verification.html).toContain('href="https://api.biddy.pl/v1/auth/verify-email?token=t"');
    expect(verification.text).toContain('Link jest ważny 24 godziny.');
    const reset = await resetPasswordEmail({ recipientName: 'Kasia', url: 'https://x.test/r' });
    expect(reset.subject).toBe('Zmiana hasła w Biddy');
    expect(reset.text).toContain('https://x.test/r');
  });
});

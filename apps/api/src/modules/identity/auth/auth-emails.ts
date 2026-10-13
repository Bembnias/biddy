// Treść e-maili kont (weryfikacja adresu, reset hasła): tekst i prosty HTML. Szablony w React
// Email (packages/emails) powstaną z powiadomieniami (F-20).
import type { MailMessage } from '../../../infra/mail/index.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

interface Recipient {
  readonly email: string;
  readonly name: string;
}

function message(
  to: Recipient,
  subject: string,
  lines: readonly string[],
  link: { label: string; url: string },
): MailMessage {
  const greeting = `Cześć ${to.name},`;
  return {
    to: to.email,
    subject,
    text: [greeting, '', ...lines, '', `${link.label}: ${link.url}`, '', 'Zespół Biddy'].join('\n'),
    html: [
      `<p>${escapeHtml(greeting)}</p>`,
      ...lines.map((line) => `<p>${escapeHtml(line)}</p>`),
      `<p><a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a></p>`,
      '<p>Zespół Biddy</p>',
    ].join('\n'),
  };
}

export function verificationEmail(to: Recipient, url: string): MailMessage {
  return message(
    to,
    'Potwierdź adres e-mail w Biddy',
    [
      'dziękujemy za założenie konta. Potwierdź adres e-mail, żeby licytować i wystawiać przedmioty.',
      'Link jest ważny 24 godziny. Jeśli to nie Ty, zignoruj tę wiadomość: bez kliknięcia w link konto pozostanie niepotwierdzone.',
    ],
    { label: 'Potwierdź adres e-mail', url },
  );
}

export function resetPasswordEmail(to: Recipient, url: string): MailMessage {
  return message(
    to,
    'Zmiana hasła w Biddy',
    [
      'otrzymaliśmy prośbę o zmianę hasła do Twojego konta.',
      'Link jest ważny 1 godzinę i działa jeden raz. Po zmianie hasła wylogujemy Cię ze wszystkich urządzeń. Jeśli to nie Ty, zignoruj tę wiadomość: hasło się nie zmieni.',
    ],
    { label: 'Ustaw nowe hasło', url },
  );
}

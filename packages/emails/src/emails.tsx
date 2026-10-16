// E-maile Biddy (F-20): powiadomienia (treść z modułu notifications w API, ta sama co w aplikacji)
// i e-maile kont (F-07). Każda funkcja zwraca temat, HTML i wersję tekstową.
import { render } from '@react-email/components';
import type { ReactElement } from 'react';

import { type EmailAction, EmailLayout, Paragraph } from './layout.js';

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

async function rendered(subject: string, element: ReactElement): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}

export interface NotificationEmailInput {
  /** Imię odbiorcy (powitanie). */
  readonly recipientName: string;
  /** Temat i nagłówek, np. „Przebito Twoją ofertę”. */
  readonly title: string;
  /** Akapity treści. */
  readonly lines: readonly string[];
  readonly action: EmailAction;
  /** Ustawienia powiadomień (stopka). */
  readonly settingsUrl: string;
  /** Wypisanie jednym kliknięciem; brak = e-mail transakcyjny (zawsze wysyłany). */
  readonly unsubscribeUrl?: string | undefined;
}

/** E-mail z powiadomieniem (przebicie, koniec aukcji, wygrana, sprzedaż…). */
export function notificationEmail(input: NotificationEmailInput): Promise<RenderedEmail> {
  return rendered(
    input.title,
    <EmailLayout
      preview={input.lines[0] ?? input.title}
      heading={input.title}
      action={input.action}
      footer={{
        unsubscribeUrl: input.unsubscribeUrl,
        settingsUrl: input.unsubscribeUrl === undefined ? undefined : input.settingsUrl,
      }}
    >
      <Paragraph>Cześć {input.recipientName},</Paragraph>
      {input.lines.map((line) => (
        <Paragraph key={line}>{line}</Paragraph>
      ))}
    </EmailLayout>,
  );
}

interface AccountEmailInput {
  readonly recipientName: string;
  readonly url: string;
}

/** Potwierdzenie adresu e-mail po rejestracji (F-07). */
export function verificationEmail(input: AccountEmailInput): Promise<RenderedEmail> {
  return rendered(
    'Potwierdź adres e-mail w Biddy',
    <EmailLayout
      preview="Potwierdź adres e-mail, żeby licytować i wystawiać przedmioty."
      heading="Potwierdź adres e-mail"
      action={{ label: 'Potwierdź adres e-mail', url: input.url }}
    >
      <Paragraph>Cześć {input.recipientName},</Paragraph>
      <Paragraph>
        dziękujemy za założenie konta. Potwierdź adres e-mail, żeby licytować i wystawiać
        przedmioty.
      </Paragraph>
      <Paragraph>
        Link jest ważny 24 godziny. Jeśli to nie Ty, zignoruj tę wiadomość: bez kliknięcia w link
        konto pozostanie niepotwierdzone.
      </Paragraph>
    </EmailLayout>,
  );
}

/** Link do zmiany hasła (F-07). */
export function resetPasswordEmail(input: AccountEmailInput): Promise<RenderedEmail> {
  return rendered(
    'Zmiana hasła w Biddy',
    <EmailLayout
      preview="Ustaw nowe hasło do konta Biddy."
      heading="Zmiana hasła"
      action={{ label: 'Ustaw nowe hasło', url: input.url }}
    >
      <Paragraph>Cześć {input.recipientName},</Paragraph>
      <Paragraph>otrzymaliśmy prośbę o zmianę hasła do Twojego konta.</Paragraph>
      <Paragraph>
        Link jest ważny 1 godzinę i działa jeden raz. Po zmianie hasła wylogujemy Cię ze wszystkich
        urządzeń. Jeśli to nie Ty, zignoruj tę wiadomość: hasło się nie zmieni.
      </Paragraph>
    </EmailLayout>,
  );
}

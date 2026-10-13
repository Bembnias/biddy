import { describe, expect, it } from 'vitest';

import { resetPasswordEmail, verificationEmail } from './auth-emails.js';

const URL_WITH_TOKEN =
  'https://api.biddy.pl/v1/auth/verify-email?token=abc&callbackURL=https://biddy.pl/x';

describe('e-maile kont', () => {
  it('weryfikacja: adresat, temat, link w tekście i HTML', () => {
    const message = verificationEmail({ email: 'jan@example.com', name: 'Jan' }, URL_WITH_TOKEN);
    expect(message).toMatchObject({
      to: 'jan@example.com',
      subject: 'Potwierdź adres e-mail w Biddy',
    });
    expect(message.text).toContain(URL_WITH_TOKEN);
    expect(message.html).toContain(
      'href="https://api.biddy.pl/v1/auth/verify-email?token=abc&amp;callbackURL=',
    );
  });

  it('imię z formularza jest escapowane w HTML (bez wstrzyknięcia znaczników)', () => {
    const message = resetPasswordEmail(
      { email: 'a@b.pl', name: '<script>alert(1)</script>' },
      URL_WITH_TOKEN,
    );
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
  });
});

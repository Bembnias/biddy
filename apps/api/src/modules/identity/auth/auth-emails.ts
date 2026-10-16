// E-maile kont (weryfikacja adresu, reset hasła): szablony React Email z @biddy/emails (F-20).
import {
  resetPasswordEmail as renderResetPassword,
  verificationEmail as renderVerification,
} from '@biddy/emails';

import type { MailMessage } from '../../../infra/mail/index.js';

interface Recipient {
  readonly email: string;
  readonly name: string;
}

export async function verificationEmail(to: Recipient, url: string): Promise<MailMessage> {
  return { to: to.email, ...(await renderVerification({ recipientName: to.name, url })) };
}

export async function resetPasswordEmail(to: Recipient, url: string): Promise<MailMessage> {
  return { to: to.email, ...(await renderResetPassword({ recipientName: to.name, url })) };
}

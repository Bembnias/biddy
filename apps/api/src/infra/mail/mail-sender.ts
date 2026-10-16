// Wysyłka e-maili przez adapter (ADR-7): SMTP lokalnie (Mailpit) albo Resend na produkcji
// (PROJECT.md §11.2). Moduły nie wysyłają e-maili same: dodają job `email.send` (MailQueue),
// a wysyła go worker, z ponowieniami przy awarii dostawcy.
import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import type { AppConfig } from '../config/index.js';

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /** Dodatkowe nagłówki, np. List-Unsubscribe (RFC 8058) w e-mailach z powiadomieniami. */
  readonly headers?: Readonly<Record<string, string>> | undefined;
}

export interface MailSender {
  send(message: MailMessage): Promise<void>;
}

/** Token DI {@link MailSender}. */
export const MAIL_SENDER = Symbol('MAIL_SENDER');

export class SmtpMailSender implements MailSender {
  private readonly transporter: Transporter;

  constructor(
    private readonly from: string,
    options: { host: string; port: number; user: string | undefined; password: string | undefined },
  ) {
    this.transporter = createTransport({
      host: options.host,
      port: options.port,
      secure: options.port === 465,
      ...(options.user === undefined
        ? {}
        : { auth: { user: options.user, pass: options.password ?? '' } }),
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      ...message,
      ...(message.headers === undefined ? {} : { headers: { ...message.headers } }),
    });
  }
}

/** Resend przez HTTP API (bez SDK): https://resend.com/docs/api-reference/emails/send-email */
export class ResendMailSender implements MailSender {
  constructor(
    private readonly from: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const response = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from, ...message }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Resend odrzucił e-mail: HTTP ${response.status} ${await response.text()}`);
    }
  }
}

export function createMailSender(config: AppConfig['mail']): MailSender {
  const { transport } = config;
  new Logger('Mail').log(
    transport.kind === 'resend'
      ? 'E-maile wysyła Resend'
      : `E-maile wysyła SMTP ${transport.host}:${transport.port}`,
  );
  return transport.kind === 'resend'
    ? new ResendMailSender(config.from, transport.apiKey)
    : new SmtpMailSender(config.from, transport);
}

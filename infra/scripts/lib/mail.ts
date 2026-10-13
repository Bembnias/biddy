// Test poczty lokalnej: wysyłka przez SMTP do Mailpit i potwierdzenie przez jego API HTTP.
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { createTransport } from 'nodemailer';
import { z } from 'zod';

import type { InfraEnv } from '../env.js';
import { CliError } from './cli.js';

const TEST_RECIPIENT = 'test@biddy.local';
const DELIVERY_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 250;

// Tylko pola, których używamy (GET /api/v1/messages w Mailpit).
const mailpitMessages = z.object({
  messages: z.array(z.object({ ID: z.string(), MessageID: z.string(), Subject: z.string() })),
});

/** Adres w interfejsie Mailpit (z zachowaniem ewentualnej ścieżki bazowej w MAILPIT_UI_URL). */
function mailpitUrl(env: InfraEnv, path: string): URL {
  const base = env.MAILPIT_UI_URL.endsWith('/') ? env.MAILPIT_UI_URL : `${env.MAILPIT_UI_URL}/`;
  return new URL(path, base);
}

export interface DeliveredMail {
  subject: string;
  /** Link do podglądu wiadomości w interfejsie Mailpit. */
  viewUrl: string;
}

async function sendViaSmtp(env: InfraEnv, subject: string, token: string): Promise<string> {
  const transport = createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: false,
    auth:
      env.SMTP_USER === undefined
        ? undefined
        : { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' },
    connectionTimeout: 5000,
  });
  try {
    const info = await transport.sendMail({
      from: env.MAIL_FROM,
      to: TEST_RECIPIENT,
      subject,
      headers: { 'X-Biddy-Mail-Test': token },
      text: [
        'Cześć!',
        '',
        'To testowa wiadomość z `pnpm mail:test`. Skoro ją widzisz w Mailpit, lokalna poczta działa:',
        'wszystko, co aplikacja wyśle przez SMTP, trafia tutaj, a nie do prawdziwych skrzynek.',
        '',
        'Zespół Biddy',
      ].join('\n'),
      html: [
        '<p>Cześć!</p>',
        '<p>To testowa wiadomość z <code>pnpm mail:test</code>. Skoro ją widzisz w Mailpit, lokalna poczta działa:',
        'wszystko, co aplikacja wyśle przez SMTP, trafia tutaj, a nie do prawdziwych skrzynek.</p>',
        '<p>Zespół Biddy</p>',
      ].join('\n'),
    });
    return info.messageId;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CliError(
      `Nie udało się wysłać maila przez SMTP ${env.SMTP_HOST}:${env.SMTP_PORT} (${reason}).`,
      [
        'Czy infrastruktura działa? Uruchom: pnpm infra:up',
        'Sprawdź SMTP_HOST i SMTP_PORT w .env (`pnpm env:check`).',
      ],
      { cause: error },
    );
  } finally {
    transport.close();
  }
}

async function findInMailpit(env: InfraEnv, messageId: string): Promise<string | undefined> {
  const url = mailpitUrl(env, 'api/v1/messages?limit=50');
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(3000) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CliError(
      `Mail wysłany, ale API Mailpit pod ${env.MAILPIT_UI_URL} nie odpowiada (${reason}).`,
      ['Sprawdź MAILPIT_UI_URL i MAILPIT_UI_PORT w .env (`pnpm env:check`).'],
      { cause: error },
    );
  }
  if (!response.ok) {
    const hints =
      response.status === 403
        ? [
            'Mailpit przyjmuje tylko nagłówek Host localhost albo 127.0.0.1 (MP_ALLOWED_HOSTS w infra/docker-compose.yml).',
            'Użyj w MAILPIT_UI_URL hosta localhost albo 127.0.0.1, np. http://localhost:8025.',
          ]
        : ['Logi Mailpit: pnpm infra:logs'];
    throw new CliError(`API Mailpit zwróciło HTTP ${response.status} dla ${url.href}.`, hints);
  }
  const { messages } = mailpitMessages.parse(await response.json());
  // Nodemailer zwraca Message-ID w nawiasach ostrych, Mailpit przechowuje go bez nich.
  const wanted = messageId.replace(/^<|>$/g, '');
  return messages.find((message) => message.MessageID === wanted)?.ID;
}

/** Wysyła testowy mail i czeka, aż pojawi się w Mailpit. Rzuca CliError, gdy nie dotrze. */
export async function sendTestMail(env: InfraEnv): Promise<DeliveredMail> {
  const token = randomUUID();
  const subject = `Biddy: test poczty lokalnej (${token.slice(0, 8)})`;
  const messageId = await sendViaSmtp(env, subject, token);

  const deadline = Date.now() + DELIVERY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const id = await findInMailpit(env, messageId);
    if (id !== undefined) {
      return { subject, viewUrl: mailpitUrl(env, `view/${id}`).href };
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new CliError(
    `Serwer SMTP przyjął mail, ale po ${DELIVERY_TIMEOUT_MS / 1000} s nie ma go w Mailpit.`,
    [
      'SMTP_HOST/SMTP_PORT i MAILPIT_UI_URL wskazują chyba na różne serwery.',
      'Logi Mailpit: pnpm infra:logs',
    ],
  );
}

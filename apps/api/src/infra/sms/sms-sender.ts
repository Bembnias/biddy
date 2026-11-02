// Wysyłka SMS-ów przez adapter (ADR-7): SMSAPI na produkcji (PROJECT.md §11.2), lokalnie
// i w testach atrapa, która zapisuje treść w logu i w pamięci (testy czytają z niej kody).
// Wysyłka jest synchroniczna (bez kolejki): kod weryfikacyjny żyje kilka minut, więc
// użytkownik ma od razu dostać błąd i spróbować ponownie, a nie czekać na ponowienia workera.
import { Logger } from '@nestjs/common';

import type { SmsTransportConfig } from '../config/index.js';

export interface SmsMessage {
  /** Numer w formacie E.164, np. `+48500600700`. */
  readonly to: string;
  readonly text: string;
}

export interface SmsSender {
  send(message: SmsMessage): Promise<void>;
}

/** Token DI {@link SmsSender}. */
export const SMS_SENDER = Symbol('SMS_SENDER');

/** Dostawca odrzucił SMS albo nie odpowiedział. */
export class SmsSendError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SmsSendError';
  }
}

/**
 * SMSAPI przez HTTP API (bez SDK): https://www.smsapi.pl/docs#2-pojedynczy-sms. Błąd dostawca
 * zwraca jako `{ error, message }`, czasem ze statusem 200, więc sprawdzamy treść odpowiedzi.
 */
export class SmsapiSmsSender implements SmsSender {
  static readonly URL = 'https://api.smsapi.pl/sms.do';

  constructor(
    private readonly token: string,
    private readonly sender: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: SmsMessage): Promise<void> {
    const body = new URLSearchParams({
      to: message.to.replace(/^\+/, ''),
      message: message.text,
      format: 'json',
      encoding: 'utf-8',
      ...(this.sender === undefined ? {} : { from: this.sender }),
    });
    let response: Response;
    try {
      response = await this.fetchImpl(SmsapiSmsSender.URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.token}` },
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new SmsSendError('SMSAPI nie odpowiada', { cause: error });
    }
    const text = await response.text();
    let result: unknown;
    try {
      result = JSON.parse(text);
    } catch {
      result = undefined;
    }
    const failure =
      typeof result === 'object' && result !== null && 'error' in result
        ? (result as { error: unknown; message?: unknown })
        : undefined;
    if (!response.ok || failure !== undefined || result === undefined) {
      const reason =
        failure === undefined
          ? `HTTP ${response.status}`
          : `kod ${JSON.stringify(failure.error)}: ${typeof failure.message === 'string' ? failure.message : ''}`;
      throw new SmsSendError(`SMSAPI odrzucił SMS (${reason})`);
    }
  }
}

/**
 * Atrapa lokalnie i w testach: SMS trafia do logu API (tam deweloper znajdzie kod), a ostatnie
 * wiadomości zostają w pamięci. Na produkcji niedostępna (konfiguracja wymaga SMSAPI_TOKEN).
 */
export class LoggingSmsSender implements SmsSender {
  private static readonly KEEP = 100;
  private readonly logger = new Logger('Sms');
  readonly sent: SmsMessage[] = [];

  send(message: SmsMessage): Promise<void> {
    this.sent.push(message);
    this.sent.splice(0, Math.max(0, this.sent.length - LoggingSmsSender.KEEP));
    this.logger.log(`SMS (atrapa) do ${message.to}: ${message.text}`);
    return Promise.resolve();
  }

  /** Ostatni SMS wysłany na numer (testy). */
  lastTo(phoneNumber: string): SmsMessage | undefined {
    return this.sent.findLast((message) => message.to === phoneNumber);
  }
}

export function createSmsSender(config: SmsTransportConfig): SmsSender {
  const logger = new Logger('Sms');
  if (config.kind === 'smsapi') {
    logger.log('SMS-y wysyła SMSAPI');
    return new SmsapiSmsSender(config.token, config.sender);
  }
  logger.log('SMS-y trafiają do logu (atrapa, brak SMSAPI_TOKEN)');
  return new LoggingSmsSender();
}

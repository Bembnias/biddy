// Klient HTTP API Furgonetki (F-24): token OAuth z bazy (logowanie hasłem raz na instalację,
// potem odświeżanie), wersja endpointu w nagłówkach Accept i Content-Type, komendy z UUID
// i odpytywaniem stanu oraz mapowanie błędów na ShippingProviderError. Błąd sieci, 429 i 5xx to
// UNAVAILABLE (ponowienie joba), dane odrzucone przez Furgonetkę to INVALID_REQUEST.
import { Logger } from '@nestjs/common';

import type { FurgonetkaConfig } from '../../../../infra/config/index.js';
import { ShippingProviderError } from '../../ports/shipping-provider.port.js';
import {
  asRecord,
  type FurgonetkaApiError,
  furgonetkaErrors,
  furgonetkaField,
} from './furgonetka-format.js';
import type { FurgonetkaTokens, FurgonetkaTokenStore } from './furgonetka-token-store.js';

/** Token odświeżamy, gdy do wygaśnięcia zostało mniej niż tyle. */
const TOKEN_MARGIN_MS = 60_000;
const REQUEST_TIMEOUT_MS = 20_000;
/** Stany komendy, po których już nic się nie zmieni. */
const FINISHED_COMMAND = new Set(['successful', 'partial_success', 'error', 'cancelled']);

export interface FurgonetkaResponse {
  readonly status: number;
  readonly contentType: string;
  readonly bytes: Buffer;
}

export interface FurgonetkaRequest {
  /** Wersja endpointu (`application/vnd.furgonetka.v{N}+json`). */
  readonly version: number;
  readonly body?: unknown;
  /** Dodatkowe typy w Accept (np. PDF etykiety). */
  readonly accept?: string;
}

export interface FurgonetkaClientOptions {
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Odpytywanie komendy: odstęp i liczba prób (komendy trwają 1–5 s). */
  readonly commandPollIntervalMs?: number;
  readonly commandPollAttempts?: number;
}

export interface FurgonetkaCommandResult {
  readonly status: string;
  readonly errors: readonly FurgonetkaApiError[];
  readonly data: Record<string, unknown>;
}

function unavailable(message: string, cause?: unknown): ShippingProviderError {
  return new ShippingProviderError('UNAVAILABLE', `Furgonetka: ${message}`, { cause });
}

/** Odrzucenie danych z komunikatem dla sprzedającego i polem Biddy (gdy da się je ustalić). */
export function furgonetkaRejection(errors: readonly FurgonetkaApiError[]): ShippingProviderError {
  const first = errors[0];
  const field = first === undefined ? undefined : furgonetkaField(first.path);
  const reason = first?.message.trim() ?? '';
  return new ShippingProviderError(
    'INVALID_REQUEST',
    reason === ''
      ? 'Przewoźnik odrzucił dane przesyłki. Sprawdź dane nadawcy i spróbuj ponownie.'
      : `Przewoźnik odrzucił dane przesyłki: ${reason}`,
    field === undefined ? {} : { field },
  );
}

function parseJson(response: FurgonetkaResponse): unknown {
  if (response.bytes.length === 0) {
    return {};
  }
  try {
    return JSON.parse(response.bytes.toString('utf8'));
  } catch {
    return {};
  }
}

export class FurgonetkaClient {
  private readonly logger = new Logger('FurgonetkaClient');
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly pollAttempts: number;
  private cached: FurgonetkaTokens | undefined;

  constructor(
    private readonly config: FurgonetkaConfig,
    private readonly tokens: FurgonetkaTokenStore,
    options: FurgonetkaClientOptions = {},
  ) {
    this.fetch = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.pollIntervalMs = options.commandPollIntervalMs ?? 1_000;
    this.pollAttempts = options.commandPollAttempts ?? 20;
  }

  /**
   * Żądanie z tokenem. 401 po zmianie tokenu przez inny proces powtarzamy raz z nowym. Zwraca
   * odpowiedzi 2xx i 4xx (interpretuje je wywołujący); sieć, 429 i 5xx to UNAVAILABLE.
   */
  async send(
    method: string,
    path: string,
    request: FurgonetkaRequest,
  ): Promise<FurgonetkaResponse> {
    let token = await this.accessToken();
    let response = await this.raw(method, path, request, token);
    if (response.status === 401) {
      this.cached = undefined;
      token = (await this.tokens.rotate(token, (current) => this.obtain(current))).accessToken;
      response = await this.raw(method, path, request, token);
    }
    if (response.status === 401 || response.status === 403) {
      throw unavailable(`brak dostępu do API (HTTP ${response.status}); sprawdź aplikację OAuth`);
    }
    if (response.status === 429 || response.status >= 500) {
      throw unavailable(`HTTP ${response.status}`);
    }
    return response;
  }

  /** Żądanie JSON: 2xx → body; 400/409/410 → INVALID_REQUEST; 404 → NOT_FOUND. */
  async json(method: string, path: string, request: FurgonetkaRequest): Promise<unknown> {
    const response = await this.send(method, path, request);
    const body = parseJson(response);
    if (response.status >= 200 && response.status < 300) {
      return body;
    }
    if (response.status === 404) {
      throw new ShippingProviderError('NOT_FOUND', `Furgonetka: nie znaleziono (${path})`);
    }
    if (response.status === 409) {
      // Np. niezaakceptowany regulamin przewoźnika na koncie Biddy: sprawa konfiguracji.
      throw unavailable(`konflikt (${furgonetkaErrors(body)[0]?.code ?? 'HTTP 409'})`);
    }
    throw furgonetkaRejection(furgonetkaErrors(body));
  }

  /**
   * Komenda Furgonetki (`PUT /{kind}/{uuid}`, potem odpytywanie `GET`). Powtórka z tym samym
   * UUID to `commandExists`: komenda już jest, więc tylko czekamy na jej wynik.
   */
  async command(
    kind: string,
    uuid: string,
    body: unknown,
    version: number,
  ): Promise<FurgonetkaCommandResult> {
    const path = `/${kind}/${uuid}`;
    const submitted = await this.send('PUT', path, { version, body });
    if (submitted.status >= 400) {
      const errors = furgonetkaErrors(parseJson(submitted));
      if (!errors.some((error) => error.code === 'commandExists')) {
        if (submitted.status === 404) {
          throw new ShippingProviderError('NOT_FOUND', `Furgonetka: nie znaleziono (${path})`);
        }
        throw furgonetkaRejection(errors);
      }
    }
    for (let attempt = 0; attempt < this.pollAttempts; attempt += 1) {
      const data = asRecord(await this.json('GET', path, { version }));
      const status = typeof data['status'] === 'string' ? data['status'] : '';
      if (FINISHED_COMMAND.has(status)) {
        return { status, errors: furgonetkaErrors(data), data };
      }
      await this.sleep(this.pollIntervalMs);
    }
    throw unavailable(`komenda ${kind} nie zakończyła się w czasie oczekiwania`);
  }

  private async raw(
    method: string,
    path: string,
    request: FurgonetkaRequest,
    token: string,
  ): Promise<FurgonetkaResponse> {
    const media = `application/vnd.furgonetka.v${request.version}+json`;
    let response: Response;
    try {
      response = await this.fetch(`${this.config.apiUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: request.accept === undefined ? media : `${request.accept}, ${media}`,
          'x-language': 'pl_PL',
          ...(request.body === undefined ? {} : { 'content-type': media }),
        },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw unavailable(`błąd sieci (${method} ${path})`, error);
    }
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      bytes: Buffer.from(await response.arrayBuffer()),
    };
  }

  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.cached !== undefined && this.cached.expiresAt.getTime() - TOKEN_MARGIN_MS > now) {
      return this.cached.accessToken;
    }
    const stored = await this.tokens.current();
    if (stored !== undefined && stored.expiresAt.getTime() - TOKEN_MARGIN_MS > now) {
      this.cached = stored;
      return stored.accessToken;
    }
    this.cached = await this.tokens.rotate(stored?.accessToken, (current) => this.obtain(current));
    return this.cached.accessToken;
  }

  /** Nowy token: odświeżenie, a gdy refresh token jest zużyty, logowanie hasłem. */
  private async obtain(current: FurgonetkaTokens | undefined): Promise<FurgonetkaTokens> {
    if (current?.refreshToken !== null && current?.refreshToken !== undefined) {
      try {
        return await this.grant({
          grant_type: 'refresh_token',
          refresh_token: current.refreshToken,
        });
      } catch (error) {
        this.logger.warn(
          { err: error },
          'Furgonetka: odświeżenie tokenu nieudane, logowanie hasłem',
        );
      }
    }
    return this.grant({
      grant_type: 'password',
      scope: 'api',
      username: this.config.username,
      password: this.config.password,
    });
  }

  private async grant(fields: Readonly<Record<string, string>>): Promise<FurgonetkaTokens> {
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      'base64',
    );
    let response: Response;
    try {
      response = await this.fetch(`${this.config.apiUrl}/oauth/token`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${basic}`,
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(fields).toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw unavailable('błąd sieci przy logowaniu OAuth', error);
    }
    const body = asRecord(await response.json().catch(() => ({})));
    const accessToken = body['access_token'];
    if (!response.ok || typeof accessToken !== 'string') {
      const reason = typeof body['error'] === 'string' ? body['error'] : `HTTP ${response.status}`;
      throw unavailable(`logowanie OAuth nieudane (${reason})`);
    }
    const refreshToken = body['refresh_token'];
    const expiresIn = typeof body['expires_in'] === 'number' ? body['expires_in'] : 3600;
    return {
      accessToken,
      refreshToken: typeof refreshToken === 'string' ? refreshToken : null,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    };
  }
}

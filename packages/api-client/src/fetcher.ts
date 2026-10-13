// Fetcher klienta API (mutator orval): każda wygenerowana funkcja i każdy hook wysyłają żądanie
// przez apiFetch. Tu jest jedyne miejsce z adresem API, uwierzytelnianiem i obsługą błędów, więc
// web i mobile konfigurują klienta raz (configureApiClient), a kod generowany się nie zmienia.
//
// Uwierzytelnianie (F-07): web korzysta z ciasteczka sesji (credentials: 'include'), mobile
// z tokenu (Authorization: Bearer z getAccessToken). Server Components w Next.js przekazują
// ciasteczko użytkownika przez `headers`.
import { isProblemDetails, type ProblemDetails } from '@biddy/shared';

export interface ApiClientConfig {
  /**
   * Adres API bez prefiksu wersji, np. https://api.biddy.pl albo http://localhost:3001.
   * Ścieżki z kontraktu zawierają już /v1. Pusty tekst oznacza ten sam origin co strona.
   */
  readonly baseUrl: string;
  /** Wysyłanie ciasteczek (sesja web). Domyślnie 'include', bo API jest pod inną domeną. */
  readonly credentials: RequestCredentials;
  /** Token sesji (mobile) wysyłany jako `Authorization: Bearer`; brak tokenu = bez nagłówka. */
  readonly getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Nagłówki dodawane do każdego żądania, np. ciasteczko sesji w Server Components. */
  readonly headers?: () => HeadersInit | Promise<HeadersInit>;
  /** Implementacja fetch; domyślnie globalny fetch (przeglądarka, React Native, Node). */
  readonly fetch?: typeof fetch;
}

const DEFAULT_CONFIG: ApiClientConfig = { baseUrl: '', credentials: 'include' };

let currentConfig: ApiClientConfig = DEFAULT_CONFIG;

/**
 * Ustawia konfigurację klienta (łączy z dotychczasową). Wywołaj raz przy starcie aplikacji,
 * przed pierwszym żądaniem.
 *
 * @example
 * configureApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL });
 * configureApiClient({ getAccessToken: () => SecureStore.getItemAsync('session') });
 */
export function configureApiClient(config: Partial<ApiClientConfig>): void {
  currentConfig = { ...currentConfig, ...config };
}

/** Przywraca konfigurację domyślną (testy). */
export function resetApiClient(): void {
  currentConfig = DEFAULT_CONFIG;
}

/** Bieżąca konfiguracja klienta. */
export function apiClientConfig(): Readonly<ApiClientConfig> {
  return currentConfig;
}

/** Nagłówek z identyfikatorem żądania (API zwraca go w każdej odpowiedzi). */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Status błędu, gdy odpowiedź w ogóle nie dotarła (brak sieci, CORS, przerwane połączenie). */
export const NETWORK_ERROR_STATUS = 0;

/**
 * Błąd żądania do API. Każdy błąd zwracany przez funkcje i hooki klienta jest tego typu (poza
 * przerwaniem żądania przez wywołującego: wtedy zostaje oryginalny AbortError).
 *
 * Rozpoznawaj błąd po `code` (kod domenowy z Problem Details, np. BID_TOO_LOW), a nie po treści
 * komunikatu. `problem` jest pusty, gdy odpowiedź nie była Problem Details (np. strona błędu
 * proxy) albo nie dotarła (`status` = 0).
 */
export class ApiError<TProblem = ProblemDetails> extends Error {
  readonly status: number;
  readonly problem: TProblem | undefined;
  /** Identyfikator żądania z odpowiedzi; przydatny w zgłoszeniu do supportu. */
  readonly requestId: string | undefined;

  constructor(options: {
    readonly status: number;
    readonly message: string;
    readonly problem?: TProblem;
    readonly requestId?: string;
    readonly cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = 'ApiError';
    this.status = options.status;
    this.problem = options.problem;
    this.requestId = options.requestId;
  }

  /** Kod domenowy błędu z Problem Details (undefined, gdy API nie zwróciło Problem Details). */
  get code(): string | undefined {
    return isProblemDetails(this.problem) ? this.problem.code : undefined;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** Typ błędu hooków i funkcji (orval szuka tego eksportu w pliku mutatora). */
export type ErrorType<TProblem> = ApiError<TProblem>;

/** Typ treści żądania (orval szuka tego eksportu w pliku mutatora). */
export type BodyType<TBody> = TBody;

function isJson(contentType: string | null): boolean {
  if (contentType === null) {
    return false;
  }
  const mediaType = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return mediaType === 'application/json' || mediaType.endsWith('+json');
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205 || response.status === 304) {
    return undefined;
  }
  const text = await response.text();
  if (text === '') {
    return undefined;
  }
  if (!isJson(response.headers.get('content-type'))) {
    return text;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Nagłówek mówi JSON, ale treść nim nie jest (np. ucięta odpowiedź): zwracamy tekst.
    return text;
  }
}

async function requestHeaders(config: ApiClientConfig, init: RequestInit): Promise<Headers> {
  const headers = new Headers(await config.headers?.());
  new Headers(init.headers).forEach((value, key) => {
    headers.set(key, value);
  });
  if (!headers.has('accept')) {
    headers.set('accept', 'application/json');
  }
  if (!headers.has('authorization')) {
    const token = await config.getAccessToken?.();
    if (token) {
      headers.set('authorization', `Bearer ${token}`);
    }
  }
  return headers;
}

/**
 * Wysyła żądanie do API i zwraca treść odpowiedzi (JSON). Odpowiedź z błędem (status spoza 2xx)
 * i brak odpowiedzi zamienia na {@link ApiError}. Wołają ją wygenerowane funkcje klienta.
 *
 * @param url ścieżka z kontraktu z parametrami zapytania, np. `/v1/time`
 */
export async function apiFetch<TResponse>(url: string, init: RequestInit = {}): Promise<TResponse> {
  const config = currentConfig;
  const fetchImpl = config.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}${url}`, {
      credentials: config.credentials,
      ...init,
      headers: await requestHeaders(config, init),
    });
  } catch (error) {
    if (init.signal?.aborted) {
      throw error;
    }
    throw new ApiError({
      status: NETWORK_ERROR_STATUS,
      message: `Brak połączenia z API (${init.method ?? 'GET'} ${url})`,
      cause: error,
    });
  }

  const body = await readBody(response);
  if (response.ok) {
    return body as TResponse;
  }
  const requestId = response.headers.get(REQUEST_ID_HEADER) ?? undefined;
  if (isProblemDetails(body)) {
    throw new ApiError({
      status: response.status,
      message: body.detail,
      problem: body,
      requestId: body.requestId,
    });
  }
  throw new ApiError({
    status: response.status,
    message: `API odpowiedziało statusem ${response.status} bez Problem Details (${init.method ?? 'GET'} ${url})`,
    ...(requestId === undefined ? {} : { requestId }),
  });
}

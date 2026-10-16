// Wspólne atrapy e2e: API wołane z przeglądarki (page.route) i widżet Cloudflare Turnstile.
// Renderowanie na serwerze rozmawia z osobną atrapą (e2e/mock-api.ts).
import {
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
  expect,
} from '@playwright/test';

import { MOCK_API_PORT, SESSION_COOKIE } from './mock-api';

/** Adres API, z którym rozmawia przeglądarka (domyślna konfiguracja buildu, src/env.ts). */
export const BROWSER_API_URL = 'http://localhost:3001';

/** Token, który atrapa Turnstile przekazuje formularzowi (jak testowy klucz Cloudflare). */
export const TURNSTILE_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

export const AUTH_OPTIONS = {
  socialProviders: ['google', 'apple'],
  turnstileSiteKey: '1x00000000000000000000AA',
  passwordMinLength: 10,
};

/** Odpowiedź atrapy API. */
export interface MockResponse {
  readonly status?: number;
  /** Ciało JSON (pomijane przy 204). */
  readonly json?: unknown;
}

/** Odpowiedź stała albo zależna od żądania (np. inna przy drugiej próbie). */
export type Responder = MockResponse | ((request: Request) => MockResponse | Promise<MockResponse>);

export function ok(json: unknown): MockResponse {
  return { status: 200, json };
}

/** Błąd jak z API: Problem Details z kodem domenowym (F-03, F-07); `instance` uzupełnia atrapa. */
export function problem(status: number, code: string, detail: string): MockResponse {
  return {
    status,
    json: {
      type: `https://biddy.pl/problems/${code}`,
      title: code,
      status,
      detail,
      code,
      requestId: 'e2e',
      message: detail,
    },
  };
}

/** Nagłówki CORS jak z API (F-03): origin aplikacji, ciasteczka, nagłówki Biddy. */
function corsHeaders(request: Request): Record<string, string> {
  return {
    'access-control-allow-origin': request.headers()['origin'] ?? '*',
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE',
    'access-control-allow-headers':
      'content-type, x-turnstile-token, x-request-id, idempotency-key',
    'access-control-expose-headers': 'x-request-id, set-auth-token',
  };
}

/**
 * Podmienia API przeglądarki. Klucz to `METODA /v1/ścieżka`. Domyślnie: czas serwera, gość bez
 * sesji i opcje logowania; reszta to 404. Zwraca zarejestrowane żądania do asercji.
 */
export async function mockBrowserApi(
  page: Page,
  responders: Readonly<Record<string, Responder>> = {},
): Promise<{ readonly requests: (key: string) => Request[] }> {
  const all: Request[] = [];
  const table: Record<string, Responder> = {
    'GET /v1/time': () => ok({ serverTime: new Date().toISOString() }),
    'GET /v1/session': ok({ user: null }),
    'GET /v1/auth-options': ok(AUTH_OPTIONS),
    ...responders,
  };
  const keyOf = (request: Request) => `${request.method()} ${new URL(request.url()).pathname}`;

  await page.route(`${BROWSER_API_URL}/**`, async (route, request) => {
    const headers = corsHeaders(request);
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    all.push(request);
    const responder = table[keyOf(request)];
    const response =
      responder === undefined
        ? problem(404, 'NOT_FOUND', 'Nie znaleziono.')
        : typeof responder === 'function'
          ? await responder(request)
          : responder;
    const status = response.status ?? 200;
    if (status === 204) {
      await route.fulfill({ status, headers });
      return;
    }
    const problemJson =
      status >= 400 && typeof response.json === 'object' && response.json !== null;
    await route.fulfill({
      status,
      headers,
      contentType: problemJson ? 'application/problem+json' : 'application/json',
      body: JSON.stringify(
        problemJson
          ? { instance: new URL(request.url()).pathname, ...response.json }
          : response.json,
      ),
    });
  });

  return { requests: (key) => all.filter((request) => keyOf(request) === key) };
}

/**
 * Atrapa skryptu Turnstile zamiast challenges.cloudflare.com: widżet od razu „rozwiązuje”
 * wyzwanie (jak testowy klucz witryny) i po reset() daje nowy token. Testy nie zależą od sieci.
 */
export async function stubTurnstile(page: Page): Promise<void> {
  const script = `(() => {
    const onload = new URL(document.currentScript.src).searchParams.get('onload');
    const widgets = new Map();
    let counter = 0;
    const solve = (id) => setTimeout(() => widgets.get(id)?.callback?.(${JSON.stringify(TURNSTILE_TOKEN)}), 50);
    window.turnstile = {
      render(container, options) {
        const element = typeof container === 'string' ? document.querySelector(container) : container;
        const id = 'atrapa-' + ++counter;
        widgets.set(id, options);
        element.textContent = 'Atrapa Turnstile';
        solve(id);
        return id;
      },
      reset(id) { solve(id ?? 'atrapa-' + counter); },
      remove(id) { widgets.delete(id); },
      getResponse() { return ${JSON.stringify(TURNSTILE_TOKEN)}; },
      isExpired() { return false; },
      execute() {},
      ready(callback) { callback(); },
    };
    if (onload) window[onload]?.();
  })();`;
  await page.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: script }),
  );
}

/**
 * Czeka, aż strona się ustabilizuje przed axe-core: przyciski formularzy są aktywne (np. po
 * tokenie Turnstile), tytuł dokumentu jest na miejscu (po router.refresh), a przejścia CSS
 * skończone (w trakcie animacji kontrast bywa za niski).
 */
export async function settle(page: Page): Promise<void> {
  for (const button of await page.locator('main button[type="submit"]').all()) {
    await expect(button).toBeEnabled();
  }
  // Odświeżenie danych z serwera (router.refresh) na chwilę podmienia metadane, w tym <title>.
  await page.waitForFunction(() => document.title !== '');
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation instanceof CSSTransition)
        // Przerwane przejście (np. nowy stan przycisku) odrzuca `finished`: wtedy już się skończyło.
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

/**
 * Ciasteczko sesji na domenie aplikacji (SSR przekazuje je atrapie API). Na produkcji API ustawia
 * je na wspólnej domenie (AUTH_COOKIE_DOMAIN), a w testach web i atrapa API mają różne hosty.
 */
export async function signInAs(
  context: BrowserContext,
  session: string,
  baseURL: string | undefined,
): Promise<void> {
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: session,
      url: baseURL ?? 'http://127.0.0.1:3100',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

/**
 * Zaznacza pole wyboru (Radix) także tuż po nawigacji: kliknięcie przed hydratacją Reacta nic
 * nie zmienia, więc ponawiamy, aż stan się zmieni.
 */
export async function checkWhenHydrated(checkbox: Locator): Promise<void> {
  await expect(async () => {
    await checkbox.check({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}

/**
 * Otwiera stronę i czeka na hydratację Reacta: synchronizacja zegara (GET /v1/time, F-06) startuje
 * dopiero w przeglądarce po hydratacji. Wcześniejsze wpisanie i kliknięcie trafiłoby w statyczny
 * HTML (formularz wysłałby się natywnie). Wymaga {@link mockBrowserApi} przed wywołaniem.
 */
export async function gotoHydrated(page: Page, url: string): Promise<void> {
  const hydrated = page.waitForRequest((request) => request.url().endsWith('/v1/time'));
  await page.goto(url);
  await hydrated;
}

/** Nadpisania pól /v1/me w atrapie SSR dla sesji testu (np. avatarUrl po zapisie). */
export async function setSsrMe(session: string, patch: Record<string, unknown>): Promise<void> {
  const response = await fetch(
    `http://127.0.0.1:${MOCK_API_PORT}/__e2e/me?${new URLSearchParams({ session }).toString()}`,
    { method: 'PUT', body: JSON.stringify(patch) },
  );
  expect(response.ok).toBe(true);
}

/**
 * Stan adresów w atrapie SSR (e2e/mock-api.ts) dla sesji testu: strona /konto/adresy renderuje
 * się na serwerze, więc po zmianie w przeglądarce (router.refresh) musi zobaczyć nowy stan.
 */
export async function setSsrAddresses(
  session: string,
  addresses: readonly unknown[],
): Promise<void> {
  const response = await fetch(
    `http://127.0.0.1:${MOCK_API_PORT}/__e2e/addresses?${new URLSearchParams({ session }).toString()}`,
    { method: 'PUT', body: JSON.stringify(addresses) },
  );
  expect(response.ok).toBe(true);
}

/**
 * Aukcje sprzedającego w atrapie SSR (ListingDto) dla sesji testu: kreator (/wystaw/{id})
 * i Moje aukcje renderują się na serwerze, więc po zmianie w przeglądarce muszą zobaczyć nowy stan.
 */
export async function setSsrAuctions(
  session: string,
  auctions: readonly Record<string, unknown>[],
): Promise<void> {
  const response = await fetch(
    `http://127.0.0.1:${MOCK_API_PORT}/__e2e/auctions?${new URLSearchParams({ session }).toString()}`,
    { method: 'PUT', body: JSON.stringify(auctions) },
  );
  expect(response.ok).toBe(true);
}

/** Publiczna aukcja (PublicAuctionDto) w atrapie SSR: strona /a/{slug}-{publicId} (F-18). */
export async function setSsrPublicAuction(auction: Record<string, unknown>): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${MOCK_API_PORT}/__e2e/public-auctions`, {
    method: 'PUT',
    body: JSON.stringify(auction),
  });
  expect(response.ok).toBe(true);
}

/** Atrapa serwera realtime: subskrybowane aukcje i wysyłka zdarzeń do przeglądarki. */
export interface MockRealtime {
  /** Czeka, aż przeglądarka zasubskrybuje aukcję (`auction:subscribe`). */
  readonly subscribed: (auctionId: string) => Promise<void>;
  /** Zdarzenie serwer → klient, np. `auction.updated`. */
  readonly send: (event: string, payload: unknown) => void;
}

/**
 * Serwer Socket.IO (F-17) w przeglądarce testu: protokół Engine.IO 4 / Socket.IO 5 przez
 * `page.routeWebSocket`. Otwarcie (`0{…}`), połączenie przestrzeni nazw (`40`), potwierdzenia
 * `auction:subscribe` i `time:ping` (`43{id}[…]`) i zdarzenia (`42[…]`).
 */
export async function mockRealtime(page: Page): Promise<MockRealtime> {
  const subscriptions = new Set<string>();
  const waiting = new Map<string, () => void>();
  let socket: { send: (message: string) => void } | undefined;
  await page.routeWebSocket(/\/v1\/realtime\//u, (ws) => {
    socket = ws;
    ws.send(
      `0${JSON.stringify({ sid: 'e2e', upgrades: [], pingInterval: 25_000, pingTimeout: 20_000, maxPayload: 1_000_000 })}`,
    );
    ws.onMessage((message) => {
      const text = typeof message === 'string' ? message : message.toString();
      if (text.startsWith('40')) {
        ws.send(`40${JSON.stringify({ sid: 'e2e-socket' })}`);
        return;
      }
      const packet = /^42(\d*)(\[.*\])$/su.exec(text);
      if (packet === null) {
        return;
      }
      const [, ackId = '', body = '[]'] = packet;
      const [name, argument] = JSON.parse(body) as [string, unknown];
      const ack = (value: unknown) => {
        if (ackId !== '') {
          ws.send(`43${ackId}${JSON.stringify([value])}`);
        }
      };
      if (name === 'auction:subscribe' && typeof argument === 'string') {
        subscriptions.add(argument);
        waiting.get(argument)?.();
        ack({ ok: true });
      } else if (name === 'time:ping') {
        ack({ serverTime: new Date().toISOString() });
      }
    });
  });
  return {
    subscribed: (auctionId) =>
      subscriptions.has(auctionId)
        ? Promise.resolve()
        : new Promise((resolve) => {
            waiting.set(auctionId, resolve);
          }),
    send: (event, payload) => {
      if (socket === undefined) {
        throw new Error('Przeglądarka nie połączyła się z atrapą realtime');
      }
      socket.send(`42${JSON.stringify([event, payload])}`);
    },
  };
}

/** Wynik wyszukiwania dla zapytania `q` w atrapie SSR (F-19); `q` powinno być unikalne. */
export async function setSsrSearch(q: string, result: Record<string, unknown>): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${MOCK_API_PORT}/__e2e/search`, {
    method: 'PUT',
    body: JSON.stringify({ q, result }),
  });
  expect(response.ok).toBe(true);
}

/** Parametry zapytań wyszukiwania, które dostała atrapa SSR (np. z formularza filtrów). */
export async function ssrSearchRequests(): Promise<URLSearchParams[]> {
  const response = await fetch(`http://127.0.0.1:${MOCK_API_PORT}/__e2e/search-requests`);
  return ((await response.json()) as string[]).map((query) => new URLSearchParams(query));
}

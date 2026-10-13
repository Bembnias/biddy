// Wspólne atrapy e2e: API wołane z przeglądarki (page.route) i widżet Cloudflare Turnstile.
// Renderowanie na serwerze rozmawia z osobną atrapą (e2e/mock-api.ts).
import { type Page, type Request, expect } from '@playwright/test';

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
    'access-control-allow-headers': 'content-type, x-turnstile-token, x-request-id',
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
 * tokenie Turnstile), a przejścia CSS skończone (w trakcie animacji kontrast bywa za niski).
 */
export async function settle(page: Page): Promise<void> {
  for (const button of await page.locator('main button[type="submit"]').all()) {
    await expect(button).toBeEnabled();
  }
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation instanceof CSSTransition)
        .map((animation) => animation.finished),
    ),
  );
}

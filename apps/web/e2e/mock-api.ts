// Atrapa API dla renderowania na serwerze w testach e2e: Next.js woła ją z Server Components
// (API_INTERNAL_URL w playwright.config.ts). Żądania przeglądarki do API przechwytuje
// page.route (e2e/support.ts). Uruchamia ją Playwright: `node e2e/mock-api.ts`.
//
// Sesja to wartość ciasteczka z SESSIONS, opcjonalnie z sufiksem testu (`…-test-1`): każdy test
// ma wtedy własny stan adresów (testy działają równolegle). Stan ustawia test przez
// PUT /__e2e/addresses?session=… (e2e/support.ts, setSsrAddresses).
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';

/** Port atrapy (Playwright podaje go też Next.js jako API_INTERNAL_URL). */
export const MOCK_API_PORT = Number(process.env.E2E_API_PORT ?? 3901);

/** Nazwa ciasteczka sesji Better Auth (prefiks `biddy`, F-07). */
export const SESSION_COOKIE = 'biddy.session_token';

/** Wartości ciasteczka sesji, które atrapa rozpoznaje. */
export const SESSIONS = {
  /** Konto z potwierdzonym regulaminem i niepotwierdzonym e-mailem. */
  member: 'e2e-session-member',
  /** Konto z Google przed akceptacją regulaminu. */
  withoutTerms: 'e2e-session-without-terms',
  /** Potwierdzony e-mail, bez zweryfikowanego telefonu (F-08). */
  emailVerified: 'e2e-session-email-verified',
  /** Potwierdzony e-mail i zweryfikowany telefon: może licytować i wystawiać. */
  phoneVerified: 'e2e-session-phone-verified',
} as const;

/** Numer telefonu konta z sesją `phoneVerified`. */
export const MEMBER_PHONE = '+48500600700';

export const MEMBER = {
  id: '01960000-0000-7000-8000-000000000001',
  name: 'Kasia Kupująca',
  email: 'kupujacy@biddy.local',
  emailVerified: false,
  phoneNumber: null,
  phoneVerified: false,
  staffRole: null,
  createdAt: '2026-10-01T10:00:00.000Z',
} as const;

function cookieValue(request: IncomingMessage, name: string): string | undefined {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) {
      return decodeURIComponent(value.join('='));
    }
  }
  return undefined;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const isProblem = status >= 400;
  response.writeHead(status, {
    'content-type': isProblem ? 'application/problem+json' : 'application/json',
  });
  response.end(JSON.stringify(body));
}

function problem(status: number, code: string, detail: string, instance: string) {
  return {
    type: `https://biddy.pl/problems/${code}`,
    title: code,
    status,
    detail,
    instance,
    code,
    requestId: 'e2e',
  };
}

/** Adresy (DTO z API) według pełnej wartości ciasteczka sesji. */
const addressesBySession = new Map<string, unknown[]>();

/** Rodzaj sesji z wartości ciasteczka (najdłuższy pasujący prefiks z SESSIONS). */
function sessionKind(session: string | undefined): string | undefined {
  if (session === undefined) {
    return undefined;
  }
  return Object.values(SESSIONS)
    .filter((kind) => session === kind || session.startsWith(`${kind}-`))
    .sort((left, right) => right.length - left.length)[0];
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://atrapa');
  const path = url.pathname;
  if (path === '/health') {
    send(response, 200, { status: 'ok' });
    return;
  }
  if (request.method === 'PUT' && path === '/__e2e/addresses') {
    addressesBySession.set(
      url.searchParams.get('session') ?? '',
      (await readJson(request)) as unknown[],
    );
    send(response, 200, { ok: true });
    return;
  }
  const session = cookieValue(request, SESSION_COOKIE);
  if (request.method === 'GET' && path === '/v1/me/addresses') {
    if (sessionKind(session) === undefined) {
      send(response, 401, problem(401, 'UNAUTHORIZED', 'Zaloguj się.', path));
      return;
    }
    send(response, 200, addressesBySession.get(session ?? '') ?? []);
    return;
  }
  const profile = /^\/v1\/users\/([^/]+)$/.exec(path);
  if (request.method === 'GET' && profile !== null) {
    if (profile[1] === MEMBER.id) {
      send(response, 200, {
        id: MEMBER.id,
        name: MEMBER.name,
        memberSince: MEMBER.createdAt,
        phoneVerified: true,
      });
      return;
    }
    send(response, 404, problem(404, 'NOT_FOUND', 'Nie znaleziono profilu.', path));
    return;
  }
  if (request.method === 'GET' && path === '/v1/me') {
    const me = {
      [SESSIONS.member]: { ...MEMBER, termsAccepted: true },
      [SESSIONS.withoutTerms]: { ...MEMBER, termsAccepted: false },
      [SESSIONS.emailVerified]: { ...MEMBER, emailVerified: true, termsAccepted: true },
      [SESSIONS.phoneVerified]: {
        ...MEMBER,
        emailVerified: true,
        termsAccepted: true,
        phoneNumber: MEMBER_PHONE,
        phoneVerified: true,
      },
    }[sessionKind(session) ?? ''];
    if (me !== undefined) {
      send(response, 200, me);
      return;
    }
    send(response, 401, problem(401, 'UNAUTHORIZED', 'Zaloguj się.', path));
    return;
  }
  send(response, 404, problem(404, 'NOT_FOUND', 'Nie znaleziono.', path));
}

if (import.meta.main) {
  createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      console.error(error);
      send(response, 500, problem(500, 'INTERNAL_ERROR', 'Błąd atrapy API.', request.url ?? '/'));
    });
  }).listen(MOCK_API_PORT, '127.0.0.1', () => {
    console.log(`Atrapa API e2e: http://127.0.0.1:${MOCK_API_PORT}`);
  });
}

// Atrapa API dla renderowania na serwerze w testach e2e: Next.js woła ją z Server Components
// (API_INTERNAL_URL w playwright.config.ts). Żądania przeglądarki do API przechwytuje
// page.route (e2e/support.ts). Uruchamia ją Playwright: `node e2e/mock-api.ts`.
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

function handle(request: IncomingMessage, response: ServerResponse): void {
  const path = new URL(request.url ?? '/', 'http://atrapa').pathname;
  if (path === '/health') {
    send(response, 200, { status: 'ok' });
    return;
  }
  if (request.method === 'GET' && path === '/v1/me') {
    const session = cookieValue(request, SESSION_COOKIE);
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
    }[session ?? ''];
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
  createServer(handle).listen(MOCK_API_PORT, '127.0.0.1', () => {
    console.log(`Atrapa API e2e: http://127.0.0.1:${MOCK_API_PORT}`);
  });
}

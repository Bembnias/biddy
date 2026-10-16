// Atrapa API dla renderowania na serwerze w testach e2e: Next.js woła ją z Server Components
// (API_INTERNAL_URL w playwright.config.ts). Żądania przeglądarki do API przechwytuje
// page.route (e2e/support.ts). Uruchamia ją Playwright: `node e2e/mock-api.ts`.
//
// Sesja to wartość ciasteczka z SESSIONS, opcjonalnie z sufiksem testu (`…-test-1`): każdy test
// ma wtedy własny stan adresów (testy działają równolegle). Stan ustawia test przez
// PUT /__e2e/addresses?session=… (e2e/support.ts, setSsrAddresses), a aukcji (kreator, Moje aukcje,
// F-14) przez PUT /__e2e/auctions?session=… (setSsrAuctions). Publiczne aukcje (strona aukcji,
// F-18) według publicId: PUT /__e2e/public-auctions (setSsrPublicAuction). Wyszukiwarka (F-19):
// wyniki dla zapytania `q` ustawia PUT /__e2e/search (setSsrSearch), a strona główna, kategoria
// „Moda” i sitemap mają stałe dane (strony z cache ISR muszą wyglądać tak samo w każdym przebiegu).
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

/** Sekret rewalidacji stron (POST /api/revalidate, F-18); Playwright podaje go Next.js. */
export const REVALIDATE_SECRET = 'e2e-revalidate-secret-0123456789-abcdef';

/** Cennik POK (F-13) dla ceny łącznej. */
export const FEE_SCHEDULE = {
  id: '019b76da-a800-7473-8d63-395c20bf8898',
  currency: 'PLN',
  fixedFee: 299,
  tiers: [
    { upTo: 100_000, bp: 700 },
    { upTo: null, bp: 400 },
  ],
  vatRateBp: 2300,
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: null,
} as const;

/** Kategorie (F-11): Moda › Sneakersy, Elektronika › Retro gaming. */
export const CATEGORIES = [
  {
    id: '01960000-0000-7000-8000-00000000ca01',
    parentId: null,
    slug: 'moda',
    name: 'Moda',
    path: ['moda'],
    depth: 0,
    isLeaf: false,
    isRestricted: false,
    isBrandSensitive: false,
  },
  {
    id: '01960000-0000-7000-8000-00000000ca02',
    parentId: '01960000-0000-7000-8000-00000000ca01',
    slug: 'sneakersy',
    name: 'Sneakersy',
    path: ['moda', 'sneakersy'],
    depth: 1,
    isLeaf: true,
    isRestricted: false,
    isBrandSensitive: true,
  },
  {
    id: '01960000-0000-7000-8000-00000000ca03',
    parentId: null,
    slug: 'elektronika',
    name: 'Elektronika',
    path: ['elektronika'],
    depth: 0,
    isLeaf: false,
    isRestricted: false,
    isBrandSensitive: false,
  },
  {
    id: '01960000-0000-7000-8000-00000000ca04',
    parentId: '01960000-0000-7000-8000-00000000ca03',
    slug: 'retro-gaming',
    name: 'Retro gaming',
    path: ['elektronika', 'retro-gaming'],
    depth: 1,
    isLeaf: true,
    isRestricted: false,
    isBrandSensitive: false,
  },
] as const;

/** Karta aukcji w wynikach wyszukiwania (AuctionSearchDto.items). */
export function searchCard(index: number, title: string): Record<string, unknown> {
  return {
    id: `01960000-0000-7000-8000-0000000c${String(1000 + index).padStart(4, '0')}`,
    publicId: `k3x9qa${'abcdefghjkmnpqrstuvwxyz23456789'[index % 31] ?? 'a'}m`,
    slug: title.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-'),
    title,
    condition: 'GOOD',
    currency: 'PLN',
    price: 2_000 + index * 1_000,
    currentPrice: index % 2 === 0 ? null : 2_000 + index * 1_000,
    bidCount: index % 2 === 0 ? 0 : index,
    buyNowPrice: null,
    endsAt: '2026-12-01T18:00:00.000Z',
    coverUrl: null,
    coverThumbUrl: null,
  };
}

/** Wynik wyszukiwania (AuctionSearchDto) z kartami i fasetami. */
export function searchResult(
  items: readonly Record<string, unknown>[],
  facets: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    items,
    total: items.length,
    totalPages: items.length === 0 ? 0 : 1,
    page: 1,
    pageSize: 24,
    sort: 'ending',
    facets: { categories: [], conditions: [], price: null, attributes: [], ...facets },
    ...overrides,
  };
}

/** Stała lista na stronie głównej (kończące się i nowe). */
const HOME_RESULT = searchResult([
  searchCard(1, 'Zegarek Casio vintage'),
  searchCard(2, 'Aparat Zenit E'),
]);

/** Kategoria „Moda”: podkategoria i atrybut kategorii z liczbami aukcji. */
const FASHION_RESULT = searchResult([searchCard(3, 'Nike Air Max 90')], {
  categories: [{ ...CATEGORIES[1], count: 1 }].map(({ id, slug, name, path, count }) => ({
    id,
    slug,
    name,
    path,
    count,
  })),
  conditions: [{ value: 'GOOD', count: 1 }],
  price: { min: 5_000, max: 5_000 },
  attributes: [
    {
      key: 'kolor',
      label: 'Kolor',
      type: 'select',
      unit: null,
      options: [{ value: 'bialy', label: 'Biały', count: 1 }],
      range: null,
    },
  ],
});

/** Numer telefonu konta z sesją `phoneVerified`. */
export const MEMBER_PHONE = '+48500600700';

export const MEMBER = {
  id: '01960000-0000-7000-8000-000000000001',
  name: 'Kasia Kupująca',
  email: 'kupujacy@biddy.local',
  emailVerified: false,
  phoneNumber: null,
  phoneVerified: false,
  avatarUrl: null,
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
/** Nadpisania pól /v1/me według pełnej wartości ciasteczka sesji (np. avatarUrl po zapisie). */
const meBySession = new Map<string, Record<string, unknown>>();
/** Aukcje sprzedającego (ListingDto) według sesji testu. */
const auctionsBySession = new Map<string, Record<string, unknown>[]>();
/** Publiczne aukcje (PublicAuctionDto) według publicId. */
const publicAuctions = new Map<string, Record<string, unknown>>();
/** Wyniki wyszukiwania według zapytania `q` (testy używają unikalnych zapytań). */
const searchByQuery = new Map<string, Record<string, unknown>>();
/** Parametry zapytań wyszukiwania z renderowania na serwerze (asercje e2e). */
const searchRequests: string[] = [];

function searchResponse(params: URLSearchParams): { status: number; body: unknown } {
  const q = params.get('q') ?? '';
  if (q === 'awaria') {
    return {
      status: 503,
      body: problem(
        503,
        'SERVICE_UNAVAILABLE',
        'Wyszukiwarka jest chwilowo niedostępna.',
        '/v1/auctions',
      ),
    };
  }
  const forQuery = searchByQuery.get(q);
  if (q !== '' && forQuery !== undefined) {
    return { status: 200, body: forQuery };
  }
  if (q === '' && params.get('category') === CATEGORIES[0].id) {
    return { status: 200, body: FASHION_RESULT };
  }
  if (q === '' && !params.has('category') && !params.has('seller')) {
    return { status: 200, body: HOME_RESULT };
  }
  return { status: 200, body: searchResult([]) };
}

/** ListingDto → AuctionSummaryDto (lista Moje aukcje). */
function summary(listing: Record<string, unknown>): Record<string, unknown> {
  const photos = listing['photos'] as { urls: { thumb: string } | null }[] | undefined;
  return {
    id: listing['id'],
    publicId: listing['publicId'],
    status: listing['status'],
    editable: listing['editable'],
    title: listing['title'],
    coverUrl: photos?.[0]?.urls?.thumb ?? null,
    currency: listing['currency'],
    startPrice: listing['startPrice'],
    currentPrice: null,
    bidCount: listing['bidCount'],
    endsAt: listing['endsAt'],
    updatedAt: listing['updatedAt'],
  };
}

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
  if (request.method === 'PUT' && path === '/__e2e/me') {
    meBySession.set(
      url.searchParams.get('session') ?? '',
      (await readJson(request)) as Record<string, unknown>,
    );
    send(response, 200, { ok: true });
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
  if (request.method === 'PUT' && path === '/__e2e/auctions') {
    auctionsBySession.set(
      url.searchParams.get('session') ?? '',
      (await readJson(request)) as Record<string, unknown>[],
    );
    send(response, 200, { ok: true });
    return;
  }
  if (request.method === 'PUT' && path === '/__e2e/public-auctions') {
    const auction = (await readJson(request)) as Record<string, unknown>;
    publicAuctions.set(String(auction['publicId']), auction);
    send(response, 200, { ok: true });
    return;
  }
  if (request.method === 'PUT' && path === '/__e2e/search') {
    const { q, result } = (await readJson(request)) as {
      q: string;
      result: Record<string, unknown>;
    };
    searchByQuery.set(q, result);
    send(response, 200, { ok: true });
    return;
  }
  if (request.method === 'GET' && path === '/__e2e/search-requests') {
    send(response, 200, searchRequests);
    return;
  }
  if (request.method === 'GET' && path === '/v1/auctions') {
    searchRequests.push(url.searchParams.toString());
    const { status, body } = searchResponse(url.searchParams);
    send(response, status, body);
    return;
  }
  if (request.method === 'GET' && path === '/v1/categories') {
    send(response, 200, CATEGORIES);
    return;
  }
  if (request.method === 'GET' && path === '/v1/sitemap/auctions') {
    // Stała lista: sitemap jest w cache (10 min) także między przebiegami testów.
    send(response, 200, {
      items: [
        {
          publicId: 'k3x9qa7m',
          slug: 'zegarek-casio-vintage',
          updatedAt: '2026-10-01T10:00:00.000Z',
        },
      ],
    });
    return;
  }
  const publicAuction = /^\/v1\/auctions\/([^/]+)$/.exec(path);
  if (request.method === 'GET' && publicAuction !== null) {
    const found = publicAuctions.get(publicAuction[1] ?? '');
    if (found === undefined) {
      send(response, 404, problem(404, 'NOT_FOUND', 'Nie znaleziono aukcji.', path));
      return;
    }
    send(response, 200, { ...found, serverTime: new Date().toISOString() });
    return;
  }
  if (request.method === 'GET' && path === '/v1/fee-schedules/current') {
    send(response, 200, FEE_SCHEDULE);
    return;
  }
  const session = cookieValue(request, SESSION_COOKIE);
  if (request.method === 'GET' && path.startsWith('/v1/me/auctions')) {
    if (sessionKind(session) === undefined) {
      send(response, 401, problem(401, 'UNAUTHORIZED', 'Zaloguj się.', path));
      return;
    }
    const auctions = auctionsBySession.get(session ?? '') ?? [];
    const one = /^\/v1\/me\/auctions\/([^/]+)$/.exec(path);
    if (one === null) {
      send(response, 200, auctions.map(summary));
      return;
    }
    const found = auctions.find((auction) => auction['id'] === one[1]);
    if (found === undefined) {
      send(response, 404, problem(404, 'NOT_FOUND', 'Nie znaleziono aukcji.', path));
      return;
    }
    send(response, 200, found);
    return;
  }
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
        avatarUrl: null,
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
      send(response, 200, { ...me, ...meBySession.get(session ?? '') });
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

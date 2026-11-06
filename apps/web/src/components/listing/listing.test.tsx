import type {
  AuctionSummaryDto,
  CarrierDto,
  CategoryDto,
  CategorySchemaDto,
  FeeScheduleDto,
  ListingDto,
  SellingLimitsDto,
} from '@biddy/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiCalls, mockApi } from '@/test/api';
import { AppWrapper } from '@/test/providers';

import { ListingWizard } from './listing-wizard';
import { MyAuctions } from './my-auctions';
import { SellStart } from './sell-start';

const router = { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() };
let search = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => `/wystaw/${ID}`,
  useSearchParams: () => search,
}));

const ID = '01960000-0000-7000-8000-000000000001';
const CATEGORY = '01960000-0000-7000-8000-0000000000c1';

const CARRIERS: CarrierDto[] = [
  {
    id: 'inpost-paczkomat',
    name: 'InPost Paczkomat 24/7',
    kind: 'LOCKER',
    packageSizes: ['S', 'M', 'L'],
    pointMap: null,
  },
  {
    id: 'dpd-kurier',
    name: 'DPD Kurier',
    kind: 'COURIER',
    packageSizes: ['S', 'M', 'L', 'XL'],
    pointMap: null,
  },
];

const CATEGORIES: CategoryDto[] = [
  {
    id: 'dom',
    parentId: null,
    slug: 'dom',
    name: 'Dom',
    path: ['dom'],
    depth: 0,
    isLeaf: false,
    isRestricted: false,
    isBrandSensitive: false,
  },
  {
    id: CATEGORY,
    parentId: 'dom',
    slug: 'dekoracje',
    name: 'Dekoracje',
    path: ['dom', 'dekoracje'],
    depth: 1,
    isLeaf: true,
    isRestricted: false,
    isBrandSensitive: false,
  },
];

const SCHEMA: CategorySchemaDto = {
  ...(CATEGORIES[1] as CategoryDto),
  attributes: [],
  listingNotice: null,
  jsonSchema: {},
};

const LIMITS: SellingLimitsDto = {
  level: 'NEW',
  maxActiveAuctions: 5,
  activeAuctions: 0,
  maxAuctionValue: 500_000,
  kycVerified: false,
  kycRequiredAbove: 500_000,
  listingBlocked: false,
  listingBlockedUntil: null,
  kycNoticeAccepted: false,
};

const FEES: FeeScheduleDto = {
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
};

const EMPTY: ListingDto = {
  id: ID,
  publicId: 'k3x9qa7m',
  status: 'DRAFT',
  editable: true,
  bidCount: 0,
  currency: 'PLN',
  categoryId: null,
  attributes: {},
  title: null,
  description: null,
  condition: null,
  brand: null,
  packageSize: null,
  weightGrams: null,
  lengthCm: null,
  widthCm: null,
  heightCm: null,
  allowedCarriers: [],
  photos: [],
  startPrice: null,
  reservePrice: null,
  buyNowPrice: null,
  durationDays: null,
  reviewReasons: [],
  startsAt: null,
  endsAt: null,
  publishedAt: null,
  cancelledAt: null,
  createdAt: '2026-10-15T10:00:00.000Z',
  updatedAt: '2026-10-15T10:00:00.000Z',
};

const COMPLETE: ListingDto = {
  ...EMPTY,
  categoryId: CATEGORY,
  title: 'Wazon ceramiczny, lata 70.',
  description: 'Ręcznie malowany wazon, bez pęknięć i odprysków. Wysokość 30 cm.',
  condition: 'VERY_GOOD',
  packageSize: 'M',
  allowedCarriers: ['inpost-paczkomat'],
  photos: [
    {
      id: '01960000-0000-7000-8000-0000000000f1',
      status: 'READY',
      urls: {
        thumb: 'https://media.biddy.test/t.webp',
        medium: 'https://media.biddy.test/m.webp',
        large: 'https://media.biddy.test/l.webp',
      },
    },
  ],
  startPrice: 2_000,
  durationDays: 7,
};

function api(overrides: Record<string, unknown> = {}) {
  return mockApi({
    '/v1/shipping/carriers': CARRIERS,
    '/v1/categories': CATEGORIES,
    [`/v1/categories/${CATEGORY}/schema`]: SCHEMA,
    '/v1/me/selling-limits': LIMITS,
    '/v1/fee-schedules/current': FEES,
    [`/v1/auctions/${ID}`]: COMPLETE,
    ...overrides,
  });
}

function renderWizard(listing: ListingDto, step: string, phoneVerified = true) {
  search = new URLSearchParams({ krok: step });
  return render(<ListingWizard initial={listing} phoneVerified={phoneVerified} />, {
    wrapper: AppWrapper,
  });
}

beforeEach(() => {
  router.push.mockClear();
});

/** Elementy poza ukrytymi krokami kreatora (lista braków w podglądzie powtarza komunikaty). */
function visible(elements: HTMLElement[]): HTMLElement[] {
  return elements.filter((element) => element.closest('[hidden]') === null);
}

/** Przewoźnicy wczytani (walidacja kroku działa dopiero z kompletnym kontekstem). */
async function carriersLoaded() {
  await screen.findAllByRole('checkbox', { hidden: true });
}

describe('ListingWizard', () => {
  it('„Dalej” sprawdza krok tymi samymi regułami co API i nie przechodzi przy brakach', async () => {
    api();
    const user = userEvent.setup();
    renderWizard(EMPTY, 'zdjecia');
    await screen.findByRole('heading', { name: 'Krok 1 z 6: Zdjęcia' });
    await carriersLoaded();
    await user.click(screen.getByRole('button', { name: 'Dalej' }));
    expect(visible(await screen.findAllByText('Dodaj co najmniej jedno zdjęcie.'))).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toBe(
      'Popraw zaznaczone pola, żeby przejść dalej.',
    );
    expect(router.push).not.toHaveBeenCalled();
  });

  it('krok kompletny: przejście do następnego kroku (adres z ?krok=)', async () => {
    api();
    const user = userEvent.setup();
    renderWizard(COMPLETE, 'zdjecia');
    await carriersLoaded();
    await user.click(screen.getByRole('button', { name: 'Dalej' }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/wystaw/${ID}?krok=kategoria`, { scroll: false });
    });
    expect(screen.getByRole('link', { name: 'Zdjęcia' }).getAttribute('aria-current')).toBe('step');
  });

  it('autozapis: po chwili wysyła tylko zmienione pola, stan „Zapisano”', async () => {
    const fetchMock = api();
    const user = userEvent.setup();
    renderWizard(COMPLETE, 'opis');
    const title = screen.getByLabelText('Tytuł');
    await user.clear(title);
    // Wklejenie zamiast wpisywania znak po znaku: w CI 26 zdarzeń klawiatury i autozapis
    // przekraczały limit czasu testu, a autozapis sprawdza to samo.
    await user.paste('Wazon z Ćmielowa, lata 70.');
    await waitFor(
      () => {
        expect(apiCalls(fetchMock, `/v1/auctions/${ID}`).map((call) => call.body)).toEqual([
          { title: 'Wazon z Ćmielowa, lata 70.' },
        ]);
      },
      { timeout: 3000 },
    );
    expect(await screen.findByText('Zapisano')).toBeDefined();
    expect(screen.getByText('26 z 80 znaków')).toBeDefined();
  });

  it('gabaryt XL: wymiary i waga, przewoźnicy bez obsługi XL odznaczeni i nieaktywni', async () => {
    api();
    const user = userEvent.setup();
    renderWizard(COMPLETE, 'dostawa');
    const locker = await screen.findByRole('checkbox', {
      name: 'InPost Paczkomat 24/7 paczkomat',
    });
    expect(locker.getAttribute('aria-checked')).toBe('true');

    await user.click(screen.getByRole('radio', { name: /^XL/u }));
    const disabled = screen.getByRole('checkbox', {
      name: 'InPost Paczkomat 24/7 nie obsługuje gabarytu XL',
    });
    expect(disabled.getAttribute('aria-checked')).toBe('false');
    expect(disabled.hasAttribute('disabled')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Dalej' }));
    await waitFor(() => {
      expect(visible(screen.getAllByText('Podaj wymiary paczki (gabaryt XL).'))).toHaveLength(3);
    });
    expect(visible(screen.getAllByText('Podaj wagę paczki (gabaryt XL).'))).toHaveLength(1);
    expect(visible(screen.getAllByText('Wybierz co najmniej jednego przewoźnika.'))).toHaveLength(
      1,
    );
  });

  it('ceny: Kup teraz poniżej 130%, zły format, cena łączna dla kupującego i limit konta', async () => {
    api();
    const user = userEvent.setup();
    renderWizard(COMPLETE, 'cena');
    const start = screen.getByLabelText('Cena wywoławcza (zł)');
    await user.clear(start);
    await user.type(start, '100');
    await user.type(screen.getByLabelText('Kup teraz (zł), opcjonalnie'), '129');
    await user.type(screen.getByLabelText('Cena minimalna (zł), opcjonalnie'), '12,5x');
    expect(await screen.findByText(/zapłacisz/u)).toBeDefined();
    await waitFor(() => {
      expect(screen.getByText(/zapłacisz/u).textContent?.replaceAll('\u00a0', ' ')).toBe(
        'Licytujesz 100 zł · zapłacisz 109,99 zł',
      );
    });
    expect(screen.getByText(/Twój limit wartości aukcji to 500/u)).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Dalej' }));
    await waitFor(() => {
      expect(
        visible(screen.getAllByText(/co najmniej 130% ceny wywoławczej, czyli/u)).map((element) =>
          element.textContent.replaceAll('\u00a0', ' '),
        ),
      ).toEqual(['Cena Kup teraz musi wynosić co najmniej 130% ceny wywoławczej, czyli 130 zł.']);
    });
    expect(visible(screen.getAllByText('Podaj kwotę w złotych, np. 12,50.'))).toHaveLength(1);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('pierwsza publikacja: informacja o KYC wymaga potwierdzenia, potem publikacja i Moje aukcje', async () => {
    const fetchMock = api({
      [`/v1/auctions/${ID}/publish`]: { ...COMPLETE, status: 'ACTIVE' },
    });
    const user = userEvent.setup();
    renderWizard(COMPLETE, 'podglad');
    expect(await screen.findByText('Wszystko gotowe do publikacji.')).toBeDefined();
    const kyc = await screen.findByRole('checkbox', {
      name: 'Rozumiem, że wypłata środków wymaga weryfikacji tożsamości',
    });
    await user.click(screen.getByRole('button', { name: 'Opublikuj aukcję' }));
    expect(
      await screen.findByText(
        'Potwierdź, że znasz zasady weryfikacji tożsamości przed wypłatą środków.',
      ),
    ).toBeDefined();
    expect(apiCalls(fetchMock, `/v1/auctions/${ID}/publish`)).toEqual([]);

    await user.click(kyc);
    await user.click(screen.getByRole('button', { name: 'Opublikuj aukcję' }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/moje-biddy/aukcje?opublikowano=${ID}`);
    });
    expect(apiCalls(fetchMock, `/v1/auctions/${ID}/publish`).map((call) => call.body)).toEqual([
      { kycNoticeAccepted: true },
    ]);
  });

  it('błędy publikacji z API: lista braków z linkami do kroków', async () => {
    api({
      '/v1/me/selling-limits': { ...LIMITS, kycNoticeAccepted: true },
      [`/v1/auctions/${ID}/publish`]: () =>
        Response.json(
          {
            type: 'https://biddy.pl/problems/validation-failed',
            title: 'Błąd walidacji',
            status: 400,
            detail: 'Uzupełnij albo popraw ofertę.',
            instance: `/v1/auctions/${ID}/publish`,
            code: 'VALIDATION_FAILED',
            requestId: 'test',
            errors: [
              {
                path: 'title',
                code: 'custom',
                message: 'Takich przedmiotów nie można sprzedawać na Biddy („naboj”).',
              },
            ],
          },
          { status: 400, headers: { 'content-type': 'application/problem+json' } },
        ),
    });
    const user = userEvent.setup();
    renderWizard(COMPLETE, 'podglad');
    await screen.findByText('Wszystko gotowe do publikacji.');
    await user.click(screen.getByRole('button', { name: 'Opublikuj aukcję' }));
    expect(
      await screen.findByText('Takich przedmiotów nie można sprzedawać na Biddy („naboj”).'),
    ).toBeDefined();
    expect(screen.getByRole('link', { name: 'Przejdź do kroku „Opis”' }).getAttribute('href')).toBe(
      `/wystaw/${ID}?krok=opis`,
    );
    expect(screen.getByRole('alert').textContent).toBe('Uzupełnij albo popraw ofertę.');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('bez zweryfikowanego telefonu: zamiast publikacji link do weryfikacji z powrotem', async () => {
    api();
    renderWizard(COMPLETE, 'podglad', false);
    const link = await screen.findByRole('link', { name: 'Zweryfikuj telefon' });
    expect(link.getAttribute('href')).toBe(
      `/weryfikacja-telefonu?next=${encodeURIComponent(`/wystaw/${ID}?krok=podglad`)}`,
    );
    expect(screen.queryByRole('button', { name: 'Opublikuj aukcję' })).toBeNull();
  });

  it('aukcja z ofertami albo zakończona: komunikat zamiast kreatora', () => {
    api();
    renderWizard({ ...COMPLETE, status: 'ACTIVE', editable: false, bidCount: 2 }, 'zdjecia');
    expect(
      screen.getByText('Tej aukcji nie można już zmienić: ma oferty albo się zakończyła.'),
    ).toBeDefined();
  });
});

const SUMMARY: AuctionSummaryDto = {
  id: ID,
  publicId: 'k3x9qa7m',
  status: 'ACTIVE',
  editable: false,
  title: 'Wazon ceramiczny',
  coverUrl: null,
  currency: 'PLN',
  startPrice: 2_000,
  currentPrice: 2_500,
  bidCount: 3,
  endsAt: '2026-10-22T10:00:00.000Z',
  updatedAt: '2026-10-15T10:00:00.000Z',
  order: null,
  completedSteps: null,
};

describe('MyAuctions', () => {
  it('statusy, filtr, anulowanie z ostrzeżeniem o strike przy ofertach', async () => {
    const ended: AuctionSummaryDto = {
      ...SUMMARY,
      id: '01960000-0000-7000-8000-000000000002',
      status: 'ENDED_UNSOLD',
      title: 'Lampa',
      bidCount: 0,
      currentPrice: null,
    };
    const fetchMock = mockApi({
      '/v1/me/auctions': [SUMMARY, ended],
      [`/v1/auctions/${ID}/cancel`]: { ...COMPLETE, status: 'CANCELLED' },
    });
    const user = userEvent.setup();
    render(<MyAuctions initial={[SUMMARY, ended]} publishedId={ID} />, { wrapper: AppWrapper });

    expect(screen.getByRole('status').textContent).toMatch(
      /Aukcja „Wazon ceramiczny” jest aktywna do/u,
    );
    expect(screen.getByText('3 oferty')).toBeDefined();
    expect(screen.getByText('Bez sprzedaży')).toBeDefined();

    expect(screen.getByRole('button', { name: 'Wszystkie 2' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Zakończone 1' }));
    expect(screen.queryByText('Wazon ceramiczny')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Aktywne 1' }));
    // Aktywna z ofertami: „Trwa licytacja”, link do aukcji i „Pokaż licytację”.
    expect(screen.getByText('Trwa licytacja')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Wazon ceramiczny' }).getAttribute('href')).toBe(
      '/a/wazon-ceramiczny-k3x9qa7m',
    );
    expect(screen.getByRole('link', { name: 'Pokaż licytację: Wazon ceramiczny' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Anuluj aukcję' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/anulowanie oznacza ostrzeżenie \(strike\)/u)).toBeDefined();
    await user.click(within(dialog).getByRole('button', { name: 'Anuluj aukcję' }));
    await waitFor(() => {
      expect(apiCalls(fetchMock, `/v1/auctions/${ID}/cancel`)).toHaveLength(1);
    });
  });

  it('ponowne wystawienie: nowy szkic i przejście do kreatora', async () => {
    const ended: AuctionSummaryDto = {
      ...SUMMARY,
      status: 'CANCELLED',
      bidCount: 0,
      currentPrice: null,
    };
    const copyId = '01960000-0000-7000-8000-000000000009';
    mockApi({
      '/v1/me/auctions': [ended],
      [`/v1/auctions/${ID}/relist`]: { ...COMPLETE, id: copyId },
    });
    const user = userEvent.setup();
    render(<MyAuctions initial={[ended]} publishedId={undefined} />, { wrapper: AppWrapper });
    await user.click(screen.getByRole('button', { name: 'Wystaw ponownie' }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/wystaw/${copyId}`);
    });
  });
});

describe('SellStart (F-63)', () => {
  it('szkice z postępem: krok do uzupełnienia, pasek i „Kontynuuj” do tego kroku', async () => {
    const draft = (id: string, title: string | null, completedSteps: number) => ({
      ...SUMMARY,
      id,
      status: 'DRAFT' as const,
      editable: true,
      title,
      currentPrice: null,
      bidCount: 0,
      endsAt: null,
      completedSteps,
    });
    mockApi({
      '/v1/me/auctions': [
        draft('01960000-0000-7000-8000-000000000011', 'Wazon ceramiczny', 3),
        draft('01960000-0000-7000-8000-000000000012', null, 0),
      ],
      '/v1/me/selling-limits': LIMITS,
    });
    render(<SellStart phoneVerified />, { wrapper: AppWrapper });
    expect(await screen.findByText(/Krok 4 z 6: Dostawa/u)).toBeDefined();
    expect(screen.getByText(/Krok 1 z 6: Zdjęcia/u)).toBeDefined();
    expect(
      screen.getByRole('link', { name: 'Kontynuuj: Wazon ceramiczny' }).getAttribute('href'),
    ).toBe('/wystaw/01960000-0000-7000-8000-000000000011?krok=dostawa');
    expect(
      screen.getByRole('link', { name: 'Kontynuuj: Szkic bez tytułu' }).getAttribute('href'),
    ).toBe('/wystaw/01960000-0000-7000-8000-000000000012?krok=zdjecia');
    expect(screen.getByRole('button', { name: 'Nowa aukcja' })).toBeDefined();
  });
});

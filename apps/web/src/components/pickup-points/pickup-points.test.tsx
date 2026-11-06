import type { SavedPickupPointDto } from '@biddy/api-client';
import type * as NavigationModule from 'next/navigation';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as ConfigModule from '@/config';
import { resetFurgonetkaMapForTests } from '@/lib/pickup-points/furgonetka-map';
import { apiCalls, mockApi } from '@/test/api';
import { AppWrapper } from '@/test/providers';

import { NewPickupPointForm } from './new-pickup-point-form';
import { type ChosenPoint, PickupPointPicker } from './pickup-point-picker';
import { SavedPickupPointList } from './saved-pickup-point-list';

const settings = vi.hoisted((): { mapKey: string | undefined } => ({ mapKey: 'klucz-mapy' }));

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>();
  return {
    config: {
      ...actual.config,
      get furgonetkaMapKey() {
        return settings.mapKey;
      },
    },
  };
});

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof NavigationModule>()),
  useRouter: () => router,
}));

const POINT_MAP = { provider: 'furgonetka', service: 'inpost', env: 'sandbox' } as const;
const WAW = {
  id: 'WAW01M',
  name: 'Paczkomat WAW01M',
  address: 'ul. Marszałkowska 1, 00-001 Warszawa',
  location: null,
  distanceMeters: null,
  openingHours: '24/7',
};

/** Atrapa skryptu mapy: zapamiętuje opcje i pozwala „wybrać” punkt. */
function installMap() {
  const maps: { options: Record<string, unknown>; show: ReturnType<typeof vi.fn> }[] = [];
  window.Furgonetka = {
    Map: vi.fn(function FakeMap(options: Record<string, unknown>) {
      const map = { options, show: vi.fn() };
      maps.push(map);
      return map;
    }) as unknown as NonNullable<Window['Furgonetka']>['Map'],
  };
  const pick = (code: string, type = 'inpost') => {
    const callback = maps.at(-1)?.options['callback'] as (params: unknown) => void;
    callback({ point: { code, name: code, type } });
  };
  const close = () => {
    (maps.at(-1)?.options['closeModalCallback'] as () => void)();
  };
  return { maps, pick, close };
}

function Picker(props: {
  readonly saved?: readonly SavedPickupPointDto[];
  readonly onChange?: (point: ChosenPoint | null, source?: string) => void;
  readonly pointMap?: typeof POINT_MAP | null;
}) {
  return (
    <PickupPointPicker
      carrierId="inpost-paczkomat"
      carrierKind="LOCKER"
      pointMap={props.pointMap === undefined ? POINT_MAP : props.pointMap}
      saved={props.saved ?? []}
      near={{ city: 'Warszawa', postcode: '00-238' }}
      context="checkout"
      value={null}
      onChange={props.onChange ?? vi.fn()}
      error={undefined}
    />
  );
}

afterEach(() => {
  resetFurgonetkaMapForTests();
  settings.mapKey = 'klucz-mapy';
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('PickupPointPicker: mapa (F-64)', () => {
  it('mapa jednej usługi z kluczem i miastem; punkt z mapy sprawdzony w API; fokus po zamknięciu', async () => {
    const user = userEvent.setup();
    const map = installMap();
    const fetchMock = mockApi({ '/v1/shipping/points/WAW01M': WAW });
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />, { wrapper: AppWrapper });

    // Wyszukiwarka jest zwinięta, gdy jest mapa.
    expect(screen.queryByRole('textbox', { name: 'Miasto, adres albo kod punktu' })).toBeNull();
    const open = screen.getByRole('button', { name: 'Wybierz na mapie' });
    await user.click(open);
    await waitFor(() => {
      expect(map.maps).toHaveLength(1);
    });
    expect(map.maps[0]?.options).toMatchObject({
      apiKey: 'klucz-mapy',
      env: 'sandbox',
      courierServices: ['inpost'],
      courierServicesFilter: ['inpost'],
      availableServiceTypes: ['parcel_machine'],
      showServiceTypeFilter: false,
      city: 'Warszawa',
      postcode: '00-238',
      locale: 'pl',
    });
    expect(map.maps[0]?.show).toHaveBeenCalled();

    map.close();
    expect(document.activeElement).toBe(open);

    map.pick('WAW01M');
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        { id: 'WAW01M', name: 'Paczkomat WAW01M', address: 'ul. Marszałkowska 1, 00-001 Warszawa' },
        'map',
      );
    });
    expect(apiCalls(fetchMock, '/v1/shipping/points/WAW01M')).toHaveLength(1);
  });

  it('punkt innej usługi odrzucony bez zapytania; nieznany punkt z komunikatem', async () => {
    const user = userEvent.setup();
    const map = installMap();
    const fetchMock = mockApi({
      '/v1/shipping/points/X1': () =>
        Response.json(
          {
            type: 'https://biddy.pl/problems/pickup-point-not-found',
            title: 'Nie ma takiego punktu',
            status: 422,
            detail: 'Nie znaleziono wybranego punktu odbioru.',
            instance: '/v1/shipping/points/X1',
            code: 'PICKUP_POINT_NOT_FOUND',
            requestId: 'test',
          },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
    });
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />, { wrapper: AppWrapper });
    await user.click(screen.getByRole('button', { name: 'Wybierz na mapie' }));
    await waitFor(() => {
      expect(map.maps).toHaveLength(1);
    });

    map.pick('DHL1', 'dhl');
    expect(
      await screen.findByText(/Ten punkt nie obsługuje wybranej dostawy albo jest nieczynny/u),
    ).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();

    map.pick('X1');
    await waitFor(() => {
      expect(apiCalls(fetchMock, '/v1/shipping/points/X1')).toHaveLength(1);
    });
    expect(screen.getByRole('alert').textContent).toMatch(/nieczynny/u);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('skrypt mapy się nie wczytał: ostrzeżenie i rozwinięta wyszukiwarka', async () => {
    const user = userEvent.setup();
    mockApi({});
    const appended: Node[] = [];
    vi.spyOn(document.head, 'append').mockImplementation((...nodes) => {
      appended.push(...(nodes as Node[]));
    });
    render(<Picker />, { wrapper: AppWrapper });
    await user.click(screen.getByRole('button', { name: 'Wybierz na mapie' }));
    await waitFor(() => {
      expect(appended).toHaveLength(1);
    });
    appended[0]?.dispatchEvent(new Event('error'));
    expect(await screen.findByText(/Nie udało się wczytać mapy/u)).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Miasto, adres albo kod punktu' })).toBeDefined();
  });

  it('bez klucza albo bez mapy u dostawcy: od razu wyszukiwarka; zapisane punkty jako karty', async () => {
    const user = userEvent.setup();
    settings.mapKey = undefined;
    mockApi({});
    const onChange = vi.fn();
    const saved: SavedPickupPointDto[] = [
      {
        id: '01960000-0000-7000-8000-0000000003a1',
        carrierId: 'inpost-paczkomat',
        pointId: 'WAW01M',
        name: 'Paczkomat WAW01M',
        address: 'ul. Marszałkowska 1',
        openingHours: null,
        isDefault: true,
        createdAt: '2026-11-01T10:00:00.000Z',
      },
    ];
    const { rerender } = render(<Picker saved={saved} onChange={onChange} />, {
      wrapper: AppWrapper,
    });
    expect(screen.queryByRole('button', { name: 'Wybierz na mapie' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Miasto, adres albo kod punktu' })).toBeDefined();
    const group = screen.getByRole('group', { name: 'Twoje punkty' });
    expect(within(group).getByText('Domyślny')).toBeDefined();
    await user.click(within(group).getByRole('radio'));
    expect(onChange).toHaveBeenCalledWith(
      { id: 'WAW01M', name: 'Paczkomat WAW01M', address: 'ul. Marszałkowska 1' },
      'saved',
    );

    settings.mapKey = 'klucz-mapy';
    rerender(<Picker pointMap={null} />);
    expect(screen.queryByRole('button', { name: 'Wybierz na mapie' })).toBeNull();
  });
});

const SAVED: SavedPickupPointDto = {
  id: '01960000-0000-7000-8000-0000000003a1',
  carrierId: 'inpost-paczkomat',
  pointId: 'WAW01M',
  name: 'Paczkomat WAW01M',
  address: 'ul. Marszałkowska 1',
  openingHours: '24/7',
  isDefault: false,
  createdAt: '2026-11-01T10:00:00.000Z',
};

describe('Punkty odbioru w koncie (F-64)', () => {
  it('lista: domyślny, ustawienie domyślnego i usunięcie z potwierdzeniem', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({ [`/v1/me/pickup-points/${SAVED.id}`]: () => SAVED });
    render(
      <SavedPickupPointList
        points={[
          SAVED,
          { ...SAVED, id: 'p2', pointId: 'KRA01M', name: 'Paczkomat KRA01M', isDefault: true },
        ]}
        carrierNames={{ 'inpost-paczkomat': 'InPost Paczkomat 24/7' }}
        canAdd
      />,
      { wrapper: AppWrapper },
    );
    expect(screen.getByText('Domyślny dla: InPost Paczkomat 24/7')).toBeDefined();
    await user.click(screen.getByRole('button', { name: /^Ustaw jako domyślny.*WAW01M$/u }));
    await waitFor(() => {
      expect(apiCalls(fetchMock, `/v1/me/pickup-points/${SAVED.id}`)[0]?.body).toEqual({
        isDefault: true,
      });
    });
    expect(router.refresh).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /^Usuń.*WAW01M$/u }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Punkt Paczkomat WAW01M zniknie/u)).toBeDefined();
    await user.click(within(dialog).getByRole('button', { name: 'Usuń punkt' }));
    await waitFor(() => {
      expect(apiCalls(fetchMock, `/v1/me/pickup-points/${SAVED.id}`)).toHaveLength(2);
    });
    expect(screen.getByRole('link', { name: 'Dodaj punkt odbioru' })).toBeDefined();
  });

  it('nowy punkt: usługa, punkt z wyszukiwarki, pierwszy punkt usługi domyślny', async () => {
    const user = userEvent.setup();
    settings.mapKey = undefined;
    const fetchMock = mockApi({
      '/v1/shipping/points': [WAW],
      '/v1/me/pickup-points': () => Response.json({ ...SAVED, isDefault: true }, { status: 201 }),
    });
    render(
      <NewPickupPointForm
        carriers={[
          {
            id: 'inpost-paczkomat',
            name: 'InPost Paczkomat 24/7',
            kind: 'LOCKER',
            packageSizes: ['S', 'M', 'L'],
            pointMap: null,
          },
          {
            id: 'orlen-paczka',
            name: 'Orlen Paczka',
            kind: 'PICKUP_POINT',
            packageSizes: ['S', 'M', 'L'],
            pointMap: null,
          },
        ]}
        saved={[{ ...SAVED, carrierId: 'orlen-paczka' }]}
        near={undefined}
      />,
      { wrapper: AppWrapper },
    );
    await user.click(screen.getByRole('button', { name: 'Zapisz punkt' }));
    expect(await screen.findByText('Wybierz punkt odbioru.')).toBeDefined();

    const checkbox = screen.getByRole('checkbox', { name: 'Ustaw jako domyślny dla tej usługi' });
    expect(checkbox).toHaveProperty('disabled', true);
    expect(checkbox).toHaveProperty('checked', true);
    await user.type(
      screen.getByRole('textbox', { name: 'Miasto, adres albo kod punktu' }),
      'Warszawa',
    );
    await user.click(screen.getByRole('button', { name: 'Szukaj' }));
    await user.click(await screen.findByRole('radio', { name: /Paczkomat WAW01M/u }));
    await user.click(screen.getByRole('button', { name: 'Zapisz punkt' }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/konto/adresy?punkt=zapisany');
    });
    expect(apiCalls(fetchMock, '/v1/me/pickup-points')[0]?.body).toEqual({
      carrierId: 'inpost-paczkomat',
      pointId: 'WAW01M',
      isDefault: true,
    });

    // Usługa, która ma już punkt: domyślny tylko na życzenie.
    await user.click(screen.getByRole('radio', { name: /Orlen Paczka/u }));
    expect(
      screen.getByRole('checkbox', { name: 'Ustaw jako domyślny dla tej usługi' }),
    ).toHaveProperty('checked', false);
  });
});

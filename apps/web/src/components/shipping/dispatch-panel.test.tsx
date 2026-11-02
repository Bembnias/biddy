import type { AddressDto, OrderShipmentDto, ShipmentDto } from '@biddy/api-client';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiCalls, mockApi } from '@/test/api';
import { AppWrapper } from '@/test/providers';

import { DispatchPanel } from './dispatch-panel';

const PUBLIC_ID = 'k3x9qa7m';
const SHIPMENT_PATH = `/v1/orders/${PUBLIC_ID}/shipment`;

function shipment(overrides: Partial<ShipmentDto> = {}): ShipmentDto {
  return {
    id: '01960000-0000-7000-8000-0000000000a1',
    direction: 'OUTBOUND',
    status: 'PENDING',
    carrier: { id: 'inpost-paczkomat', name: 'InPost Paczkomat 24/7', kind: 'LOCKER' },
    packageSize: 'M',
    pickupPoint: {
      id: 'WAW01M',
      name: 'Paczkomat WAW01M',
      address: 'ul. Prosta 1, 00-001 Warszawa',
    },
    recipient: { name: 'Jan Kupujący', city: null },
    sender: null,
    dispatchMethod: null,
    dispatchMethods: ['DROP_OFF'],
    currency: 'PLN',
    price: 1_399,
    trackingNumber: null,
    dropoffCode: null,
    labelAvailable: false,
    lastError: null,
    events: [],
    requestedAt: null,
    deliveredAt: null,
    createdAt: '2026-10-22T10:00:00.000Z',
    ...overrides,
  };
}

function view(
  value: ShipmentDto | null,
  order: Partial<OrderShipmentDto['order']> = {},
): OrderShipmentDto {
  return {
    order: {
      id: '01960000-0000-7000-8000-0000000000b1',
      publicId: PUBLIC_ID,
      status: 'PAID',
      role: 'SELLER',
      title: 'Wazon ceramiczny, lata 70.',
      ...order,
    },
    shipment: value,
  };
}

const senderAddress: AddressDto = {
  id: '01960000-0000-7000-8000-0000000000c1',
  recipientName: 'Anna Sprzedająca',
  street: 'ul. Długa 5',
  postalCode: '30-001',
  city: 'Kraków',
  country: 'PL',
  phone: '+48500600700',
  isDefault: false,
  isSenderDefault: true,
} as AddressDto;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DispatchPanel (strona nadania, F-24)', () => {
  it('formularz z domyślnym adresem nadania; „Nadaj” wysyła dane, potem kod nadania i etykieta', async () => {
    let created = false;
    const fetchMock = mockApi({
      [SHIPMENT_PATH]: (method: string) => {
        if (method === 'POST') {
          created = true;
          return view(shipment({ status: 'REQUESTED', dispatchMethod: 'DROP_OFF' }));
        }
        return created
          ? view(
              shipment({
                status: 'CREATED',
                trackingNumber: 'FS123456789012',
                dropoffCode: '482913',
                labelAvailable: true,
                events: [
                  {
                    status: 'CREATED',
                    description: 'Przesyłka przygotowana przez nadawcę',
                    occurredAt: '2026-10-22T10:05:00.000Z',
                  },
                ],
              }),
            )
          : view(shipment());
      },
      '/v1/me/addresses': [senderAddress],
      [`/v1/orders/${PUBLIC_ID}/label`]: () =>
        new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
          headers: { 'content-type': 'application/pdf' },
        }),
    });
    const createObjectURL = vi.fn(() => 'blob:etykieta');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    render(<DispatchPanel publicId={PUBLIC_ID} />, { wrapper: AppWrapper });

    expect(await screen.findByText('Paczkomat WAW01M')).toBeDefined();
    expect(screen.getByText('Zamówienie nr k3x9qa7m')).toBeDefined();
    expect(screen.getByText('Te dane będą na etykiecie i zobaczy je kupujący.')).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>('Imię i nazwisko').value).toBe(
      'Anna Sprzedająca',
    );
    expect(screen.getByLabelText<HTMLInputElement>('Miejscowość').value).toBe('Kraków');
    expect(screen.getByRole('radio', { name: /Nadam w paczkomacie lub punkcie/ })).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: 'Nadaj' }));

    expect(await screen.findByTestId('dropoff-code', {}, { timeout: 5_000 })).toBeDefined();
    expect(screen.getByTestId('dropoff-code').textContent).toBe('482913');
    expect(screen.getByText('FS123456789012')).toBeDefined();
    // Status w nagłówku i w historii przesyłki.
    expect(screen.getAllByText('Gotowa do nadania')).toHaveLength(2);
    expect(screen.getByText('Przesyłka przygotowana przez nadawcę')).toBeDefined();
    expect(
      apiCalls(fetchMock, SHIPMENT_PATH).find((call) => call.body !== undefined)?.body,
    ).toEqual({
      sender: {
        name: 'Anna Sprzedająca',
        phone: '+48 500 600 700',
        address: { street: 'ul. Długa 5', postalCode: '30-001', city: 'Kraków' },
      },
      dispatchMethod: 'DROP_OFF',
    });

    await userEvent.click(screen.getByRole('button', { name: 'Pobierz etykietę (PDF)' }));
    await waitFor(() => {
      expect(click).toHaveBeenCalled();
    });
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  });

  it('błąd pola z API trafia pod pole; błąd przewoźnika z poprzedniej próby nad formularzem', async () => {
    mockApi({
      [SHIPMENT_PATH]: (method: string) =>
        method === 'POST'
          ? Response.json(
              {
                type: 'https://biddy.pl/problems/validation-failed',
                title: 'Nieprawidłowe dane',
                status: 400,
                detail: 'Żądanie zawiera nieprawidłowe dane.',
                instance: SHIPMENT_PATH,
                code: 'VALIDATION_FAILED',
                requestId: 'test',
                errors: [
                  {
                    path: 'sender.phone',
                    code: 'custom',
                    message: 'Podaj polski numer komórkowy.',
                  },
                ],
              },
              { status: 400, headers: { 'content-type': 'application/problem+json' } },
            )
          : view(shipment({ lastError: 'Przewoźnik odrzucił numer telefonu nadawcy.' })),
      '/v1/me/addresses': [senderAddress],
    });
    render(<DispatchPanel publicId={PUBLIC_ID} />, { wrapper: AppWrapper });

    expect(await screen.findByText('Przewoźnik odrzucił numer telefonu nadawcy.')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Nadaj' }));
    expect(await screen.findByText('Podaj polski numer komórkowy.')).toBeDefined();
  });

  it('bez domyślnego adresu: podpowiedź z linkiem do adresów', async () => {
    mockApi({ [SHIPMENT_PATH]: view(shipment()), '/v1/me/addresses': [] });
    render(<DispatchPanel publicId={PUBLIC_ID} />, { wrapper: AppWrapper });
    expect(await screen.findByText(/Ustaw domyślny adres nadania w koncie/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Adresy w koncie' }).getAttribute('href')).toBe(
      '/konto/adresy',
    );
  });

  it.each([
    [
      'nieopłacone',
      view(shipment(), { status: 'AWAITING_PAYMENT' }),
      'To zamówienie nie czeka na nadanie.',
    ],
    ['bez wybranej dostawy', view(null), 'To zamówienie nie czeka na nadanie.'],
    ['kupujący', view(shipment(), { role: 'BUYER' }), 'Nie znaleziono zamówienia.'],
  ])('%s: komunikat zamiast formularza', async (_label, body, message) => {
    mockApi({ [SHIPMENT_PATH]: body, '/v1/me/addresses': [] });
    render(<DispatchPanel publicId={PUBLIC_ID} />, { wrapper: AppWrapper });
    expect(await screen.findByText(message)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Nadaj' })).toBeNull();
  });

  it('nieznane zamówienie (404): komunikat bez ponawiania', async () => {
    mockApi({});
    render(<DispatchPanel publicId={PUBLIC_ID} />, { wrapper: AppWrapper });
    expect(await screen.findByText('Nie znaleziono zamówienia.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Spróbuj ponownie' })).toBeNull();
  });
});

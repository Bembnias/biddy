import type { AddressDto, CheckoutDto } from '@biddy/api-client';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkoutStage } from '@/lib/checkout/checkout';
import { apiCalls, mockApi } from '@/test/api';
import { AppWrapper } from '@/test/providers';

import { CheckoutPanel } from './checkout-panel';

const PUBLIC_ID = 'p7q2m4nx';
const CHECKOUT_PATH = `/v1/orders/${PUBLIC_ID}/checkout`;
const DELIVERY_PATH = `/v1/orders/${PUBLIC_ID}/delivery`;
const PAYMENTS_PATH = `/v1/orders/${PUBLIC_ID}/payments`;

const LOCKER = {
  carrierId: 'inpost-paczkomat',
  name: 'InPost Paczkomat 24/7',
  kind: 'LOCKER',
  price: 1_399,
  currency: 'PLN',
  requiresPickupPoint: true,
  pointMap: null,
} as const;
const COURIER = {
  carrierId: 'inpost-kurier',
  name: 'Kurier InPost',
  kind: 'COURIER',
  price: 1_799,
  currency: 'PLN',
  requiresPickupPoint: false,
  pointMap: null,
} as const;

function checkout(
  overrides: Partial<CheckoutDto> = {},
  order: Partial<CheckoutDto['order']> = {},
): CheckoutDto {
  return {
    order: {
      id: '01960000-0000-7000-8000-000000000101',
      publicId: PUBLIC_ID,
      status: 'AWAITING_PAYMENT',
      title: 'Wazon ceramiczny, lata 70.',
      photoUrl: null,
      auction: { publicId: 'k3x9qa7p', slug: 'wazon-ceramiczny-lata-70' },
      currency: 'PLN',
      itemsTotal: 10_000,
      pokFee: 999,
      shippingFee: null,
      total: 10_999,
      paymentDueAt: '2026-10-28T18:00:00.000Z',
      effectiveDueAt: '2026-10-28T18:00:00.000Z',
      paidAt: null,
      shipBy: null,
      ...order,
    },
    blocker: null,
    options: [LOCKER, COURIER],
    delivery: null,
    payment: null,
    paymentMethods: ['BLIK', 'CARD', 'PAY_BY_LINK'],
    ...overrides,
  };
}

const withLocker = (overrides: Partial<CheckoutDto> = {}) =>
  checkout(
    {
      delivery: {
        carrierId: LOCKER.carrierId,
        name: LOCKER.name,
        kind: 'LOCKER',
        price: LOCKER.price,
        pickupPoint: { id: 'WAW01M', name: 'Paczkomat WAW01M', address: 'ul. Prosta 1, Warszawa' },
        recipient: { name: 'Jan Kupujący', phone: '+48600700800', address: null },
      },
      ...overrides,
    },
    { shippingFee: LOCKER.price, total: 12_398 },
  );

const defaultAddress = {
  id: '01960000-0000-7000-8000-0000000000c1',
  recipientName: 'Jan Kupujący',
  street: 'ul. Długa 5/12',
  postalCode: '00-238',
  city: 'Warszawa',
  country: 'PL',
  phone: '+48600700800',
  isDefault: true,
  isSenderDefault: false,
} as AddressDto;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('etap checkoutu', () => {
  it('formularz, oczekiwanie, opłacone i termin minął', () => {
    expect(checkoutStage(checkout())).toBe('form');
    const payment = {
      id: '01960000-0000-7000-8000-0000000000d1',
      method: 'BLIK',
      failureReason: null,
      redirectUrl: null,
      amount: 12_398,
      createdAt: '2026-10-27T18:00:00.000Z',
    } as const;
    expect(checkoutStage(checkout({ payment: { ...payment, status: 'PENDING' } }))).toBe('waiting');
    expect(checkoutStage(checkout({ payment: { ...payment, status: 'SUCCEEDED' } }))).toBe(
      'waiting',
    );
    expect(
      checkoutStage(
        checkout({ payment: { ...payment, status: 'FAILED', failureReason: 'DECLINED' } }),
      ),
    ).toBe('form');
    expect(checkoutStage(checkout({}, { status: 'PAID' }))).toBe('paid');
    expect(checkoutStage(checkout({}, { status: 'CANCELLED_UNPAID' }))).toBe('expired');
    expect(checkoutStage(checkout({ blocker: 'PAYMENT_DEADLINE_PASSED' }))).toBe('expired');
  });
});

describe('CheckoutPanel (F-25)', () => {
  it('paczkomat i BLIK: wyszukanie punktu, zapis dostawy, płatność z sumą z przycisku i oczekiwanie', async () => {
    let state = checkout();
    const fetchMock = mockApi({
      [CHECKOUT_PATH]: () => state,
      '/v1/me/addresses': [defaultAddress],
      '/v1/shipping/points': [
        {
          id: 'WAW01M',
          name: 'Paczkomat WAW01M',
          address: 'ul. Prosta 1, Warszawa',
          location: null,
          distanceMeters: null,
          openingHours: '24/7',
        },
      ],
      [DELIVERY_PATH]: () => {
        state = withLocker();
        return state;
      },
      [PAYMENTS_PATH]: () => {
        state = withLocker({
          blocker: 'PAYMENT_IN_PROGRESS',
          payment: {
            id: '01960000-0000-7000-8000-0000000000d1',
            status: 'PENDING',
            method: 'BLIK',
            failureReason: null,
            redirectUrl: null,
            amount: 12_398,
            createdAt: '2026-10-27T18:00:00.000Z',
          },
        });
        return Response.json(state, { status: 201 });
      },
    });
    const user = userEvent.setup();
    render(<CheckoutPanel publicId={PUBLIC_ID} />, { wrapper: AppWrapper });

    expect(await screen.findByRole('heading', { name: 'Zapłać za zamówienie' })).toBeDefined();
    expect(await screen.findByText('Zamówienie nr p7q2m4nx')).toBeDefined();
    expect(screen.getByText(/^Zapłać do /u)).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>('Imię i nazwisko').value).toBe('Jan Kupujący');
    expect(screen.getByLabelText<HTMLInputElement>('Telefon').value).toBe('+48 600 700 800');
    // Paczkomat (pierwsza opcja): suma z dostawą na przycisku, bez pól adresu.
    expect(screen.getByRole('button', { name: /^Zapłać 123,98\s+zł$/u })).toBeDefined();
    expect(screen.queryByLabelText('Ulica i numer')).toBeNull();

    // Bez punktu i kodu BLIK: błędy przy polach, bez żądań.
    await user.click(screen.getByRole('button', { name: /^Zapłać 123,98/u }));
    expect(await screen.findByText('Wpisz 6 cyfr kodu BLIK.')).toBeDefined();
    await user.type(screen.getByLabelText('Kod BLIK'), '777123');
    await user.click(screen.getByRole('button', { name: /^Zapłać 123,98/u }));
    expect(await screen.findByText('Wybierz punkt odbioru.')).toBeDefined();
    expect(apiCalls(fetchMock, DELIVERY_PATH)).toHaveLength(0);

    await user.type(screen.getByLabelText('Miasto, adres albo kod punktu'), 'Warszawa{Enter}');
    await user.click(await screen.findByRole('radio', { name: /Paczkomat WAW01M/u }));
    expect(screen.getByText('Wybrany punkt')).toBeDefined();
    await user.click(screen.getByRole('button', { name: /^Zapłać 123,98/u }));

    expect(await screen.findByText('Potwierdź płatność w aplikacji banku')).toBeDefined();
    expect(apiCalls(fetchMock, DELIVERY_PATH)[0]?.body).toEqual({
      carrierId: 'inpost-paczkomat',
      pickupPointId: 'WAW01M',
      recipient: { name: 'Jan Kupujący', phone: '+48 600 700 800', address: null },
    });
    const [payment] = apiCalls(fetchMock, PAYMENTS_PATH);
    expect(payment?.body).toEqual({ method: 'BLIK', blikCode: '777123', expectedTotal: 12_398 });
    expect(payment?.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('zapisane punkty (F-64): domyślny punkt wybrany sam, nowy punkt zapisany po wyborze dostawy', async () => {
    let state = checkout();
    const saved = {
      id: '01960000-0000-7000-8000-0000000003a1',
      carrierId: 'inpost-paczkomat',
      pointId: 'KRA01M',
      name: 'Paczkomat KRA01M',
      address: 'ul. Długa 1, Kraków',
      openingHours: '24/7',
      isDefault: true,
      createdAt: '2026-11-01T10:00:00.000Z',
    };
    const fetchMock = mockApi({
      [CHECKOUT_PATH]: () => state,
      '/v1/me/addresses': [defaultAddress],
      '/v1/me/pickup-points': (method: string) =>
        method === 'POST'
          ? Response.json(
              { ...saved, id: 'p2', pointId: 'WAW01M', isDefault: false },
              { status: 201 },
            )
          : [saved],
      '/v1/shipping/points': [
        {
          id: 'WAW01M',
          name: 'Paczkomat WAW01M',
          address: 'ul. Prosta 1, Warszawa',
          location: null,
          distanceMeters: null,
          openingHours: '24/7',
        },
      ],
      [DELIVERY_PATH]: () => {
        state = withLocker();
        return state;
      },
      [PAYMENTS_PATH]: () =>
        Response.json(
          withLocker({
            blocker: 'PAYMENT_IN_PROGRESS',
            payment: {
              id: '01960000-0000-7000-8000-0000000000d1',
              status: 'PENDING',
              method: 'BLIK',
              failureReason: null,
              redirectUrl: null,
              amount: 12_398,
              createdAt: '2026-10-27T18:00:00.000Z',
            },
          }),
          { status: 201 },
        ),
    });
    const user = userEvent.setup();
    render(<CheckoutPanel publicId={PUBLIC_ID} />, { wrapper: AppWrapper });

    // Domyślny zapisany punkt usługi jest wybrany bez klikania; zapisany nie ma pola „Zapisz”.
    expect(await screen.findByText('Paczkomat KRA01M')).toBeDefined();
    expect(screen.getByText('Wybrany punkt')).toBeDefined();
    expect(screen.queryByRole('checkbox', { name: 'Zapisz w moich punktach odbioru' })).toBeNull();

    await user.click(screen.getByRole('button', { name: /^Zmień punkt/u }));
    expect(screen.getByRole('group', { name: 'Twoje punkty' })).toBeDefined();
    await user.type(screen.getByLabelText('Miasto, adres albo kod punktu'), 'Warszawa{Enter}');
    await user.click(await screen.findByRole('radio', { name: /Paczkomat WAW01M/u }));
    await user.click(screen.getByRole('checkbox', { name: 'Zapisz w moich punktach odbioru' }));
    await user.type(screen.getByLabelText('Kod BLIK'), '777123');
    await user.click(screen.getByRole('button', { name: /^Zapłać 123,98/u }));

    expect(await screen.findByText('Potwierdź płatność w aplikacji banku')).toBeDefined();
    expect(apiCalls(fetchMock, DELIVERY_PATH)[0]?.body).toMatchObject({ pickupPointId: 'WAW01M' });
    await waitFor(() => {
      expect(
        apiCalls(fetchMock, '/v1/me/pickup-points').find((call) => call.body !== undefined)?.body,
      ).toEqual({ carrierId: 'inpost-paczkomat', pointId: 'WAW01M' });
    });
  });

  it('kurier: pola adresu z domyślnego adresu; suma zmieniona po zapisie dostawy zatrzymuje płatność', async () => {
    const fetchMock = mockApi({
      [CHECKOUT_PATH]: checkout(),
      '/v1/me/addresses': [defaultAddress],
      [DELIVERY_PATH]: () =>
        checkout(
          {
            delivery: {
              carrierId: COURIER.carrierId,
              name: COURIER.name,
              kind: 'COURIER',
              price: 1_999,
              pickupPoint: null,
              recipient: {
                name: 'Jan Kupujący',
                phone: '+48600700800',
                address: { street: 'ul. Długa 5/12', postalCode: '00-238', city: 'Warszawa' },
              },
            },
            options: [LOCKER, { ...COURIER, price: 1_999 }],
          },
          { shippingFee: 1_999, total: 12_998 },
        ),
    });
    const user = userEvent.setup();
    render(<CheckoutPanel publicId={PUBLIC_ID} />, { wrapper: AppWrapper });
    await user.click(await screen.findByRole('radio', { name: /Kurier InPost/u }));
    expect(screen.getByLabelText<HTMLInputElement>('Ulica i numer').value).toBe('ul. Długa 5/12');
    await user.click(screen.getByRole('radio', { name: /Karta płatnicza/u }));
    expect(screen.queryByLabelText('Kod BLIK')).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Zapłać 127,98/u }));

    expect(
      await screen.findByText('Kwota się zmieniła. Sprawdź podsumowanie i zapłać ponownie.'),
    ).toBeDefined();
    expect(apiCalls(fetchMock, PAYMENTS_PATH)).toHaveLength(0);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Zapłać 129,98/u })).toBeDefined();
    });
  });

  it('odrzucony BLIK: komunikat z powodem i „Zapłać ponownie” w tym samym zamówieniu', async () => {
    mockApi({
      [CHECKOUT_PATH]: withLocker({
        payment: {
          id: '01960000-0000-7000-8000-0000000000d1',
          status: 'FAILED',
          method: 'BLIK',
          failureReason: 'INVALID_BLIK_CODE',
          redirectUrl: null,
          amount: 12_398,
          createdAt: '2026-10-27T18:00:00.000Z',
        },
      }),
      '/v1/me/addresses': [],
    });
    render(<CheckoutPanel publicId={PUBLIC_ID} />, { wrapper: AppWrapper });
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Płatność nie przeszłaKod BLIK jest błędny albo wygasł. Wygeneruj nowy kod w aplikacji banku.',
    );
    expect(screen.getByText('Paczkomat WAW01M')).toBeDefined();
    expect(screen.getByRole('button', { name: /^Zapłać ponownie 123,98/u })).toBeDefined();
  });

  it('opłacone: termin nadania i linki; termin minął: zamówienie anulowane', async () => {
    mockApi({
      [CHECKOUT_PATH]: checkout(
        {},
        { status: 'PAID', paidAt: '2026-10-27T18:00:00.000Z', shipBy: '2026-11-03T23:00:00.000Z' },
      ),
      '/v1/me/addresses': [],
    });
    const paid = render(<CheckoutPanel publicId={PUBLIC_ID} />, { wrapper: AppWrapper });
    expect(await screen.findByRole('heading', { name: 'Zapłacone!' })).toBeDefined();
    expect(screen.getByText(/Sprzedający ma czas na nadanie paczki do 4 listopada/u)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Zobacz w Moje Biddy' })).toBeDefined();
    paid.unmount();

    mockApi({
      [CHECKOUT_PATH]: checkout({}, { status: 'CANCELLED_UNPAID' }),
      '/v1/me/addresses': [],
    });
    render(<CheckoutPanel publicId={PUBLIC_ID} />, { wrapper: AppWrapper });
    expect(await screen.findByRole('heading', { name: 'Termin płatności minął' })).toBeDefined();
    expect(screen.queryByRole('button', { name: /^Zapłać/u })).toBeNull();
  });

  it('zamówienie innej osoby: „Nie znaleziono zamówienia”', async () => {
    mockApi({ '/v1/me/addresses': [] });
    render(<CheckoutPanel publicId={PUBLIC_ID} />, { wrapper: AppWrapper });
    expect(await screen.findByText('Nie znaleziono zamówienia.')).toBeDefined();
  });
});

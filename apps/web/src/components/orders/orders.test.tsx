import type { OrderDetailsDto, SecondChanceOfferDto } from '@biddy/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { apiCalls, mockApi } from '@/test/api';
import { AppWrapper } from '@/test/providers';

import { OrderPanel } from './order-panel';
import { SecondChanceOffer } from './second-chance-offer';

const router = { push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const PUBLIC_ID = 'p7q2m4nx';
const ORDER_PATH = `/v1/orders/${PUBLIC_ID}`;
const OFFER_ID = '01960000-0000-7000-8000-0000000000c1';

function order(overrides: Partial<OrderDetailsDto> = {}): OrderDetailsDto {
  return {
    id: '01960000-0000-7000-8000-000000000101',
    publicId: PUBLIC_ID,
    status: 'DELIVERED',
    role: 'BUYER',
    title: 'Wazon ceramiczny, lata 70.',
    photoUrl: null,
    auction: {
      id: '01960000-0000-7000-8000-0000000000a1',
      publicId: 'k3x9qa7p',
      slug: 'wazon-ceramiczny-lata-70',
    },
    counterpart: { name: 'Anna' },
    currency: 'PLN',
    itemsTotal: 10_000,
    pokFee: 999,
    shippingFee: 1_399,
    total: 12_398,
    paymentDueAt: '2026-10-28T18:00:00.000Z',
    paidAt: '2026-10-28T10:00:00.000Z',
    shipBy: '2026-11-04T22:59:59.999Z',
    shippedAt: '2026-10-29T09:00:00.000Z',
    deliveredAt: '2026-10-30T12:00:00.000Z',
    inspectionEndsAt: '2026-11-01T00:00:00.000Z',
    buyerConfirmedAt: null,
    completedAt: null,
    cancelledAt: null,
    notPickedUpAt: null,
    lostAt: null,
    disputedAt: null,
    refundedAt: null,
    compensation: null,
    onHold: false,
    fromSecondChance: false,
    shipment: null,
    refund: null,
    actions: {
      confirmReceipt: true,
      reportNotReceived: null,
      openDispute: { until: '2026-11-01T00:00:00.000Z', allowed: true },
    },
    secondChance: null,
    ...overrides,
  };
}

describe('OrderPanel', () => {
  it('kupujący po odbiorze: termin sprawdzenia, postęp i „Wszystko OK” z potwierdzeniem', async () => {
    const fetchMock = mockApi({
      [ORDER_PATH]: order(),
      [`${ORDER_PATH}/confirm-receipt`]: order({
        status: 'COMPLETED',
        completedAt: '2026-10-30T15:00:00.000Z',
        buyerConfirmedAt: '2026-10-30T15:00:00.000Z',
        actions: { confirmReceipt: false, reportNotReceived: null, openDispute: null },
      }),
    });
    render(<OrderPanel publicId={PUBLIC_ID} />, { wrapper: AppWrapper });

    expect(
      await screen.findByRole('heading', { name: 'Wazon ceramiczny, lata 70.' }),
    ).toBeDefined();
    // Pigułka stanu i krok postępu.
    expect(screen.getAllByText('Odebrane')).toHaveLength(2);
    expect(screen.getByText(/Masz czas na sprawdzenie przedmiotu do 1 listopada/)).toBeDefined();
    const steps = screen.getByRole('region', { name: 'Postęp zamówienia' });
    expect(within(steps).getByText('Zakończone').closest('li')?.getAttribute('aria-current')).toBe(
      'step',
    );
    expect(screen.getByText('Sprzedaje: Anna')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: 'Wszystko OK' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Potwierdzić odbiór?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wszystko OK' }));
    expect(await screen.findByText('Zamówienie zakończone. Dziękujemy!')).toBeDefined();
    expect(apiCalls(fetchMock, `${ORDER_PATH}/confirm-receipt`)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Wszystko OK' })).toBeNull();
  });

  it('sprzedający po zakończeniu: cena na saldzie i link do salda (F-27)', async () => {
    mockApi({
      [ORDER_PATH]: order({
        status: 'COMPLETED',
        role: 'SELLER',
        counterpart: { name: 'Jan' },
        completedAt: '2026-10-31T10:00:00.000Z',
        actions: { confirmReceipt: false, reportNotReceived: null, openDispute: null },
      }),
    });
    render(<OrderPanel publicId={PUBLIC_ID} />, { wrapper: AppWrapper });
    expect(await screen.findByText(/100,00\s?zł jest na Twoim saldzie\./)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Saldo i wypłaty' }).getAttribute('href')).toBe(
      '/konto/saldo',
    );
  });

  it('paczka w drodze: zgłoszenie braku paczki dopiero po 14 dniach, potem z potwierdzeniem', async () => {
    const shipped = order({
      status: 'SHIPPED',
      deliveredAt: null,
      inspectionEndsAt: null,
      actions: {
        confirmReceipt: false,
        reportNotReceived: { availableAt: '2026-11-12T09:00:00.000Z', allowed: false },
        openDispute: null,
      },
    });
    mockApi({ [ORDER_PATH]: shipped });
    const { unmount } = render(<OrderPanel publicId={PUBLIC_ID} />, { wrapper: AppWrapper });
    expect(
      await screen.findByText('Paczka nie dotarła? Możesz to zgłosić od 12 listopada.'),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Zgłoś brak paczki' })).toBeNull();
    unmount();

    const fetchMock = mockApi({
      [ORDER_PATH]: {
        ...shipped,
        actions: {
          confirmReceipt: false,
          reportNotReceived: { availableAt: '2026-10-29T09:00:00.000Z', allowed: true },
          openDispute: null,
        },
      },
      [`${ORDER_PATH}/report-not-received`]: order({
        status: 'LOST',
        lostAt: '2026-11-13T09:00:00.000Z',
        refund: {
          amount: 12_398,
          reason: 'LOST',
          status: 'PENDING',
          createdAt: '2026-11-13T09:00:00.000Z',
          succeededAt: null,
        },
        actions: { confirmReceipt: false, reportNotReceived: null, openDispute: null },
      }),
    });
    render(<OrderPanel publicId={PUBLIC_ID} />, { wrapper: AppWrapper });
    await userEvent.click(await screen.findByRole('button', { name: 'Zgłoś brak paczki' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Zgłosić brak paczki?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zgłoś brak paczki' }));
    expect(await screen.findByText(/Zgłoszenie przyjęte. Zwracamy pełną kwotę/)).toBeDefined();
    expect(screen.getByText(/Zwrot 123,98\s?zł jest w drodze./)).toBeDefined();
    expect(apiCalls(fetchMock, `${ORDER_PATH}/report-not-received`)).toHaveLength(1);
  });

  it('sprzedający po braku płatności: druga szansa do kolejnej osoby i „Wystaw ponownie”', async () => {
    const cancelled = order({
      status: 'CANCELLED_UNPAID',
      role: 'SELLER',
      counterpart: { name: 'Jan' },
      shippingFee: null,
      total: 10_999,
      paidAt: null,
      shipBy: null,
      shippedAt: null,
      deliveredAt: null,
      inspectionEndsAt: null,
      cancelledAt: '2026-10-29T18:00:00.000Z',
      actions: { confirmReceipt: false, reportNotReceived: null, openDispute: null },
      secondChance: {
        next: { bidder: 'k***a', amount: 4_500 },
        offers: [],
        unavailableReason: null,
        sendBy: '2026-11-12T18:00:00.000Z',
      },
    });
    const fetchMock = mockApi({
      [ORDER_PATH]: cancelled,
      [`${ORDER_PATH}/second-chance-offers`]: {
        ...cancelled,
        secondChance: {
          next: { bidder: 't***i', amount: 3_000 },
          offers: [
            {
              id: OFFER_ID,
              bidder: 'k***a',
              amount: 4_500,
              status: 'PENDING',
              expiresAt: '2026-10-31T10:00:00.000Z',
              respondedAt: null,
              orderPublicId: null,
            },
          ],
          unavailableReason: 'OFFER_PENDING',
          sendBy: '2026-11-12T18:00:00.000Z',
        },
      },
    });
    render(<OrderPanel publicId={PUBLIC_ID} />, { wrapper: AppWrapper });

    const card = await screen.findByRole('region', { name: 'Druga szansa' });
    expect(
      within(card).getByText(/Następna osoba: k\*\*\*a, najwyższa oferta 45,00\s?zł/),
    ).toBeDefined();
    expect(within(card).getByRole('button', { name: 'Wystaw ponownie' })).toBeDefined();
    await userEvent.click(within(card).getByRole('button', { name: 'Wyślij ofertę' }));
    await waitFor(() => {
      expect(within(card).getByText(/czeka na odpowiedź do 31 października/)).toBeDefined();
    });
    expect(within(card).getByText(/Oferta czeka na odpowiedź/)).toBeDefined();
    expect(within(card).queryByRole('button', { name: 'Wyślij ofertę' })).toBeNull();
    expect(apiCalls(fetchMock, `${ORDER_PATH}/second-chance-offers`)).toHaveLength(1);
  });
});

describe('SecondChanceOffer', () => {
  const offer: SecondChanceOfferDto = {
    id: OFFER_ID,
    status: 'PENDING',
    title: 'Wazon ceramiczny, lata 70.',
    photoUrl: null,
    auction: { publicId: 'k3x9qa7p', slug: 'wazon-ceramiczny-lata-70' },
    currency: 'PLN',
    amount: 4_500,
    pokFee: 599,
    total: 5_099,
    expiresAt: '2099-10-31T10:00:00.000Z',
    respondedAt: null,
    orderPublicId: null,
  };

  it('kwoty bez dostawy; „Kup za …” tworzy zamówienie i prowadzi do płatności', async () => {
    const fetchMock = mockApi({
      [`/v1/second-chance-offers/${OFFER_ID}`]: offer,
      [`/v1/second-chance-offers/${OFFER_ID}/accept`]: {
        ...offer,
        status: 'ACCEPTED',
        orderPublicId: 'q8r3n5py',
      },
    });
    render(<SecondChanceOffer offerId={OFFER_ID} />, { wrapper: AppWrapper });
    expect(await screen.findByRole('heading', { name: 'Druga szansa' })).toBeDefined();
    expect(screen.getByText('Do zapłaty (bez dostawy)').nextElementSibling?.textContent).toMatch(
      /^50,99\s?zł$/,
    );
    await userEvent.click(screen.getByRole('button', { name: /^Kup za 45,00\s?zł$/ }));
    expect(await screen.findByRole('heading', { name: 'Oferta przyjęta' })).toBeDefined();
    expect(router.push).toHaveBeenCalledWith('/zamowienia/q8r3n5py/zaplac');
    expect(apiCalls(fetchMock, `/v1/second-chance-offers/${OFFER_ID}/accept`)).toHaveLength(1);
  });

  it('odrzucenie bez konsekwencji i oferta wygasła', async () => {
    mockApi({
      [`/v1/second-chance-offers/${OFFER_ID}`]: offer,
      [`/v1/second-chance-offers/${OFFER_ID}/decline`]: { ...offer, status: 'DECLINED' },
    });
    const { unmount } = render(<SecondChanceOffer offerId={OFFER_ID} />, { wrapper: AppWrapper });
    expect(await screen.findByText(/Oferta nie jest wiążąca/)).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Nie, dziękuję' }));
    expect(await screen.findByRole('heading', { name: 'Oferta odrzucona' })).toBeDefined();
    unmount();

    mockApi({ [`/v1/second-chance-offers/${OFFER_ID}`]: { ...offer, status: 'EXPIRED' } });
    render(<SecondChanceOffer offerId={OFFER_ID} />, { wrapper: AppWrapper });
    expect(await screen.findByRole('heading', { name: 'Oferta wygasła' })).toBeDefined();
    expect(screen.queryByRole('button', { name: /Kup za/ })).toBeNull();
  });
});

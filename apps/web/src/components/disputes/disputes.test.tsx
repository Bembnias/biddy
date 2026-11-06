import type { DisputeDto, OrderDetailsDto } from '@biddy/api-client';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { OrderPanel } from '@/components/orders/order-panel';
import { apiCalls, mockApi } from '@/test/api';
import { AppWrapper } from '@/test/providers';

import { DisputePanel } from './dispute-panel';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const PUBLIC_ID = 'p7q2m4nx';
const ORDER_PATH = `/v1/orders/${PUBLIC_ID}`;
const DISPUTE_PATH = `${ORDER_PATH}/dispute`;
const DISPUTE_ID = '01960000-0000-7000-8000-0000000000d1';

function order(overrides: Partial<OrderDetailsDto> = {}): OrderDetailsDto {
  return {
    id: '01960000-0000-7000-8000-000000000101',
    publicId: PUBLIC_ID,
    status: 'DELIVERED',
    role: 'BUYER',
    title: 'Lampa biurkowa, lata 60.',
    photoUrl: null,
    auction: {
      id: '01960000-0000-7000-8000-0000000000a1',
      publicId: 'k3x9qa7p',
      slug: 'lampa-biurkowa-lata-60',
    },
    counterpart: { name: 'Anna' },
    currency: 'PLN',
    itemsTotal: 12_000,
    pokFee: 999,
    shippingFee: 1_399,
    total: 14_398,
    paymentDueAt: '2026-10-28T18:00:00.000Z',
    paidAt: '2026-10-28T10:00:00.000Z',
    shipBy: '2026-11-04T23:00:00.000Z',
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

function dispute(overrides: Partial<DisputeDto> = {}): DisputeDto {
  return {
    id: DISPUTE_ID,
    orderId: '01960000-0000-7000-8000-000000000101',
    orderPublicId: PUBLIC_ID,
    title: 'Lampa biurkowa, lata 60.',
    status: 'AWAITING_SELLER',
    role: 'BUYER',
    reason: 'NOT_AS_DESCRIBED',
    description: 'Lampa nie działa, a w opisie była sprawna.',
    currency: 'PLN',
    itemsTotal: 12_000,
    shippingFee: 1_399,
    orderTotal: 14_398,
    createdAt: '2026-10-31T10:00:00.000Z',
    responseDueAt: '2026-11-02T10:00:00.000Z',
    escalatedAt: null,
    decisionDueAt: null,
    partialOffer: null,
    resolution: null,
    return: null,
    returnQuote: null,
    events: [
      {
        id: '01960000-0000-7000-8000-0000000000e1',
        type: 'OPENED',
        actor: 'BUYER',
        note: 'Lampa nie działa, a w opisie była sprawna.',
        amount: null,
        photos: [
          {
            id: '01960000-0000-7000-8000-0000000000f1',
            thumbUrl: 'http://api.test/v1/disputes/d1/photos/f1/thumb',
            largeUrl: 'http://api.test/v1/disputes/d1/photos/f1/large',
          },
        ],
        createdAt: '2026-10-31T10:00:00.000Z',
      },
    ],
    actions: {
      respond: false,
      answerOffer: false,
      shipReturn: false,
      reviewReturn: false,
      comment: true,
    },
    ...overrides,
  };
}

const disputedOrder = (role: 'BUYER' | 'SELLER') =>
  order({
    status: 'DISPUTED',
    role,
    disputedAt: '2026-10-31T10:00:00.000Z',
    actions: { confirmReceipt: false, reportNotReceived: null, openDispute: null },
  });

describe('DisputePanel', () => {
  it('kupujący zgłasza problem: powód, opis, zdjęcie przy wadzie; potem widzi spór', async () => {
    let opened: DisputeDto | undefined;
    const fetchMock = mockApi({
      [ORDER_PATH]: order(),
      [DISPUTE_PATH]: (method: string) => {
        if (method === 'POST') {
          opened = dispute();
          return new Response(JSON.stringify(opened), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          });
        }
        return opened;
      },
    });
    render(<DisputePanel publicId={PUBLIC_ID} />, { wrapper: AppWrapper });

    expect(await screen.findByRole('heading', { name: 'Problem z zamówieniem' })).toBeDefined();
    expect(screen.getByText(/Masz czas do 1 listopada/)).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Zgłoś problem' }));
    expect(await screen.findByText('Wybierz, co jest nie tak.')).toBeDefined();

    await userEvent.click(screen.getByRole('radio', { name: 'Przedmiot jest uszkodzony' }));
    await userEvent.type(
      screen.getByLabelText('Opisz problem'),
      'Klosz jest pęknięty w dwóch miejscach.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Zgłoś problem' }));
    expect(
      await screen.findByText('Dodaj co najmniej jedno zdjęcie problemu.', { selector: 'p' }),
    ).toBeDefined();
    expect(
      apiCalls(fetchMock, DISPUTE_PATH).filter((call) => call.body !== undefined),
    ).toHaveLength(0);

    await userEvent.click(screen.getByRole('radio', { name: 'Inny problem' }));
    await userEvent.click(screen.getByRole('button', { name: 'Zgłoś problem' }));
    expect(await screen.findByText('Czeka na sprzedającego')).toBeDefined();
    expect(screen.getByText(/Sprzedający ma czas na odpowiedź do 2 listopada/)).toBeDefined();
    const sent = apiCalls(fetchMock, DISPUTE_PATH).find((call) => call.body !== undefined);
    expect(sent?.body).toEqual({
      reason: 'OTHER',
      description: 'Klosz jest pęknięty w dwóch miejscach.',
      mediaIds: [],
    });
    const history = screen.getByRole('region', { name: 'Historia sporu' });
    expect(within(history).getByText('Zgłoszenie problemu')).toBeDefined();
    expect(within(history).getByText(/Ty/)).toBeDefined();
    expect(within(history).getByRole('img', { name: /Zdjęcie 1/ })).toBeDefined();
  });

  it('sprzedający proponuje zwrot części ceny, najwyżej cenę przedmiotu', async () => {
    const respondPath = `/v1/disputes/${DISPUTE_ID}/seller-response`;
    const fetchMock = mockApi({
      [ORDER_PATH]: disputedOrder('SELLER'),
      [DISPUTE_PATH]: dispute({
        role: 'SELLER',
        actions: {
          respond: true,
          answerOffer: false,
          shipReturn: false,
          reviewReturn: false,
          comment: true,
        },
        returnQuote: {
          carrierId: 'inpost-kurier',
          name: 'InPost Kurier',
          kind: 'COURIER',
          price: 1_699,
          currency: 'PLN',
          requiresPickupPoint: false,
          pointMap: null,
        },
      }),
      [respondPath]: dispute({
        role: 'SELLER',
        status: 'PARTIAL_OFFERED',
        partialOffer: 3_000,
        responseDueAt: '2026-11-03T10:00:00.000Z',
      }),
    });
    render(<DisputePanel publicId={PUBLIC_ID} />, { wrapper: AppWrapper });

    expect(
      await screen.findByText(/Kupujący zgłosił problem\. Odpowiedz do 2 listopada/),
    ).toBeDefined();
    expect(screen.getByText(/InPost Kurier, 16,99\s?zł/)).toBeDefined();
    await userEvent.click(screen.getByRole('radio', { name: /Zaproponuj zwrot części ceny/ }));
    await userEvent.type(screen.getByLabelText('Kwota zwrotu w zł'), '121');
    await userEvent.click(screen.getByRole('button', { name: 'Wyślij propozycję' }));
    expect(await screen.findByText(/Zwrot może wynieść najwyżej 120\s?zł\./)).toBeDefined();
    expect(apiCalls(fetchMock, respondPath)).toHaveLength(0);

    await userEvent.clear(screen.getByLabelText('Kwota zwrotu w zł'));
    await userEvent.type(screen.getByLabelText('Kwota zwrotu w zł'), '30');
    await userEvent.click(screen.getByRole('button', { name: 'Wyślij propozycję' }));
    expect(await screen.findByText(/Czekamy na odpowiedź kupującego do 3 listopada/)).toBeDefined();
    expect(apiCalls(fetchMock, respondPath)[0]?.body).toEqual({
      action: 'OFFER_PARTIAL',
      amount: 3_000,
    });
  });

  it('kupujący przyjmuje propozycję i widzi rozstrzygnięcie z uzasadnieniem', async () => {
    const answerPath = `/v1/disputes/${DISPUTE_ID}/offer-response`;
    const statement =
      'Kupujący przyjął propozycję sprzedającego: zwrot 30 zł, przedmiot zostaje u kupującego.';
    const fetchMock = mockApi({
      [ORDER_PATH]: disputedOrder('BUYER'),
      [DISPUTE_PATH]: dispute({
        status: 'PARTIAL_OFFERED',
        partialOffer: 3_000,
        actions: {
          respond: false,
          answerOffer: true,
          shipReturn: false,
          reviewReturn: false,
          comment: true,
        },
      }),
      [answerPath]: dispute({
        status: 'RESOLVED',
        partialOffer: 3_000,
        actions: {
          respond: false,
          answerOffer: false,
          shipReturn: false,
          reviewReturn: false,
          comment: false,
        },
        resolution: {
          outcome: 'PARTIAL_REFUND',
          fault: null,
          refundAmount: 3_000,
          decidedBy: 'PARTIES',
          statement,
          decidedAt: '2026-11-01T09:00:00.000Z',
          resolvedAt: '2026-11-01T09:00:00.000Z',
          sellerCosts: null,
          refund: { status: 'PENDING', succeededAt: null },
        },
      }),
    });
    render(<DisputePanel publicId={PUBLIC_ID} />, { wrapper: AppWrapper });

    expect(
      await screen.findByText(/Sprzedający proponuje zwrot 30\s?zł, a przedmiot zostaje u Ciebie/),
    ).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: /Przyjmij 30\s?zł/ }));
    expect(await screen.findByText('Rozstrzygnięty')).toBeDefined();
    expect(screen.getByText(/Zwracamy Ci 30\s?zł\. Przedmiot zostaje u Ciebie\./)).toBeDefined();
    expect(screen.getByText(statement)).toBeDefined();
    expect(screen.getByText('Porozumienie stron', { exact: false })).toBeDefined();
    expect(screen.getByText('Zwrot pieniędzy jest w drodze.')).toBeDefined();
    expect(screen.queryByRole('region', { name: 'Dodaj wyjaśnienie' })).toBeNull();
    expect(apiCalls(fetchMock, answerPath)[0]?.body).toEqual({ accept: true });
  });

  it('sprzedający po decyzji Biddy: uzasadnienie, potrącone koszty i wpisy zespołu Biddy', async () => {
    mockApi({
      [ORDER_PATH]: order({
        status: 'REFUNDED',
        role: 'SELLER',
        disputedAt: '2026-10-31T10:00:00.000Z',
      }),
      [DISPUTE_PATH]: dispute({
        role: 'SELLER',
        status: 'RESOLVED',
        actions: {
          respond: false,
          answerOffer: false,
          shipReturn: false,
          reviewReturn: false,
          comment: false,
        },
        resolution: {
          outcome: 'FULL_REFUND',
          fault: 'SELLER',
          refundAmount: 14_398,
          decidedBy: 'STAFF',
          statement: 'Zdjęcia pokazują, że lampa nie działa.',
          decidedAt: '2026-11-03T10:00:00.000Z',
          resolvedAt: '2026-11-03T10:00:00.000Z',
          sellerCosts: 1_399,
          refund: { status: 'SUCCEEDED', succeededAt: '2026-11-03T11:00:00.000Z' },
        },
        events: [
          ...dispute().events,
          {
            id: '01960000-0000-7000-8000-0000000000e2',
            type: 'DECISION',
            actor: 'STAFF',
            note: 'Zdjęcia pokazują, że lampa nie działa.',
            amount: null,
            photos: [],
            createdAt: '2026-11-03T10:00:00.000Z',
          },
        ],
      }),
    });
    render(<DisputePanel publicId={PUBLIC_ID} />, { wrapper: AppWrapper });

    expect(await screen.findByText(/Kupujący dostaje pełny zwrot \(143,98\s?zł\)/)).toBeDefined();
    expect(screen.getByText(/Koszt dostawy w obie strony \(13,99\s?zł\)/)).toBeDefined();
    expect(screen.getByText(/Decyzja zespołu Biddy/)).toBeDefined();
    const history = screen.getByRole('region', { name: 'Historia sporu' });
    expect(within(history).getByText(/Zespół Biddy/)).toBeDefined();
    expect(within(history).getByText(/Kupujący/)).toBeDefined();
  });
});

describe('OrderPanel: spór (F-28)', () => {
  it('kupujący po odbiorze ma link „Zgłoś problem”, a w sporze „Zobacz spór”', async () => {
    mockApi({ [ORDER_PATH]: order() });
    const { unmount } = render(<OrderPanel publicId={PUBLIC_ID} />, { wrapper: AppWrapper });
    const link = await screen.findByRole('link', { name: 'Zgłoś problem' });
    expect(link.getAttribute('href')).toBe(`/zamowienia/${PUBLIC_ID}/spor`);
    unmount();

    mockApi({ [ORDER_PATH]: disputedOrder('SELLER') });
    render(<OrderPanel publicId={PUBLIC_ID} />, { wrapper: AppWrapper });
    expect(await screen.findByText(/Kupujący zgłosił problem z przedmiotem/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Zobacz spór' }).getAttribute('href')).toBe(
      `/zamowienia/${PUBLIC_ID}/spor`,
    );
    expect(screen.getAllByText('Spór').length).toBeGreaterThan(0);
  });
});

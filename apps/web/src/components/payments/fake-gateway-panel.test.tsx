import type { FakeGatewayOverviewDto } from '@biddy/api-client';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { apiCalls, mockApi } from '@/test/api';
import { AppWrapper } from '@/test/providers';

import { FakeGatewayPanel } from './fake-gateway-panel';

const CREATED = '2026-10-22T10:00:00.000Z';

const overview: FakeGatewayOverviewDto = {
  payments: [
    {
      id: 'fake_pay_a1',
      status: 'PENDING',
      method: 'BLIK',
      currency: 'PLN',
      amount: 5_000,
      sellerAmount: 4_000,
      platformAmount: 1_000,
      refundedAmount: 0,
      failureReason: null,
      returnUrl: 'http://localhost:3000/zamowienia/x',
      chargebackStatus: null,
      createdAt: CREATED,
      settledAt: null,
    },
  ],
  sellers: [
    {
      id: 'fake_sel_b2',
      sellerRef: '01960000-0000-7000-8000-0000000000e1',
      displayName: 'Sklepik Kasi',
      type: 'PRIVATE',
      status: 'PENDING',
      currency: 'PLN',
      balance: 4_000,
      createdAt: CREATED,
    },
  ],
  payouts: [],
  events: [
    {
      id: 'fake_evt_c3',
      type: 'payment.completed',
      objectId: 'fake_pay_a1',
      attempts: 2,
      lastError: 'HTTP 500',
      deliveredAt: null,
      createdAt: CREATED,
    },
  ],
};

describe('FakeGatewayPanel (F-23)', () => {
  it('pokazuje płatności, sprzedawców i webhooki; akcje wołają API', async () => {
    const fetchMock = mockApi({
      '/v1/dev/fake-gateway': overview,
      '/v1/dev/fake-gateway/events/fake_evt_c3/redeliver': () =>
        new Response(null, { status: 204 }),
      '/v1/dev/fake-gateway/payments/fake_pay_a1/complete': overview.payments[0],
    });
    render(<FakeGatewayPanel />, { wrapper: AppWrapper });

    const payments = await screen.findByRole('region', { name: /Płatności/ });
    expect(within(payments).getByText('50,00 zł')).toBeDefined();
    expect(screen.getByText('Sklepik Kasi')).toBeDefined();
    expect(screen.getByText('Niedostarczony')).toBeDefined();
    expect(screen.getByText('2 próby')).toBeDefined();
    expect(screen.getByText('HTTP 500')).toBeDefined();
    const payouts = screen.getByRole('region', { name: 'Wypłaty (0)' });
    expect(within(payouts).getByText('Brak wpisów.')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: 'Wyślij ponownie' }));
    expect(await screen.findByText('Gotowe: Wyślij ponownie.')).toBeDefined();
    expect(apiCalls(fetchMock, '/v1/dev/fake-gateway/events/fake_evt_c3/redeliver')).toHaveLength(
      1,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Rozlicz bez webhooka' }));
    expect(
      apiCalls(fetchMock, '/v1/dev/fake-gateway/payments/fake_pay_a1/complete').map(
        (call) => call.body,
      ),
    ).toEqual([{ outcome: 'SUCCEEDED', deliverWebhook: false }]);
  });
});

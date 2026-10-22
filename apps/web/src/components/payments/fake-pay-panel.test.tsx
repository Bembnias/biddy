import type { FakePaymentDto } from '@biddy/api-client';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { config } from '@/config';
import { apiCalls, mockApi } from '@/test/api';
import { AppWrapper } from '@/test/providers';

import { FakePayPanel } from './fake-pay-panel';

const ID = 'fake_pay_0199000000007000800000000000a1';
const PATH = `/v1/dev/fake-gateway/payments/${ID}`;

function payment(overrides: Partial<FakePaymentDto> = {}): FakePaymentDto {
  return {
    id: ID,
    status: 'PENDING',
    method: 'CARD',
    currency: 'PLN',
    amount: 12_990,
    sellerAmount: 11_000,
    platformAmount: 1_990,
    refundedAmount: 0,
    failureReason: null,
    returnUrl: `${config.siteUrl}/zamowienia/k3x9qa7m`,
    chargebackStatus: null,
    createdAt: '2026-10-22T10:00:00.000Z',
    settledAt: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FakePayPanel (testowa strona płatności, F-23)', () => {
  it('płatność w toku: kwota, metoda i „Zapłać” z powrotem do Biddy', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    const fetchMock = mockApi({
      [PATH]: payment(),
      [`${PATH}/complete`]: payment({ status: 'SUCCEEDED', settledAt: '2026-10-22T10:01:00.000Z' }),
    });
    render(<FakePayPanel paymentId={ID} />, { wrapper: AppWrapper });

    expect(await screen.findByText('129,90 zł')).toBeDefined();
    expect(screen.getByText('Karta')).toBeDefined();
    expect(screen.getByText('W toku')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Zapłać' }));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(`${config.siteUrl}/zamowienia/k3x9qa7m`);
    });
    expect(apiCalls(fetchMock, `${PATH}/complete`).map((call) => call.body)).toEqual([
      { outcome: 'SUCCEEDED' },
    ]);
    expect(screen.getByRole('status').textContent).toBe('Wracamy do Biddy…');
  });

  it('„Odrzuć” wysyła wynik FAILED; adres powrotu spoza Biddy nie przekierowuje', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    const foreign = 'https://zla-strona.example/powrot';
    const fetchMock = mockApi({
      [PATH]: payment({ returnUrl: foreign }),
      [`${PATH}/complete`]: payment({
        status: 'FAILED',
        failureReason: 'DECLINED',
        returnUrl: foreign,
      }),
    });
    render(<FakePayPanel paymentId={ID} />, { wrapper: AppWrapper });

    await userEvent.click(await screen.findByRole('button', { name: 'Odrzuć' }));
    expect(await screen.findByText('Ta płatność jest już rozliczona.')).toBeDefined();
    expect(screen.getByText(`Adres powrotu spoza Biddy: ${foreign}`)).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Wróć do Biddy' })).toBeNull();
    expect(assign).not.toHaveBeenCalled();
    expect(apiCalls(fetchMock, `${PATH}/complete`).map((call) => call.body)).toEqual([
      { outcome: 'FAILED' },
    ]);
  });

  it('płatność rozliczona: stan i link powrotu bez przycisków', async () => {
    mockApi({ [PATH]: payment({ status: 'SUCCEEDED' }) });
    render(<FakePayPanel paymentId={ID} />, { wrapper: AppWrapper });

    expect(await screen.findByText('Opłacona')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Zapłać' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Wróć do Biddy' }).getAttribute('href')).toBe(
      `${config.siteUrl}/zamowienia/k3x9qa7m`,
    );
  });

  it('nieznana płatność albo wyłączony FakeGateway (404): komunikat bez ponawiania', async () => {
    mockApi({});
    render(<FakePayPanel paymentId={ID} />, { wrapper: AppWrapper });

    expect(await screen.findByText(/Nie znaleziono płatności/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Spróbuj ponownie' })).toBeNull();
  });
});

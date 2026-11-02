import type { FeeScheduleDto } from '@biddy/api-client';
import { money } from '@biddy/shared';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { mockApi } from '@/test/api';
import { AppWrapper } from '@/test/providers';

import { TotalPrice } from './total-price';

const SCHEDULE: FeeScheduleDto = {
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

const zl = (value: number) => money(Math.round(value * 100));
/** Tekst bez twardych spacji z Intl (U+00A0 przed „zł”). */
const text = (element: Element) => element.textContent.replaceAll('\u00a0', ' ');

describe('TotalPrice', () => {
  it('oferta: kwota łączna z POK i dostawą, szczegóły z opisem progów', async () => {
    mockApi({ '/v1/fee-schedules/current': SCHEDULE });
    const user = userEvent.setup();
    const { container } = render(<TotalPrice amount={zl(100)} shippingFrom={zl(12.99)} />, {
      wrapper: AppWrapper,
    });

    await screen.findByText('Skąd ta kwota?');
    const line = screen.getByText(/Licytujesz 100 zł/);
    expect(text(line)).toBe('Licytujesz 100 zł · zapłacisz 109,99 zł + dostawa od 12,99 zł');

    await user.click(screen.getByText('Skąd ta kwota?'));
    const details = container.querySelector('dl');
    expect(details).not.toBeNull();
    expect(text(details as Element)).toContain(
      'Pakiet Ochrony Kupujących2,99 zł + 7% kwoty do 1000 zł + 4% nadwyżki9,99 zł',
    );
    expect(text(details as Element)).toContain('Razem bez dostawy109,99 zł');
    expect(text(details as Element)).toContain('Dostawaod 12,99 zł (wybierasz po wygranej)');
  });

  it.each([
    ['maxBid', 500, 'Licytujesz do 500 zł · zapłacisz najwyżej 537,99 zł'],
    ['buyNow', 300, 'Kupujesz za 300 zł · zapłacisz 323,99 zł'],
    ['bid', 3000, 'Licytujesz 3000 zł · zapłacisz 3152,99 zł'],
  ] as const)('%s bez ceny dostawy: %s zł', async (kind, amount, expected) => {
    mockApi({ '/v1/fee-schedules/current': SCHEDULE });
    render(<TotalPrice amount={zl(amount)} kind={kind} withDetails={false} />, {
      wrapper: AppWrapper,
    });
    await waitFor(() => {
      expect(text(screen.getByText(/zapłacisz/))).toBe(expected);
    });
    expect(screen.queryByText('Skąd ta kwota?')).toBeNull();
  });

  it('ładowanie: szkielet zamiast kwoty, tekst dla czytników ekranu', () => {
    mockApi({ '/v1/fee-schedules/current': () => new Promise<never>(() => undefined) });
    render(<TotalPrice amount={zl(100)} />, { wrapper: AppWrapper });
    expect(screen.getByText('Liczymy kwotę łączną…')).toBeDefined();
    expect(text(screen.getByText(/Licytujesz 100 zł/))).toBe(
      'Licytujesz 100 zł · zapłacisz Liczymy kwotę łączną…',
    );
  });

  it('błąd API: bez wymyślonej kwoty łącznej', async () => {
    mockApi({});
    render(<TotalPrice amount={zl(100)} shippingFrom={zl(12.99)} />, { wrapper: AppWrapper });
    const line = await screen.findByText(/Pakiet Ochrony Kupujących/);
    expect(text(line)).toBe('Licytujesz 100 zł + Pakiet Ochrony Kupujących + dostawa od 12,99 zł');
    expect(screen.queryByText(/zapłacisz/)).toBeNull();
  });

  it('cennik z serwera (initialFeeSchedule): kwota od razu, bez zapytania; zmiana kwoty przelicza', () => {
    const fetchMock = mockApi({});
    const { rerender } = render(
      <TotalPrice amount={zl(20)} initialFeeSchedule={SCHEDULE} withDetails={false} />,
      { wrapper: AppWrapper },
    );
    expect(text(screen.getByText(/Licytujesz/).closest('p') as Element)).toBe(
      'Licytujesz 20 zł · zapłacisz 24,39 zł',
    );
    rerender(<TotalPrice amount={zl(1000)} initialFeeSchedule={SCHEDULE} withDetails={false} />);
    expect(text(screen.getByText(/Licytujesz/).closest('p') as Element)).toBe(
      'Licytujesz 1000 zł · zapłacisz 1072,99 zł',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opis cennika z trzema progami i bez opłaty stałej', async () => {
    mockApi({
      '/v1/fee-schedules/current': {
        ...SCHEDULE,
        fixedFee: 0,
        tiers: [
          { upTo: 50_000, bp: 800 },
          { upTo: 500_000, bp: 450 },
          { upTo: null, bp: 300 },
        ],
      },
    });
    const user = userEvent.setup();
    render(<TotalPrice amount={zl(100)} />, { wrapper: AppWrapper });
    await user.click(await screen.findByText('Skąd ta kwota?'));
    expect(text(screen.getByText(/kwoty do/))).toBe(
      '8% kwoty do 500 zł + 4,5% od 500 zł do 5000 zł + 3% nadwyżki',
    );
  });
});

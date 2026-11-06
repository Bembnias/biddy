import type { MyStandingDto, MyStrikesDto } from '@biddy/api-client';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { apiCalls, mockApi } from '@/test/api';
import { AppWrapper } from '@/test/providers';

import { AccountStanding } from './account-standing';

const STRIKE_ID = '01960000-0000-7000-8000-0000000000a1';
const BLOCK_ID = '01960000-0000-7000-8000-0000000000b1';

const STANDING: MyStandingDto = {
  buyer: {
    level: 'NEW',
    limits: { maxBidAmount: 250_000, maxActiveAuctions: 10 },
    overridden: false,
    next: {
      level: 'CHECKED',
      limits: { maxBidAmount: 500_000, maxActiveAuctions: 50 },
      requirements: [{ kind: 'PAID_ORDERS', current: 0, required: 1, met: false }],
    },
    block: null,
  },
  seller: {
    level: 'NEW',
    limits: { maxActiveAuctions: 5, maxAuctionValue: 500_000 },
    overridden: true,
    next: null,
    block: null,
  },
  strikes: { windowDays: 90, blockDays: 30, threshold: 3, buyer: 1, seller: 0 },
};

const appeal = {
  status: 'NONE' as const,
  message: null,
  appealedAt: null,
  resolvedAt: null,
  note: null,
};

const STRIKE: MyStrikesDto['strikes'][number] = {
  id: STRIKE_ID,
  role: 'BUYER',
  reason: 'UNPAID',
  statement: 'Nie zapłacono w terminie za zamówienie B-4821 („Wazon”).',
  orderId: null,
  auctionId: null,
  createdAt: '2026-10-30T10:00:00.000Z',
  expiresAt: '2027-01-28T10:00:00.000Z',
  state: 'ACTIVE',
  revokedAt: null,
  revokeNote: null,
  appeal,
  canAppeal: true,
};

const BLOCK: MyStrikesDto['blocks'][number] = {
  id: BLOCK_ID,
  kind: 'BIDDING',
  cause: 'STRIKES',
  strikeIds: [STRIKE_ID],
  startsAt: '2026-10-30T10:00:00.000Z',
  endsAt: null,
  statement: 'Licytowanie zablokowane bezterminowo: druga blokada w ciągu 12 miesięcy.',
  state: 'ACTIVE',
  liftedAt: null,
  liftNote: null,
  appeal,
  canAppeal: true,
};

describe('AccountStanding', () => {
  it('limity poziomów, następny poziom i licznik strike’ów; bez strike’ów pusta lista', async () => {
    mockApi({
      '/v1/me/standing': { ...STANDING, strikes: { ...STANDING.strikes, buyer: 0 } },
      '/v1/me/strikes': { strikes: [], blocks: [] },
    });
    render(<AccountStanding />, { wrapper: AppWrapper });

    const buying = await screen.findByRole('region', { name: 'Kupowanie' });
    expect(within(buying).getByText('Nowe konto')).toBeDefined();
    expect(within(buying).getByText('Maks. oferta').nextElementSibling?.textContent).toMatch(
      /^2500\s?zł$/,
    );
    expect(within(buying).getByText(/Poziom „Sprawdzone konto”: oferty do 5000/)).toBeDefined();
    expect(within(buying).getByText('Opłacone zamówienia: 0 z 1')).toBeDefined();
    const selling = screen.getByRole('region', { name: 'Sprzedawanie' });
    expect(within(selling).getByText('Limity ustawione indywidualnie przez Biddy.')).toBeDefined();
    expect(screen.getAllByText('0 z 3 w ciągu 90 dni')).toHaveLength(2);
    expect(screen.getByText("Nie masz żadnych strike'ów. Tak trzymaj.")).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Odwołaj się' })).toBeNull();
  });

  it('bezterminowa blokada na górze z przyczyną; odwołanie od strike’a z walidacją długości', async () => {
    const fetchMock = mockApi({
      '/v1/me/standing': {
        ...STANDING,
        buyer: { ...STANDING.buyer, block: { id: BLOCK_ID, until: null } },
      },
      '/v1/me/strikes': { strikes: [STRIKE], blocks: [BLOCK] },
      [`/v1/me/strikes/${STRIKE_ID}/appeal`]: {
        ...STRIKE,
        appeal: { ...appeal, status: 'PENDING', appealedAt: '2026-11-02T10:00:00.000Z' },
        canAppeal: false,
      },
    });
    render(<AccountStanding />, { wrapper: AppWrapper });

    const block = await screen.findByRole('region', {
      name: 'Licytowanie zablokowane bezterminowo',
    });
    expect(within(block).getByText(BLOCK.statement)).toBeDefined();
    expect(within(block).getByText(/^Brak płatności, 30 października 2026/)).toBeDefined();

    const strike = screen.getByText(STRIKE.statement).closest('li');
    expect(strike).not.toBeNull();
    const item = within(strike as HTMLElement);
    expect(item.getByText('Aktywny')).toBeDefined();
    await userEvent.click(item.getByRole('button', { name: 'Odwołaj się' }));
    const field = item.getByLabelText('Treść odwołania');
    await userEvent.type(field, 'Za krótko');
    await userEvent.click(item.getByRole('button', { name: 'Wyślij odwołanie' }));
    expect(item.getByRole('alert').textContent).toBe('Opisz sprawę w co najmniej 20 znakach.');
    expect(apiCalls(fetchMock, `/v1/me/strikes/${STRIKE_ID}/appeal`)).toHaveLength(0);

    await userEvent.type(field, ', bank odrzucił płatność BLIK.');
    await userEvent.click(item.getByRole('button', { name: 'Wyślij odwołanie' }));
    expect(apiCalls(fetchMock, `/v1/me/strikes/${STRIKE_ID}/appeal`)).toEqual([
      expect.objectContaining({
        body: { message: 'Za krótko, bank odrzucił płatność BLIK.' },
      }),
    ]);
  });

  it('odwołanie w toku i decyzja z uzasadnieniem', async () => {
    mockApi({
      '/v1/me/standing': STANDING,
      '/v1/me/strikes': {
        strikes: [
          {
            ...STRIKE,
            appeal: {
              ...appeal,
              status: 'REJECTED',
              appealedAt: '2026-10-31T10:00:00.000Z',
              note: 'Powiadomienie wyszło zaraz po zakupie.',
            },
            canAppeal: false,
          },
        ],
        blocks: [],
      },
    });
    render(<AccountStanding />, { wrapper: AppWrapper });
    expect(await screen.findByText('Odwołanie nieuwzględnione.')).toBeDefined();
    expect(
      screen.getByText('Uzasadnienie decyzji: Powiadomienie wyszło zaraz po zakupie.'),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Odwołaj się' })).toBeNull();
  });
});

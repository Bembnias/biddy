import type { BalanceHistoryDto, PayoutProfileDto, SellerBalanceDto } from '@biddy/api-client';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { apiCalls, mockApi } from '@/test/api';
import { AppWrapper } from '@/test/providers';

import { PayoutProfileForms } from './payout-profile-forms';
import { SellerBalance } from './seller-balance';

const BALANCE = '/v1/me/balance';
const HISTORY = '/v1/me/balance/history';
const PAYOUTS = '/v1/me/payouts';

function balance(overrides: Partial<SellerBalanceDto> = {}): SellerBalanceDto {
  return {
    currency: 'PLN',
    available: 5_000,
    inProgress: 4_500,
    receivable: 0,
    payoutsInTransit: 0,
    minimumPayout: 2_000,
    payout: {
      blocker: null,
      profileComplete: true,
      bankAccountMasked: '•••• 2874',
      weeklyPayouts: false,
    },
    inProgressOrders: [
      {
        publicId: 'p7q2m4nx',
        title: 'Wazon ceramiczny',
        photoUrl: null,
        status: 'SHIPPED',
        amount: 4_500,
      },
    ],
    ...overrides,
  };
}

const payout = {
  id: '01960000-0000-7000-8000-0000000000e1',
  currency: 'PLN',
  amount: 5_000,
  trigger: 'MANUAL' as const,
  status: 'PENDING' as const,
  failureReason: null,
  bankAccountMasked: '•••• 2874',
  createdAt: '2026-11-02T10:00:00.000Z',
  paidAt: null,
  failedAt: null,
};

const firstPage: BalanceHistoryDto = {
  items: [
    {
      id: '01960000-0000-7000-8000-0000000000f2',
      type: 'PAYOUT_REQUESTED',
      occurredAt: '2026-11-02T10:00:00.000Z',
      available: -3_000,
      receivable: 0,
      order: null,
      payout: { ...payout, amount: 3_000 },
    },
    {
      id: '01960000-0000-7000-8000-0000000000f1',
      type: 'ORDER_COMPLETED',
      occurredAt: '2026-11-01T10:00:00.000Z',
      available: 8_000,
      receivable: 0,
      order: { publicId: 'k3x9qa7p', title: 'Lampa biurkowa', photoUrl: null },
      payout: null,
    },
  ],
  nextCursor: '01960000-0000-7000-8000-0000000000f1',
};

const secondPage: BalanceHistoryDto = {
  items: [
    {
      id: '01960000-0000-7000-8000-0000000000f0',
      type: 'DISPUTE_COSTS_CHARGED',
      occurredAt: '2026-10-20T10:00:00.000Z',
      available: 0,
      receivable: 2_798,
      order: null,
      payout: null,
    },
  ],
  nextCursor: null,
};

function historyPages() {
  let calls = 0;
  return () => {
    calls += 1;
    return calls === 1 ? firstPage : secondPage;
  };
}

describe('SellerBalance', () => {
  it('kafle, zamówienia w trakcie, historia ze stronami i wypłata całego salda z Idempotency-Key', async () => {
    const fetchMock = mockApi({
      [BALANCE]: balance(),
      [HISTORY]: historyPages(),
      [PAYOUTS]: payout,
    });
    render(<SellerBalance />, { wrapper: AppWrapper });

    const tiles = await screen.findByRole('region', { name: 'Salda' });
    expect(within(tiles).getByText('Do wypłaty').nextElementSibling?.textContent).toMatch(
      /^50\s?zł$/,
    );
    expect(within(tiles).getByText('W trakcie').nextElementSibling?.textContent).toMatch(
      /^45\s?zł$/,
    );
    expect(within(tiles).queryByText('Do spłaty')).toBeNull();
    expect(screen.getByRole('link', { name: 'Wazon ceramiczny' }).getAttribute('href')).toBe(
      '/zamowienia/p7q2m4nx',
    );
    expect(screen.getByText(/Na rachunek •••• 2874/)).toBeDefined();

    const history = screen.getByRole('region', { name: 'Historia' });
    expect(await within(history).findByText(/Wypłata na •••• 2874/)).toBeDefined();
    expect(within(history).getByText('W drodze')).toBeDefined();
    expect(within(history).getByRole('link', { name: 'Lampa biurkowa' })).toBeDefined();
    expect(within(history).getByText(/^\+80\s?zł$/)).toBeDefined();
    expect(within(history).getByText(/^−30\s?zł$/)).toBeDefined();
    await userEvent.click(within(history).getByRole('button', { name: 'Pokaż starsze' }));
    expect(await within(history).findByText('Koszty sporu')).toBeDefined();
    expect(within(history).getByText(/^−27,98\s?zł$/)).toBeDefined();
    expect(within(history).queryByRole('button', { name: 'Pokaż starsze' })).toBeNull();

    expect(screen.getByLabelText('Kwota wypłaty')).toHaveProperty('value', '50');
    await userEvent.click(screen.getByRole('button', { name: /^Wypłać 50\s?zł$/ }));
    expect(
      await screen.findByText(/Zleciliśmy wypłatę 50\s?zł\. Pieniądze dotrą zwykle w 1–2 dni/),
    ).toBeDefined();
    const [request] = apiCalls(fetchMock, PAYOUTS);
    expect(request?.body).toEqual({});
    expect(request?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('kwota spoza zakresu: błąd przy polu bez wywołania API', async () => {
    const fetchMock = mockApi({ [BALANCE]: balance(), [HISTORY]: secondPage });
    render(<SellerBalance />, { wrapper: AppWrapper });
    const input = await screen.findByLabelText('Kwota wypłaty');
    await userEvent.clear(input);
    await userEvent.type(input, '10');
    await userEvent.click(screen.getByRole('button', { name: /^Wypłać 10\s?zł$/ }));
    expect(screen.getByText(/Minimalna wypłata to 20\s?zł\./)).toBeDefined();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    await userEvent.clear(input);
    await userEvent.type(input, '60');
    await userEvent.click(screen.getByRole('button', { name: /^Wypłać 60\s?zł$/ }));
    expect(screen.getByText(/Możesz wypłacić najwyżej 50\s?zł\./)).toBeDefined();
    expect(apiCalls(fetchMock, PAYOUTS)).toHaveLength(0);
  });

  it('powody blokady: brak danych, zmiana rachunku, należność i minimum', async () => {
    mockApi({
      [BALANCE]: balance({
        payout: {
          blocker: { code: 'PAYOUT_PROFILE_INCOMPLETE', until: null, amount: null },
          profileComplete: false,
          bankAccountMasked: null,
          weeklyPayouts: false,
        },
      }),
      [HISTORY]: secondPage,
    });
    const { unmount } = render(<SellerBalance />, { wrapper: AppWrapper });
    expect(await screen.findByText(/podaj dane do wypłat/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Uzupełnij dane' }).getAttribute('href')).toBe(
      '/konto/saldo/dane',
    );
    expect(screen.queryByLabelText('Kwota wypłaty')).toBeNull();
    unmount();

    mockApi({
      [BALANCE]: balance({
        receivable: 2_798,
        payout: {
          blocker: { code: 'RECEIVABLE_OUTSTANDING', until: null, amount: 2_798 },
          profileComplete: true,
          bankAccountMasked: '•••• 2874',
          weeklyPayouts: false,
        },
      }),
      [HISTORY]: secondPage,
    });
    const second = render(<SellerBalance />, { wrapper: AppWrapper });
    expect(
      await screen.findByText(/Masz 27,98\s?zł do spłaty\. Spłacimy to z kolejnych sprzedaży/),
    ).toBeDefined();
    expect(screen.getByText('Do spłaty')).toBeDefined();
    second.unmount();

    mockApi({
      [BALANCE]: balance({
        payout: {
          blocker: { code: 'PAYOUTS_ON_HOLD', until: '2026-11-04T13:02:00.000Z', amount: null },
          profileComplete: true,
          bankAccountMasked: '•••• 1111',
          weeklyPayouts: false,
        },
      }),
      [HISTORY]: secondPage,
    });
    const third = render(<SellerBalance />, { wrapper: AppWrapper });
    expect(
      await screen.findByText(/Po zmianie rachunku wypłaty ruszą 4 listopada .*14:02\./),
    ).toBeDefined();
    third.unmount();

    mockApi({
      [BALANCE]: balance({
        available: 1_500,
        payout: {
          blocker: { code: 'PAYOUT_BELOW_MINIMUM', until: null, amount: 2_000 },
          profileComplete: true,
          bankAccountMasked: '•••• 2874',
          weeklyPayouts: false,
        },
      }),
      [HISTORY]: secondPage,
    });
    render(<SellerBalance />, { wrapper: AppWrapper });
    expect(
      await screen.findByText(/Minimalna wypłata to 20\s?zł\. Mniejsze saldo wypłacimy/),
    ).toBeDefined();
  });

  it('wypłata tygodniowa: przełącznik zapisuje ustawienie', async () => {
    const fetchMock = mockApi({
      [BALANCE]: balance(),
      [HISTORY]: secondPage,
      '/v1/me/payout-settings': {
        personalData: null,
        bankAccount: null,
        weeklyPayouts: true,
        payoutsBlockedUntil: null,
        complete: false,
      },
    });
    render(<SellerBalance />, { wrapper: AppWrapper });
    await userEvent.click(await screen.findByRole('switch', { name: 'Wypłata co tydzień' }));
    await waitFor(() => {
      expect(apiCalls(fetchMock, '/v1/me/payout-settings')).toHaveLength(1);
    });
    expect(apiCalls(fetchMock, '/v1/me/payout-settings')[0]?.body).toEqual({
      weeklyPayouts: true,
    });
  });
});

const emptyProfile: PayoutProfileDto = {
  personalData: null,
  bankAccount: null,
  weeklyPayouts: false,
  payoutsBlockedUntil: null,
  complete: false,
};

describe('PayoutProfileForms', () => {
  it('dane osobowe: walidacja PESEL i zapis znormalizowanych danych', async () => {
    const fetchMock = mockApi({
      '/v1/me/payout-profile': emptyProfile,
      '/v1/me/payout-profile/personal-data': {
        ...emptyProfile,
        personalData: {
          firstName: 'Anna',
          lastName: 'Kowalska',
          birthDate: '1944-05-14',
          street: 'ul. Długa 5/2',
          postalCode: '00-950',
          city: 'Warszawa',
          taxIdKind: 'PESEL',
          taxIdMasked: '•••••••1359',
        },
      },
    });
    render(<PayoutProfileForms />, { wrapper: AppWrapper });
    const form = await screen.findByRole('region', { name: 'Dane osobowe' });
    await userEvent.type(within(form).getByLabelText('Imię'), 'Anna');
    await userEvent.type(within(form).getByLabelText('Nazwisko'), 'Kowalska');
    fireEvent.change(within(form).getByLabelText('Data urodzenia'), {
      target: { value: '1944-05-14' },
    });
    await userEvent.type(within(form).getByLabelText('PESEL'), '44051401358');
    await userEvent.type(within(form).getByLabelText('Ulica i numer'), 'ul. Długa 5/2');
    await userEvent.type(within(form).getByLabelText('Kod pocztowy'), '00950');
    await userEvent.type(within(form).getByLabelText('Miejscowość'), 'Warszawa');
    await userEvent.click(within(form).getByRole('button', { name: 'Zapisz dane' }));
    expect(await within(form).findByText('Podaj poprawny numer PESEL (11 cyfr).')).toBeDefined();
    expect(apiCalls(fetchMock, '/v1/me/payout-profile/personal-data')).toHaveLength(0);

    const pesel = within(form).getByLabelText('PESEL');
    await userEvent.clear(pesel);
    await userEvent.type(pesel, '440514 01359');
    await userEvent.click(within(form).getByRole('button', { name: 'Zapisz dane' }));
    expect(await within(form).findByText('Zapisano.')).toBeDefined();
    expect(apiCalls(fetchMock, '/v1/me/payout-profile/personal-data')[0]?.body).toEqual({
      firstName: 'Anna',
      lastName: 'Kowalska',
      birthDate: '1944-05-14',
      taxIdKind: 'PESEL',
      taxId: '44051401359',
      street: 'ul. Długa 5/2',
      postalCode: '00-950',
      city: 'Warszawa',
    });
    expect(within(form).getByText(/Zapisany numer: •••••••1359/)).toBeDefined();
  });

  it('rachunek: ostrzeżenie o blokadzie 48 h przy zmianie, walidacja IBAN i zapis', async () => {
    const withAccount: PayoutProfileDto = {
      ...emptyProfile,
      bankAccount: {
        masked: '•••• 2874',
        holderName: 'Anna Kowalska',
        changedAt: '2026-10-01T10:00:00.000Z',
      },
    };
    const fetchMock = mockApi({
      '/v1/me/payout-profile': withAccount,
      '/v1/me/payout-profile/bank-account': {
        ...withAccount,
        bankAccount: { ...withAccount.bankAccount, masked: '•••• 1111' },
        payoutsBlockedUntil: '2099-11-04T13:02:00.000Z',
      },
    });
    render(<PayoutProfileForms />, { wrapper: AppWrapper });
    const form = await screen.findByRole('region', { name: 'Rachunek do wypłat' });
    expect(within(form).getByText(/Obecny rachunek: •••• 2874, Anna Kowalska\./)).toBeDefined();
    expect(
      within(form).getByText('Po zmianie numeru rachunku wypłaty będą wstrzymane przez 48 godzin.'),
    ).toBeDefined();

    const iban = within(form).getByLabelText('Numer rachunku');
    await userEvent.type(iban, '62 1090 1014 0000 0712 1981 2874');
    await userEvent.click(within(form).getByRole('button', { name: 'Zapisz rachunek' }));
    expect(await within(form).findByText('Podaj polski numer rachunku: 26 cyfr.')).toBeDefined();

    await userEvent.clear(iban);
    await userEvent.type(iban, '60 1020 1026 0000 0422 7020 1111');
    await userEvent.click(within(form).getByRole('button', { name: 'Zapisz rachunek' }));
    expect(await within(form).findByText('Zapisano.')).toBeDefined();
    expect(apiCalls(fetchMock, '/v1/me/payout-profile/bank-account')[0]?.body).toEqual({
      iban: 'PL60102010260000042270201111',
      holderName: 'Anna Kowalska',
    });
    expect(within(form).getByText(/Obecny rachunek: •••• 1111/)).toBeDefined();
    expect(within(form).getByText(/Wypłaty ruszą 4 listopada/)).toBeDefined();
  });
});

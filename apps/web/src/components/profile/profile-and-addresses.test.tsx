import type { AddressDto } from '@biddy/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AddressForm } from '@/components/addresses/address-form';
import { AddressList } from '@/components/addresses/address-list';
import { apiCalls, mockApi } from '@/test/api';
import { AppWrapper } from '@/test/providers';

import { ProfileForm } from './profile-form';
import { avatarColor, initialsOf } from './user-avatar';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const ADDRESS_ID = '01960000-0000-7000-8000-0000000000a1';
const ADDRESS: AddressDto = {
  id: ADDRESS_ID,
  recipientName: 'Kasia Kupująca',
  street: 'ul. Długa 5/12',
  postalCode: '00-950',
  city: 'Warszawa',
  country: 'PL',
  phone: '+48500600700',
  isDefault: true,
  isSenderDefault: false,
  createdAt: '2026-10-01T10:00:00.000Z',
};

function problem(
  status: number,
  code: string,
  detail: string,
  extra: Record<string, unknown> = {},
) {
  return () =>
    Response.json(
      { type: 'x', title: 't', status, detail, instance: '/v1', code, requestId: 'r', ...extra },
      { status, headers: { 'content-type': 'application/problem+json' } },
    );
}

beforeEach(() => {
  router.push.mockClear();
  router.refresh.mockClear();
});

describe('avatar z inicjałami', () => {
  it('inicjały z dwóch pierwszych słów i stały kolor dla konta', () => {
    expect(initialsOf('Kasia Kupująca')).toBe('KK');
    expect(initialsOf('łukasz')).toBe('Ł');
    expect(initialsOf('Anna Maria Nowak')).toBe('AM');
    expect(avatarColor(ADDRESS_ID)).toBe(avatarColor(ADDRESS_ID));
  });
});

describe('edycja profilu', () => {
  it('imię z numerem telefonu: komunikat po polsku bez żądania', async () => {
    const api = mockApi({});
    const user = userEvent.setup();
    render(<ProfileForm name="Kasia" />, { wrapper: AppWrapper });

    await user.clear(screen.getByLabelText('Imię wyświetlane'));
    await user.type(screen.getByLabelText('Imię wyświetlane'), 'Kasia 500 600 700');
    await user.click(screen.getByRole('button', { name: 'Zapisz' }));

    expect(
      await screen.findByText(
        'Imię wyświetlane nie może zawierać numeru telefonu ani adresu strony.',
      ),
    ).toBeDefined();
    expect(apiCalls(api, '/v1/me')).toHaveLength(0);
  });

  it('zapis: PATCH /v1/me i komunikat „Zapisano.”', async () => {
    const api = mockApi({ '/v1/me': { id: ADDRESS_ID, name: 'Kasia Nowa' } });
    const user = userEvent.setup();
    render(<ProfileForm name="Kasia" />, { wrapper: AppWrapper });

    await user.clear(screen.getByLabelText('Imię wyświetlane'));
    await user.type(screen.getByLabelText('Imię wyświetlane'), 'Kasia Nowa');
    await user.click(screen.getByRole('button', { name: 'Zapisz' }));

    expect((await screen.findByRole('status')).textContent).toBe('Zapisano.');
    expect(apiCalls(api, '/v1/me')[0]?.body).toEqual({ name: 'Kasia Nowa' });
    expect(router.refresh).toHaveBeenCalled();
  });
});

describe('formularz adresu', () => {
  it('walidacja po polsku: kod pocztowy i telefon', async () => {
    mockApi({});
    const user = userEvent.setup();
    render(<AddressForm />, { wrapper: AppWrapper });

    await user.type(screen.getByLabelText('Imię i nazwisko albo firma'), 'Kasia Kupująca');
    await user.type(screen.getByLabelText('Ulica i numer'), 'ul. Długa 5');
    await user.type(screen.getByLabelText('Kod pocztowy'), '1234');
    await user.type(screen.getByLabelText('Miasto'), 'Warszawa');
    await user.type(screen.getByLabelText('Telefon'), '123');
    await user.click(screen.getByRole('button', { name: 'Zapisz adres' }));

    expect(await screen.findByText('Podaj kod pocztowy w formacie 00-000.')).toBeDefined();
    expect(screen.getByText('Podaj polski numer komórkowy, np. 500 600 700.')).toBeDefined();
  });

  it('nowy adres z podpowiedzią telefonu i flagą domyślności; potem lista adresów', async () => {
    const api = mockApi({ '/v1/me/addresses': () => Response.json(ADDRESS, { status: 201 }) });
    const user = userEvent.setup();
    render(<AddressForm defaultPhone="+48500600700" />, { wrapper: AppWrapper });

    expect(screen.getByLabelText<HTMLInputElement>('Telefon').value).toBe('+48 500 600 700');
    await user.type(screen.getByLabelText('Imię i nazwisko albo firma'), 'Kasia Kupująca');
    await user.type(screen.getByLabelText('Ulica i numer'), 'ul. Długa 5/12');
    await user.type(screen.getByLabelText('Kod pocztowy'), '00950');
    await user.type(screen.getByLabelText('Miasto'), 'Warszawa');
    await user.click(screen.getByRole('checkbox', { name: 'Domyślny adres nadania' }));
    await user.click(screen.getByRole('button', { name: 'Zapisz adres' }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/konto/adresy'));
    expect(apiCalls(api, '/v1/me/addresses')[0]?.body).toEqual({
      recipientName: 'Kasia Kupująca',
      street: 'ul. Długa 5/12',
      postalCode: '00950',
      city: 'Warszawa',
      phone: '+48 500 600 700',
      isDefault: false,
      isSenderDefault: true,
    });
  });

  it('błędy pól z API przy polach, limit adresów jako komunikat', async () => {
    let calls = 0;
    mockApi({
      [`/v1/me/addresses/${ADDRESS_ID}`]: () => {
        calls += 1;
        return problem(400, 'VALIDATION_FAILED', 'Nieprawidłowe dane', {
          errors: [{ path: 'city', code: 'custom', message: 'Miasto: co najmniej 2 znaki.' }],
        })();
      },
      '/v1/me/addresses': problem(
        409,
        'ADDRESS_LIMIT_REACHED',
        'Możesz zapisać najwyżej 10 adresów.',
      ),
    });
    const user = userEvent.setup();
    const { unmount } = render(<AddressForm address={ADDRESS} />, { wrapper: AppWrapper });
    await user.click(screen.getByRole('button', { name: 'Zapisz adres' }));
    expect(await screen.findByText('Miasto: co najmniej 2 znaki.')).toBeDefined();
    expect(calls).toBe(1);
    unmount();

    render(<AddressForm defaultPhone="+48500600700" />, { wrapper: AppWrapper });
    await user.type(screen.getByLabelText('Imię i nazwisko albo firma'), 'Kasia');
    await user.type(screen.getByLabelText('Ulica i numer'), 'ul. Długa 5');
    await user.type(screen.getByLabelText('Kod pocztowy'), '00-950');
    await user.type(screen.getByLabelText('Miasto'), 'Warszawa');
    await user.click(screen.getByRole('button', { name: 'Zapisz adres' }));
    expect((await screen.findByRole('alert')).textContent).toContain('najwyżej 10 adresów');
  });
});

describe('lista adresów', () => {
  const SECOND: AddressDto = {
    ...ADDRESS,
    id: '01960000-0000-7000-8000-0000000000a2',
    street: 'ul. Krótka 1',
    isDefault: false,
    isSenderDefault: true,
  };

  it('oznaczenia domyślnych i ustawienie adresu domyślnym do dostawy', async () => {
    const api = mockApi({ [`/v1/me/addresses/${SECOND.id}`]: SECOND });
    const user = userEvent.setup();
    render(<AddressList addresses={[ADDRESS, SECOND]} />, { wrapper: AppWrapper });

    const [first, second] = screen.getAllByRole('listitem');
    expect(within(first as HTMLElement).getByText('Domyślny adres dostawy')).toBeDefined();
    expect(within(second as HTMLElement).getByText('Domyślny adres nadania')).toBeDefined();
    await user.click(
      within(second as HTMLElement).getByRole('button', { name: 'Ustaw jako domyślny do dostawy' }),
    );

    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(apiCalls(api, `/v1/me/addresses/${SECOND.id}`)[0]?.body).toEqual({ isDefault: true });
  });

  it('usunięcie po potwierdzeniu w oknie dialogowym', async () => {
    const api = mockApi({
      [`/v1/me/addresses/${ADDRESS_ID}`]: () => new Response(null, { status: 204 }),
    });
    const user = userEvent.setup();
    render(<AddressList addresses={[ADDRESS]} />, { wrapper: AppWrapper });

    await user.click(screen.getByRole('button', { name: 'Usuń' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('ul. Długa 5/12, 00-950 Warszawa');
    expect(apiCalls(api, `/v1/me/addresses/${ADDRESS_ID}`)).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Usuń adres' }));

    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(apiCalls(api, `/v1/me/addresses/${ADDRESS_ID}`)).toHaveLength(1);
  });
});

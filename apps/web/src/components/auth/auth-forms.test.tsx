import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiCalls, mockApi } from '@/test/api';
import { AppWrapper } from '@/test/providers';

import { SignInForm } from './sign-in-form';
import { SignUpForm } from './sign-up-form';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

// Widżet Turnstile bez skryptu Cloudflare: przycisk, który „rozwiązuje” wyzwanie.
vi.mock('@marsidev/react-turnstile', () => ({
  Turnstile: ({ onSuccess }: { onSuccess: (token: string) => void }) => (
    <button type="button" onClick={() => onSuccess('token-turnstile')}>
      Rozwiąż Turnstile
    </button>
  ),
}));

const AUTH_OPTIONS = { socialProviders: [], turnstileSiteKey: 'site-key', passwordMinLength: 10 };

/** Fabryka odpowiedzi błędu z API (Problem Details jak z auth-routes.ts). */
function problem(status: number, code: string, detail: string) {
  return () =>
    Response.json(
      {
        type: 'x',
        title: 't',
        status,
        detail,
        instance: '/v1/auth',
        code,
        requestId: 'r',
        message: detail,
      },
      { status, headers: { 'content-type': 'application/problem+json' } },
    );
}

beforeEach(() => {
  router.push.mockClear();
  router.refresh.mockClear();
});

describe('logowanie', () => {
  it('poprawne dane: POST /v1/auth/sign-in/email i przejście pod adres `next`', async () => {
    const api = mockApi({
      '/v1/auth-options': AUTH_OPTIONS,
      '/v1/auth/sign-in/email': { ok: true },
    });
    const user = userEvent.setup();
    render(<SignInForm next="/konto" />, { wrapper: AppWrapper });

    await user.type(screen.getByLabelText('E-mail'), 'jan@example.com');
    await user.type(screen.getByLabelText('Hasło'), 'tajne-haslo-1');
    await user.click(screen.getByRole('button', { name: 'Zaloguj się' }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/konto'));
    expect(apiCalls(api, '/v1/auth/sign-in/email')[0]?.body).toEqual({
      email: 'jan@example.com',
      password: 'tajne-haslo-1',
    });
  });

  it('złe dane: komunikat z API po polsku w roli alert', async () => {
    mockApi({
      '/v1/auth-options': AUTH_OPTIONS,
      '/v1/auth/sign-in/email': problem(
        401,
        'INVALID_EMAIL_OR_PASSWORD',
        'Nieprawidłowy e-mail lub hasło.',
      ),
    });
    const user = userEvent.setup();
    render(<SignInForm next="/konto" />, { wrapper: AppWrapper });

    await user.type(screen.getByLabelText('E-mail'), 'jan@example.com');
    await user.type(screen.getByLabelText('Hasło'), 'zle');
    await user.click(screen.getByRole('button', { name: 'Zaloguj się' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Nieprawidłowy e-mail lub hasło.',
    );
    expect(router.push).not.toHaveBeenCalled();
  });

  it('CAPTCHA_REQUIRED: pojawia się Turnstile, a kolejna próba wysyła token w nagłówku', async () => {
    const api = mockApi({
      '/v1/auth-options': AUTH_OPTIONS,
      '/v1/auth/sign-in/email': problem(
        403,
        'CAPTCHA_REQUIRED',
        'Potwierdź, że nie jesteś robotem.',
      ),
    });
    const user = userEvent.setup();
    render(<SignInForm next="/konto" />, { wrapper: AppWrapper });
    expect(screen.queryByRole('button', { name: 'Rozwiąż Turnstile' })).toBeNull();

    await user.type(screen.getByLabelText('E-mail'), 'jan@example.com');
    await user.type(screen.getByLabelText('Hasło'), 'tajne-haslo-1');
    await user.click(screen.getByRole('button', { name: 'Zaloguj się' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Potwierdź, że nie jesteś robotem',
    );
    expect(screen.getByRole('button', { name: 'Zaloguj się' }).hasAttribute('disabled')).toBe(true);

    await user.click(await screen.findByRole('button', { name: 'Rozwiąż Turnstile' }));
    await user.click(screen.getByRole('button', { name: 'Zaloguj się' }));

    await waitFor(() => {
      const calls = apiCalls(api, '/v1/auth/sign-in/email');
      expect(calls[0]?.headers.has('x-turnstile-token')).toBe(false);
      expect(calls[1]?.headers.get('x-turnstile-token')).toBe('token-turnstile');
    });
  });
});

describe('rejestracja', () => {
  it('walidacja po polsku (hasło, regulamin, 18+) bez wysyłania żądania', async () => {
    const api = mockApi({ '/v1/auth-options': AUTH_OPTIONS });
    const user = userEvent.setup();
    render(<SignUpForm next="/konto" />, { wrapper: AppWrapper });

    await user.type(screen.getByLabelText('Imię wyświetlane'), 'Jan');
    await user.type(screen.getByLabelText('E-mail'), 'jan@example.com');
    await user.type(screen.getByLabelText('Hasło'), 'krotkie');
    await user.click(await screen.findByRole('button', { name: 'Rozwiąż Turnstile' }));
    await user.click(screen.getByRole('button', { name: 'Załóż konto' }));

    expect(await screen.findByText('Hasło musi mieć co najmniej 10 znaków.')).toBeDefined();
    expect(screen.getByText('Zaakceptuj regulamin i politykę prywatności.')).toBeDefined();
    expect(screen.getByText('Konto mogą założyć tylko osoby pełnoletnie.')).toBeDefined();
    expect(screen.getByLabelText('Hasło').getAttribute('aria-invalid')).toBe('true');
    expect(apiCalls(api, '/v1/auth/sign-up/email')).toHaveLength(0);
  });

  it('sukces: zgody i token w żądaniu, potem „Sprawdź skrzynkę” z adresem', async () => {
    const api = mockApi({
      '/v1/auth-options': AUTH_OPTIONS,
      '/v1/auth/sign-up/email': { ok: true },
    });
    const user = userEvent.setup();
    render(<SignUpForm next="/konto" />, { wrapper: AppWrapper });

    await user.type(screen.getByLabelText('Imię wyświetlane'), 'Jan');
    await user.type(screen.getByLabelText('E-mail'), 'jan@example.com');
    await user.type(screen.getByLabelText('Hasło'), 'bardzo-tajne-1');
    await user.click(screen.getByRole('checkbox', { name: /Akceptuję regulamin/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Mam ukończone 18 lat.' }));
    await user.click(await screen.findByRole('button', { name: 'Rozwiąż Turnstile' }));
    await user.click(screen.getByRole('button', { name: 'Załóż konto' }));

    expect((await screen.findByRole('status')).textContent).toContain('jan@example.com');
    const [call] = apiCalls(api, '/v1/auth/sign-up/email');
    expect(call?.body).toMatchObject({
      name: 'Jan',
      email: 'jan@example.com',
      acceptTerms: true,
      adultDeclaration: true,
      callbackURL: 'http://localhost:3000/weryfikacja-email',
    });
    expect(call?.headers.get('x-turnstile-token')).toBe('token-turnstile');
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiCalls, mockApi } from '@/test/api';
import { AppWrapper } from '@/test/providers';

import { PhoneVerificationForm } from './phone-verification-form';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const START = '/v1/me/phone-verification';
const CONFIRM = '/v1/me/phone-verification/confirm';

function started(resendInMs = 60_000) {
  return {
    phoneNumber: '+48500600700',
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    resendAvailableAt: new Date(Date.now() + resendInMs).toISOString(),
  };
}

function problem(
  status: number,
  code: string,
  detail: string,
  extra: Record<string, unknown> = {},
) {
  return () =>
    Response.json(
      { type: 'x', title: 't', status, detail, instance: START, code, requestId: 'r', ...extra },
      { status, headers: { 'content-type': 'application/problem+json' } },
    );
}

async function sendNumber(value = '500 600 700') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Numer telefonu'), value);
  await user.click(screen.getByRole('button', { name: 'Wyślij kod' }));
  return user;
}

beforeEach(() => {
  router.push.mockClear();
  router.refresh.mockClear();
});

describe('weryfikacja telefonu: numer', () => {
  it('zły zapis numeru: komunikat po polsku bez żądania', async () => {
    const api = mockApi({});
    render(<PhoneVerificationForm next="/konto" />, { wrapper: AppWrapper });
    await sendNumber('12 34');

    expect(await screen.findByText('Podaj polski numer komórkowy, np. 500 600 700.')).toBeDefined();
    expect(screen.getByLabelText('Numer telefonu').getAttribute('aria-invalid')).toBe('true');
    expect(apiCalls(api, START)).toHaveLength(0);
  });

  it('wysyła numer w E.164 i przechodzi do kodu; ponowna wysyłka po odliczeniu', async () => {
    const api = mockApi({ [START]: started() });
    render(<PhoneVerificationForm next="/konto" />, { wrapper: AppWrapper });
    await sendNumber();

    expect((await screen.findByRole('status')).textContent).toContain('+48 500 600 700');
    expect(apiCalls(api, START)[0]?.body).toEqual({ phoneNumber: '+48500600700' });
    const resend = screen.getByRole('button', { name: /Wyślij ponownie za (59|60) s/ });
    expect(resend.hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('Kod z SMS-a').getAttribute('autocomplete')).toBe('one-time-code');
  });

  it('numer innego konta: błąd przy polu numeru', async () => {
    mockApi({
      [START]: problem(
        409,
        'PHONE_NUMBER_TAKEN',
        'Ten numer telefonu jest przypisany do innego konta.',
      ),
    });
    render(<PhoneVerificationForm next="/konto" />, { wrapper: AppWrapper });
    await sendNumber();

    expect(
      await screen.findByText('Ten numer telefonu jest przypisany do innego konta.'),
    ).toBeDefined();
    expect(screen.getByLabelText('Numer telefonu').getAttribute('aria-invalid')).toBe('true');
  });

  it('numer stacjonarny odrzucony przez API: błąd pola z `errors`', async () => {
    mockApi({
      [START]: problem(400, 'VALIDATION_FAILED', 'Żądanie zawiera nieprawidłowe dane.', {
        errors: [
          {
            path: 'phoneNumber',
            code: 'custom',
            message: 'Podaj polski numer komórkowy, np. 500 600 700.',
          },
        ],
      }),
    });
    render(<PhoneVerificationForm next="/konto" />, { wrapper: AppWrapper });
    await sendNumber('221234567');

    expect(await screen.findByText('Podaj polski numer komórkowy, np. 500 600 700.')).toBeDefined();
  });

  it('limit wysyłki: komunikat z API w roli alert', async () => {
    mockApi({ [START]: problem(429, 'RATE_LIMITED', 'Spróbuj ponownie za 12 min.') });
    render(<PhoneVerificationForm next="/konto" />, { wrapper: AppWrapper });
    await sendNumber();

    expect((await screen.findByRole('alert')).textContent).toContain('Spróbuj ponownie za 12 min.');
  });
});

describe('weryfikacja telefonu: kod', () => {
  it('zły kod: błąd pola z liczbą prób; dobry kod: powrót pod `next`', async () => {
    let attempts = 0;
    const api = mockApi({
      [START]: started(),
      [CONFIRM]: () => {
        attempts += 1;
        return attempts === 1
          ? problem(400, 'PHONE_CODE_INVALID', 'Nieprawidłowy kod. Pozostałe próby: 4.', {
              remainingAttempts: 4,
            })()
          : Response.json({ phoneNumber: '+48500600700', verifiedAt: new Date().toISOString() });
      },
    });
    render(<PhoneVerificationForm next="/aukcja/rower" />, { wrapper: AppWrapper });
    const user = await sendNumber();

    await user.type(await screen.findByLabelText('Kod z SMS-a'), '111111');
    await user.click(screen.getByRole('button', { name: 'Potwierdź' }));
    expect(await screen.findByText('Nieprawidłowy kod. Pozostałe próby: 4.')).toBeDefined();

    await user.clear(screen.getByLabelText('Kod z SMS-a'));
    await user.type(screen.getByLabelText('Kod z SMS-a'), '123456');
    await user.click(screen.getByRole('button', { name: 'Potwierdź' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/aukcja/rower'));
    expect(apiCalls(api, CONFIRM).map((call) => call.body)).toEqual([
      { code: '111111' },
      { code: '123456' },
    ]);
  });

  it('ponowna wysyłka (po odliczeniu) i zmiana numeru', async () => {
    const api = mockApi({ [START]: () => Response.json(started(-1_000)) });
    render(<PhoneVerificationForm next="/konto" />, { wrapper: AppWrapper });
    const user = await sendNumber();

    await user.click(await screen.findByRole('button', { name: 'Wyślij kod ponownie' }));
    expect((await screen.findByRole('status')).textContent).toContain('Wysłaliśmy nowy kod');
    expect(apiCalls(api, START)).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Zmień numer' }));
    expect(screen.getByLabelText('Numer telefonu')).toBeDefined();
  });
});

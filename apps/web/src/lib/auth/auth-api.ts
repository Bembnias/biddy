// Trasy kont Better Auth (/v1/auth/*) wołane przez fetcher klienta API (F-05): ten sam adres API,
// ciasteczko sesji i błędy jako ApiError z Problem Details po polsku (API zamienia na nie błędy
// Better Auth). Bez klienta Better Auth w paczce przeglądarki.
import { apiFetch } from '@biddy/api-client';

import { rememberSocialLogin } from '@/analytics/auth-events';
import { config } from '@/config';
import { routes } from '@/lib/routes';

/** Nagłówek z tokenem Turnstile (API: x-turnstile-token). */
const TURNSTILE_HEADER = 'x-turnstile-token';

/** Adres strony web, na którą API przekierowuje po kliknięciu linku z e-maila. */
function webUrl(path: string): string {
  return new URL(path, config.siteUrl).toString();
}

function post<T>(path: string, body: unknown, turnstileToken?: string): Promise<T> {
  return apiFetch<T>(`/v1/auth${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(turnstileToken === undefined ? {} : { [TURNSTILE_HEADER]: turnstileToken }),
    },
    body: JSON.stringify(body),
  });
}

export interface SignUpInput {
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly acceptTerms: boolean;
  readonly adultDeclaration: boolean;
}

export function signUpWithEmail(input: SignUpInput, turnstileToken: string): Promise<unknown> {
  return post(
    '/sign-up/email',
    { ...input, callbackURL: webUrl(routes.verifyEmail) },
    turnstileToken,
  );
}

export function signInWithEmail(
  input: { readonly email: string; readonly password: string },
  turnstileToken?: string,
): Promise<unknown> {
  return post('/sign-in/email', input, turnstileToken);
}

export type SocialProvider = 'google' | 'apple';

/** Logowanie przez Google/Apple: API zwraca adres dostawcy, przeglądarka tam przechodzi. */
export async function signInWithProvider(provider: SocialProvider, next: string): Promise<void> {
  const { url } = await post<{ url: string }>('/sign-in/social', {
    provider,
    callbackURL: webUrl(next),
    // Nowe konto z Google/Apple najpierw akceptuje regulamin.
    newUserCallbackURL: webUrl(`${routes.acceptTerms}?${new URLSearchParams({ next }).toString()}`),
    errorCallbackURL: webUrl(routes.signIn),
    disableRedirect: true,
  });
  rememberSocialLogin(provider);
  window.location.assign(url);
}

export function signOut(): Promise<unknown> {
  return post('/sign-out', {});
}

/** Wylogowanie ze wszystkich urządzeń (także tokeny aplikacji mobilnej). */
export function signOutEverywhere(): Promise<unknown> {
  return post('/revoke-sessions', {});
}

export function resendVerificationEmail(email: string): Promise<unknown> {
  return post('/send-verification-email', { email, callbackURL: webUrl(routes.verifyEmail) });
}

export function requestPasswordReset(email: string, turnstileToken: string): Promise<unknown> {
  return post(
    '/request-password-reset',
    { email, redirectTo: webUrl(routes.resetPassword) },
    turnstileToken,
  );
}

export function resetPassword(token: string, newPassword: string): Promise<unknown> {
  return post('/reset-password', { token, newPassword });
}

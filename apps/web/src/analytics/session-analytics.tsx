'use client';

import { useGetSession } from '@biddy/api-client';
import { useEffect } from 'react';

import { takeSocialLogin } from './auth-events';
import { identifyUser, track } from './posthog';

/**
 * Analityka zależna od sesji (GET /v1/session, to samo zapytanie co menu w nagłówku): `identify`
 * zalogowanego, `reset` po wylogowaniu i zdarzenie po powrocie z Google/Apple. Nowe konto
 * społecznościowe nie ma jeszcze akceptacji regulaminu, więc liczymy je jako rejestrację.
 */
export function SessionAnalytics() {
  const { data } = useGetSession({ query: { staleTime: 60_000, retry: false } });
  const user = data?.user;

  useEffect(() => {
    if (user === undefined) {
      return;
    }
    identifyUser(user?.id);
    const provider = user === null ? undefined : takeSocialLogin();
    if (user !== null && provider !== undefined) {
      track(user.termsAccepted ? 'login_completed' : 'sign_up_completed', { method: provider });
    }
  }, [user]);

  return null;
}

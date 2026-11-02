// Konto zalogowanego użytkownika w Server Components (strony wymagające sesji).
import { type MeDto, getMe, isApiError } from '@biddy/api-client';
import { redirect } from 'next/navigation';

import { routes, withNext } from '@/lib/routes';

import { withSessionCookies } from './server';

/**
 * `GET /v1/me` z ciasteczkiem sesji. Bez sesji przekierowuje na logowanie, a bez akceptacji
 * regulaminu na jej ekran; w obu przypadkach z powrotem pod `returnTo`.
 */
export async function loadMeOrRedirect(returnTo: string): Promise<MeDto> {
  let me: MeDto;
  try {
    me = await getMe(await withSessionCookies());
  } catch (error) {
    if (isApiError(error) && error.status === 401) {
      redirect(withNext(routes.signIn, returnTo));
    }
    throw error;
  }
  if (!me.termsAccepted) {
    redirect(withNext(routes.acceptTerms, returnTo));
  }
  return me;
}

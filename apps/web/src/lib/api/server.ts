// Klient API w Server Components i Route Handlers: wygenerowane funkcje (np. getServerTime)
// z ciasteczkiem sesji użytkownika przekazanym do API (PROJECT.md §11.3).
import { configureApiClient } from '@biddy/api-client';
import { cookies } from 'next/headers';

import { config } from '@/config';
import { serverApiUrl } from '@/env';

configureApiClient({ baseUrl: serverApiUrl(config.apiUrl) });

/**
 * Opcje żądania z ciasteczkami bieżącego żądania użytkownika.
 *
 * Uwaga: odczyt ciasteczek sprawia, że strona renderuje się dynamicznie (bez ISR). Publiczne
 * strony (np. aukcja dla niezalogowanych) wołają API bez sesji.
 *
 * @example
 * const auction = await getAuction(id, await withSessionCookies());
 */
export async function withSessionCookies(init: RequestInit = {}): Promise<RequestInit> {
  const cookieHeader = (await cookies()).toString();
  if (cookieHeader === '') {
    return init;
  }
  const headers = new Headers(init.headers);
  headers.set('cookie', cookieHeader);
  return { ...init, headers };
}

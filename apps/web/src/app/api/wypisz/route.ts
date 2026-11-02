// Wypisanie jednym kliknięciem z klienta poczty (F-20, RFC 8058): nagłówek List-Unsubscribe
// wskazuje ten adres, a klient wysyła POST `List-Unsubscribe=One-Click` (formularz, bez
// ciasteczek). API przyjmuje tylko JSON (ochrona przed CSRF, F-03), więc web woła je sam.
import { isApiError, unsubscribe } from '@biddy/api-client';

// Klient API po stronie serwera (adres API, także API_INTERNAL_URL).
import '@/lib/api/server';

export async function POST(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  try {
    await unsubscribe({ token });
    return new Response('OK', { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const status = isApiError(error) && error.status === 400 ? 400 : 502;
    return new Response(status === 400 ? 'Nieprawidłowy link wypisania.' : 'Spróbuj ponownie.', {
      status,
      headers: { 'cache-control': 'no-store' },
    });
  }
}

// Zdarzenia kont (F-07), których nie da się wysłać w miejscu akcji: logowanie przez Google
// i Apple kończy się po przekierowaniu przez dostawcę, więc metodę zapamiętujemy przed wyjściem
// ze strony (sessionStorage), a zdarzenie wysyłamy po powrocie, gdy jest już sesja.
import type { SocialProvider } from '@/lib/auth/auth-api';

const SOCIAL_LOGIN_KEY = 'biddy_social_login';
/** Znacznik starszy niż 15 minut to porzucone logowanie, a nie powrót od dostawcy. */
const SOCIAL_LOGIN_TTL_MS = 15 * 60 * 1000;

/** Przed przekierowaniem do Google/Apple. */
export function rememberSocialLogin(provider: SocialProvider, now = Date.now()): void {
  try {
    sessionStorage.setItem(SOCIAL_LOGIN_KEY, JSON.stringify({ provider, at: now }));
  } catch {
    // Bez sessionStorage (np. tryb prywatny z blokadą) zdarzenie po prostu przepada.
  }
}

/** Po powrocie od dostawcy: metoda logowania albo `undefined`; znacznik działa raz. */
export function takeSocialLogin(now = Date.now()): SocialProvider | undefined {
  try {
    const raw = sessionStorage.getItem(SOCIAL_LOGIN_KEY);
    sessionStorage.removeItem(SOCIAL_LOGIN_KEY);
    if (raw === null) {
      return undefined;
    }
    const { provider, at } = JSON.parse(raw) as { provider?: unknown; at?: unknown };
    const fresh = typeof at === 'number' && now - at < SOCIAL_LOGIN_TTL_MS;
    return fresh && (provider === 'google' || provider === 'apple') ? provider : undefined;
  } catch {
    return undefined;
  }
}

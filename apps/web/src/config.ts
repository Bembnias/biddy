// Konfiguracja publiczna aplikacji (adres API, adres strony, Sentry, PostHog). Waliduje ją
// next.config.ts (src/env.ts) przy buildzie i starcie, a Next.js wkleja wynik do kodu serwera
// i przeglądarki jako BIDDY_PUBLIC_CONFIG.
import type { PublicEnv } from './env';

function readPublicConfig(): PublicEnv {
  const raw = process.env.BIDDY_PUBLIC_CONFIG;
  if (raw === undefined || raw === '') {
    throw new Error(
      'Brak BIDDY_PUBLIC_CONFIG: aplikację uruchamia się przez Next.js (next.config.ts waliduje src/env.ts).',
    );
  }
  return JSON.parse(raw) as PublicEnv;
}

export const config: PublicEnv = readPublicConfig();

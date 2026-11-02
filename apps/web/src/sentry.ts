// Wspólne ustawienia Sentry dla przeglądarki, serwera i edge. Bez NEXT_PUBLIC_SENTRY_DSN Sentry
// się nie inicjalizuje. Oszczędnie z danymi osobowymi (RODO): bez PII i bez Session Replay.
import type { BrowserOptions } from '@sentry/nextjs';

import { config } from '@/config';

export function sentryOptions(): BrowserOptions | undefined {
  if (config.sentryDsn === undefined) {
    return undefined;
  }
  return {
    dsn: config.sentryDsn,
    environment: config.environment,
    ...(config.release === undefined ? {} : { release: config.release }),
    tracesSampleRate: 0,
    // Jak w API (apps/api/src/instrument.ts): bez danych użytkownika, ciasteczek i treści żądań.
    dataCollection: { userInfo: false, cookies: false, httpBodies: [] },
  };
}

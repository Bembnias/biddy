// Zgłaszanie błędów do Sentry z kodu przeglądarki (error.tsx, global-error.tsx). Sentry ładuje się
// osobnym fragmentem JS (instrumentation-client.ts), więc tu też importujemy go dynamicznie: dzięki
// temu nie trafia do głównej paczki strony i nie opóźnia pierwszego renderu (LCP).
import { config } from '@/config';

export function reportError(error: unknown): void {
  if (config.sentryDsn === undefined) {
    return;
  }
  void import('@sentry/nextjs').then(({ captureException }) => {
    captureException(error);
  });
}

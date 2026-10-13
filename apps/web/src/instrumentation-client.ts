// Sentry w przeglądarce. Next.js ładuje ten plik przed kodem aplikacji, ale sam SDK pobieramy
// osobnym fragmentem JS po starcie strony: w głównej paczce zwiększałby czas do pierwszego
// renderu (LCP, PROJECT.md §19). Błędy z pierwszych chwil (zanim SDK się załaduje) zbieramy
// i przekazujemy po inicjalizacji. Bez NEXT_PUBLIC_SENTRY_DSN nic się nie ładuje.
import { sentryOptions } from './sentry';

const options = sentryOptions();

if (options !== undefined && typeof window !== 'undefined') {
  const early: unknown[] = [];
  const onError = (event: ErrorEvent) => {
    early.push(event.error ?? event.message);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    early.push(event.reason);
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  void import('@sentry/nextjs').then((Sentry) => {
    Sentry.init(options);
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    for (const error of early.splice(0)) {
      Sentry.captureException(error);
    }
  });
}

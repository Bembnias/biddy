// Inicjalizacja Sentry przed resztą aplikacji: `node --import ./dist/instrument.js dist/main.js`
// (skrypt start). Musi się wykonać przed importem NestJS, żeby instrumentacja objęła HTTP i bazę,
// dlatego importuje tylko config.ts (Zod), a nie moduły Nest.
//
// Czyta wyłącznie zmienne SENTRY_*, NODE_ENV i APP_RELEASE. Błędy pozostałych zmiennych zgłasza
// main.ts (loadConfig) z pełną listą, więc tutaj nic nie przerywa startu.
import { init, onUnhandledRejectionIntegration } from '@sentry/nestjs';

import { loadSentryOptions } from './infra/config/config.js';

const options = loadSentryOptions(process.env);

if (options !== undefined) {
  init({
    dsn: options.dsn,
    environment: options.environment,
    release: options.release,
    tracesSampleRate: options.tracesSampleRate,
    // Sentry tylko zgłasza nieobsłużone odrzucenie. Log i zakończenie procesu należą do
    // fatal-errors.ts (main.ts), więc zachowanie nie zależy od tego, czy SENTRY_DSN jest ustawiony
    // (domyślny tryb „warn” wypisywał tekst na stderr i zostawiał proces przy życiu).
    integrations: [onUnhandledRejectionIntegration({ mode: 'none' })],
    // Oszczędnie z danymi osobowymi (RODO): bez danych użytkownika, ciasteczek, treści żądań,
    // parametrów zapytań SQL i wartości zmiennych lokalnych. Identyfikator użytkownika ustawi
    // jawnie moduł identity (F-07).
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpBodies: [],
      databaseQueryData: false,
      stackFrameVariables: false,
    },
  });
}

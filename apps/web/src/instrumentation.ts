// Sentry na serwerze Node.js i w edge (Next.js wywołuje register() raz przy starcie).
import * as Sentry from '@sentry/nextjs';

import { sentryOptions } from './sentry';

export function register(): void {
  const options = sentryOptions();
  if (options !== undefined) {
    Sentry.init(options);
  }
}

/** Błędy renderowania na serwerze (Server Components, Route Handlers) trafiają do Sentry. */
export const onRequestError = Sentry.captureRequestError;

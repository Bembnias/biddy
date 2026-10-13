// PostHog (EU) ładowany dynamicznie dopiero po zgodzie: bez zgody kod PostHog nie trafia nawet
// do przeglądarki (osobny fragment paczki), więc nie ma żadnych żądań ani ciasteczek analityki.
import type * as PostHogModule from 'posthog-js';

import { hasAnalyticsConsent } from './consent';

export interface AnalyticsConfig {
  readonly posthogKey: string | undefined;
  readonly posthogHost: string;
}

let started: Promise<boolean> | undefined;

/** Uruchamia PostHog, jeśli jest klucz i zgoda na analitykę; zwraca, czy wystartował. */
export function startAnalyticsIfConsented(
  config: AnalyticsConfig,
  cookieHeader: string,
  load: () => Promise<typeof PostHogModule> = () => import('posthog-js'),
): Promise<boolean> {
  const { posthogKey } = config;
  if (posthogKey === undefined || !hasAnalyticsConsent(cookieHeader)) {
    return Promise.resolve(false);
  }
  started ??= load().then(({ default: posthog }) => {
    posthog.init(posthogKey, {
      api_host: config.posthogHost,
      // Profile tylko dla zalogowanych (F-07 wywoła identify), anonimowi bez profilu.
      person_profiles: 'identified_only',
      capture_pageview: 'history_change',
    });
    return true;
  });
  return started;
}

/** Tylko testy: zapomina, że analityka wystartowała. */
export function resetAnalyticsForTests(): void {
  started = undefined;
}

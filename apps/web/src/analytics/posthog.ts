// PostHog (EU) ładowany dynamicznie dopiero po zgodzie: bez zgody kod PostHog nie trafia nawet
// do przeglądarki (osobny fragment paczki), więc nie ma żadnych żądań ani ciasteczek analityki.
import type * as PostHogModule from 'posthog-js';

import { hasAnalyticsConsent } from './consent';

export interface AnalyticsConfig {
  readonly posthogKey: string | undefined;
  readonly posthogHost: string;
}

type PostHogClient = Pick<PostHogModule.PostHog, 'capture' | 'identify' | 'reset'>;

let started: Promise<boolean> | undefined;
let instance: PostHogClient | undefined;
/** ID zalogowanego użytkownika do `identify` (także gdy PostHog jeszcze się ładuje). */
let identity: string | undefined;

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
      // Profile tylko dla zalogowanych (identifyUser), anonimowi bez profilu.
      person_profiles: 'identified_only',
      capture_pageview: 'history_change',
    });
    instance = posthog;
    if (identity !== undefined) {
      posthog.identify(identity);
    }
    return true;
  });
  return started;
}

/** Akcja na PostHog po jego starcie; bez zgody (PostHog nie startuje) nic się nie dzieje. */
function whenStarted(action: (posthog: PostHogClient) => void): void {
  void started?.then((ok) => {
    if (ok && instance !== undefined) {
      action(instance);
    }
  });
}

/** Zdarzenie analityczne; wysłane, gdy PostHog wystartuje (zdarzenie tuż po wejściu nie ginie). */
export function track(event: string, properties?: Record<string, unknown>): void {
  whenStarted((posthog) => posthog.capture(event, properties));
}

/** Zalogowany użytkownik (samo ID, bez e-maila) albo `undefined` po wylogowaniu. */
export function identifyUser(userId: string | undefined): void {
  if (userId === identity) {
    return;
  }
  const signedOut = userId === undefined;
  identity = userId;
  whenStarted((posthog) => {
    if (signedOut) {
      posthog.reset();
    } else {
      posthog.identify(userId);
    }
  });
}

/** Tylko testy: zapomina, że analityka wystartowała. */
export function resetAnalyticsForTests(): void {
  started = undefined;
  instance = undefined;
  identity = undefined;
}

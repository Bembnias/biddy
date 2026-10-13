import { resetApiClient } from '@biddy/api-client';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

import { mockApi } from './api';

import { parsePublicEnv } from '@/env';

// Konfiguracja publiczna jak po `next build` z domyślnymi wartościami lokalnymi (src/config.ts).
process.env.BIDDY_PUBLIC_CONFIG ??= JSON.stringify(parsePublicEnv({}));

// Bez globals Vitest Testing Library nie sprząta sama: każdy test zaczyna od pustego DOM.
// Domyślnie API odpowiada 404 (bez prawdziwych żądań sieciowych); testy podają własne odpowiedzi.
beforeEach(() => {
  mockApi({});
});

afterEach(() => {
  cleanup();
  resetApiClient();
});

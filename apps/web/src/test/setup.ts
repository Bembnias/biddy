import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import { parsePublicEnv } from '@/env';

// Konfiguracja publiczna jak po `next build` z domyślnymi wartościami lokalnymi (src/config.ts).
process.env.BIDDY_PUBLIC_CONFIG ??= JSON.stringify(parsePublicEnv({}));

// Bez globals Vitest Testing Library nie sprząta sama: każdy test zaczyna od pustego DOM.
afterEach(() => {
  cleanup();
});
